import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/services.dart' show rootBundle;
import 'package:image/image.dart' as img;
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
class DamageClassifier {
  DamageClassifier._(this._interpreter, this.manifest);

  static const int inputSize = 224;
  static const String experimentalNotice =
      'Capacidad visual experimental: el modelo no está validado para uso profesional ni para decidir reparaciones.';

  final Interpreter _interpreter;
  final ManifestData manifest;

  static Future<DamageClassifier> load({
    String asset = 'assets/models/model.tflite',
    String manifestAsset = 'assets/models/manifest.json',
  }) async {
    final interpreter = await Interpreter.fromAsset(
      asset,
      options: InterpreterOptions()..threads = 2,
    );
    final manifestRaw = await rootBundle.loadString(manifestAsset);
    return DamageClassifier._(interpreter, ManifestData.parse(manifestRaw));
  }

  /// Preprocessed tensor, exposed so the device test can compare it with the training pipeline.
  List<List<List<List<double>>>> preprocess(Uint8List bytes) {
    final decoded = img.decodeImage(bytes);
    if (decoded == null) throw const FormatException('La imagen no se pudo decodificar');
    final rgb = decoded.convert(numChannels: 3);
    final resized = img.copyResize(
      rgb,
      width: inputSize,
      height: inputSize,
      interpolation: img.Interpolation.linear,
      maintainAspect: false,
    );
    return [
      List.generate(inputSize, (y) {
        return List.generate(inputSize, (x) {
          final pixel = resized.getPixel(x, y);
          return [
            (pixel.r.toDouble() / 127.5) - 1.0,
            (pixel.g.toDouble() / 127.5) - 1.0,
            (pixel.b.toDouble() / 127.5) - 1.0,
          ];
        });
      }),
    ];
  }

  /// Runs inference on the given tensor and reports scores plus elapsed milliseconds.
  DeviceResult runTensor(List<List<List<List<double>>>> input) {
    final output = List.generate(1, (_) => List.filled(manifest.labels.length, 0.0));
    final watch = Stopwatch()..start();
    _interpreter.run(input, output);
    watch.stop();
    final scores = output.first.map((value) => value.toDouble()).toList();
    final results = <DeviceScore>[];
    for (var index = 0; index < manifest.labels.length; index++) {
      final score = scores[index];
      final threshold = manifest.thresholds[index];
      results.add(DeviceScore(label: manifest.labels[index], score: score, threshold: threshold, flagged: score >= threshold));
    }
    return DeviceResult(scores: results, latencyMs: watch.elapsedMicroseconds / 1000.0);
  }

  Future<DeviceResult> analyse(Uint8List bytes) async => runTensor(preprocess(bytes));

  void dispose() => _interpreter.close();
}

class DeviceScore {
  const DeviceScore({required this.label, required this.score, required this.threshold, required this.flagged});

  final String label;
  final double score;
  final double threshold;
  final bool flagged;

  @override
  String toString() => '$label ${(score * 100).toStringAsFixed(1)}% (umbral ${(threshold * 100).toStringAsFixed(0)}%)';
}

class DeviceResult {
  const DeviceResult({required this.scores, required this.latencyMs});

  final List<DeviceScore> scores;
  final double latencyMs;
}

/// Subset of the CU23 manifest the device needs: labels, thresholds, run identity and the gate.
class ManifestData {
  const ManifestData({
    required this.labels,
    required this.thresholds,
    required this.runId,
    required this.qualityStatus,
    required this.qualityNote,
  });

  final List<String> labels;
  final List<double> thresholds;
  final String runId;
  final String qualityStatus;
  final String qualityNote;

  static ManifestData parse(String raw) {
    final decoded = json.decode(raw) as Map<String, dynamic>;
    final labels = (decoded['labels'] as List).map((value) => value.toString()).toList();
    final thresholdsRaw = decoded['thresholds'] as Map<String, dynamic>? ?? const {};
    final quality = decoded['quality'] as Map<String, dynamic>?;
    return ManifestData(
      labels: labels,
      thresholds: labels.map((label) => (thresholdsRaw[label] as num?)?.toDouble() ?? 0.5).toList(),
      runId: (decoded['runId'] ?? 'sin-corrida').toString(),
      qualityStatus: (quality?['status'] ?? 'unknown').toString(),
      qualityNote: (quality?['note'] ?? 'Sin declaración de calidad del operador.').toString(),
    );
  }
}
