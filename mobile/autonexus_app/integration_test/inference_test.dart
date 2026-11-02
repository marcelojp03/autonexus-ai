import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'package:autonexus_mobile/inference/damage_classifier.dart';

/// Runs on a device or emulator: `flutter test integration_test/inference_test.dart -d <device>`.
///
/// What this proves, and what it does not:
///   * proves the LiteRT artefact loads and runs on the Android interpreter, and measures how far the
///     device pipeline (image package resize + tflite) is from the server scores for the same bytes;
///   * does not prove the model is good: it stays `experimental` and the notice is part of the check.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('la inferencia en el dispositivo coincide con el servidor', (tester) async {
    final classifier = await DamageClassifier.load();
    addTearDown(classifier.dispose);

    final raw = await rootBundle.loadString('assets/samples/reference.json');
    final reference = json.decode(raw) as Map<String, dynamic>;
    final labels = (reference['labels'] as List).map((value) => value.toString()).toList();
    final expected = (reference['scores'] as List).map((value) => (value as num).toDouble()).toList();

    expect(classifier.manifest.labels, labels, reason: 'el artefacto del dispositivo debe ser el mismo');
    expect(classifier.manifest.runId, reference['runId'], reason: 'la corrida debe coincidir con la del servidor');

    final data = await rootBundle.load('assets/samples/sample.jpg');
    final bytes = Uint8List.view(data.buffer);
    final result = await classifier.analyse(bytes);

    expect(result.scores.length, expected.length);
    final deltas = <String, double>{};
    for (var index = 0; index < expected.length; index++) {
      deltas[labels[index]] = (result.scores[index].score - expected[index]).abs();
    }
    // 0,05 absorbs the difference between the `image` package resize and TensorFlow's antialiased
    // bilinear downscale; the measured value is printed so a drift is visible instead of hidden.
    final worst = deltas.values.reduce((a, b) => a > b ? a : b);
    // ignore: avoid_print
    print('CU22 device latency=${result.latencyMs.toStringAsFixed(1)}ms deltas=$deltas worst=${worst.toStringAsFixed(4)}');
    expect(worst, lessThan(0.05), reason: 'las puntuaciones del dispositivo deben seguir al servidor');
    expect(result.latencyMs, greaterThan(0));
  });
}
