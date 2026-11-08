import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/services.dart' show rootBundle;

import '../evidence/photo_capture.dart';

import 'antialias_resize.dart';

import 'package:tflite_flutter/tflite_flutter.dart';

/// CU22 — on-device inference with the LiteRT artefact produced by CU23.
///
/// Two things matter here and they are easy to confuse:
///   * numeric equivalence of the exported artefact (measured in Python: 3e-06 against Keras);
///   * equivalence of preprocessing and interpreter *on the device*, which is measured here.
///
/// The preprocessing mirrors training: RGB, bilinear resize to 224x224 and MobileNetV2 scaling to
/// [-1, 1]. A mismatch in any of those steps silently changes every score, so the device test
/// compares against the Python reference instead of only checking that inference runs.
abstract interface class InspectionClassifier {
  ManifestData get manifest;
  Future<DeviceResult> analyse(Uint8List bytes);
  void dispose();
}

class DamageClassifier implements InspectionClassifier {
  DamageClassifier._(this._interpreter, this.manifest);

  static const int inputSize = 224;
  static const String experimentalNotice =
      'Capacidad visual experimental: el modelo no está validado para uso profesional ni para decidir reparaciones.';

  final Interpreter _interpreter;
  @override
  final ManifestData manifest;

  static Future<DamageClassifier> load({
    String asset = 'assets/models/model.tflite',
    String manifestAsset = 'assets/models/manifest.json',
    Future<Interpreter> Function()? openInterpreter,
    Future<String> Function()? readManifest,
  }) async {
    final interpreter =
        await (openInterpreter?.call() ??
            Interpreter.fromAsset(
              asset,
              options: InterpreterOptions()..threads = 4,
            ));
    try {
      final manifestRaw =
          await (readManifest?.call() ?? rootBundle.loadString(manifestAsset));
      return DamageClassifier._(interpreter, ManifestData.parse(manifestRaw));
    } catch (_) {
      interpreter.close();
      rethrow;
    }
  }

  /// Decode, apply the EXIF orientation, downscale with the same antialiased kernel as training and
  /// normalize. Exposed so the device test compares the whole pipeline, not only the interpreter.
  List<List<List<List<double>>>> preprocess(Uint8List bytes) {
    final decoded = PhotoProcessor.decodeBounded(bytes);
    return [AntialiasResize.run(decoded, inputSize)];
  }

  /// Runs inference on the given tensor and reports scores plus elapsed milliseconds.
  DeviceResult runTensor(List<List<List<List<double>>>> input) {
    final output = List.generate(
      1,
      (_) => List.filled(manifest.labels.length, 0.0),
    );
    final watch = Stopwatch()..start();
    _interpreter.run(input, output);
    watch.stop();
    final scores = output.first.map((value) => value.toDouble()).toList();
    final results = <DeviceScore>[];
    for (var index = 0; index < manifest.labels.length; index++) {
      final score = scores[index];
      final threshold = manifest.thresholds[index];
      results.add(
        DeviceScore(
          label: manifest.labels[index],
          score: score,
          threshold: threshold,
          flagged: score >= threshold,
        ),
      );
    }
    return DeviceResult(
      scores: results,
      latencyMs: watch.elapsedMicroseconds / 1000.0,
    );
  }

  @override
  Future<DeviceResult> analyse(Uint8List bytes) async =>
      runTensor(preprocess(bytes));

  @override
  void dispose() => _interpreter.close();
}

class DeviceScore {
  const DeviceScore({
    required this.label,
    required this.score,
    required this.threshold,
    required this.flagged,
  });

  final String label;
  final double score;
  final double threshold;
  final bool flagged;

  @override
  String toString() =>
      '$label ${(score * 100).toStringAsFixed(1)}% (umbral ${(threshold * 100).toStringAsFixed(0)}%)';
}

class DeviceResult {
  const DeviceResult({required this.scores, required this.latencyMs});

  final List<DeviceScore> scores;
  final double latencyMs;
  bool get inconclusive => scores.every((score) => !score.flagged);
}

/// Subset of the CU23 manifest the device needs: labels, thresholds, run identity and the gate.
class ManifestData {
  const ManifestData({
    required this.labels,
    required this.thresholds,
    required this.modelVersion,
    required this.runId,
    required this.qualityStatus,
    required this.qualityNote,
  });

  final List<String> labels;
  final List<double> thresholds;
  final String modelVersion;
  final String runId;
  final String qualityStatus;
  final String qualityNote;

  static ManifestData parse(String raw) {
    final decoded = json.decode(raw) as Map<String, dynamic>;
    final labels = (decoded['labels'] as List)
        .map((value) => value.toString())
        .toList();
    final thresholdsRaw =
        decoded['thresholds'] as Map<String, dynamic>? ?? const {};
    final quality = decoded['quality'] as Map<String, dynamic>?;
    final version = decoded['modelVersion'];
    final run = decoded['runId'];
    if (version is! String ||
        version.trim().isEmpty ||
        run is! String ||
        run.trim().isEmpty ||
        labels.length != 4 ||
        labels.toSet().length != 4 ||
        labels.any(
          (label) => !const [
            'crack',
            'dent',
            'glass_shatter',
            'scratch',
          ].contains(label),
        ) ||
        labels.any(
          (label) =>
              thresholdsRaw[label] is! num ||
              !(thresholdsRaw[label] as num).isFinite ||
              (thresholdsRaw[label] as num) < 0 ||
              (thresholdsRaw[label] as num) > 1,
        )) {
      throw const FormatException(
        'Manifiesto inválido: identidad, etiquetas o umbrales ausentes.',
      );
    }
    return ManifestData(
      labels: labels,
      thresholds: labels
          .map((label) => (thresholdsRaw[label] as num).toDouble())
          .toList(),
      modelVersion: version,
      runId: run,
      qualityStatus: (quality?['status'] ?? 'unknown').toString(),
      qualityNote:
          (quality?['note'] ?? 'Sin declaración de calidad del operador.')
              .toString(),
    );
  }
}
