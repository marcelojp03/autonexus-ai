import 'dart:convert';
import 'dart:typed_data';

import 'package:tflite_flutter/tflite_flutter.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:autonexus_mobile/evidence/photo_capture.dart';
import 'package:autonexus_mobile/inference/damage_classifier.dart';

void main() {
  test('rejects decodable non JPEG/PNG rather than silently converting', () {
    final gif = img.encodeGif(img.Image(width: 32, height: 32));
    expect(() => PhotoProcessor.prepare(gif), throwsFormatException);
  });
  test('rejects input above 5 MiB before decode', () {
    final png = img.encodePng(img.Image(width: 32, height: 32));
    final oversized = [...png, ...List.filled(5 * 1024 * 1024, 0)];
    expect(() => PhotoProcessor.prepare(oversized), throwsFormatException);
  });
  test('manifest cannot fabricate missing run or version', () {
    expect(
      () => ManifestData.parse(
        jsonEncode({
          'labels': ['crack'],
          'thresholds': {'crack': 0.7},
        }),
      ),
      throwsFormatException,
    );
  });
  for (final size in [(8193, 32), (8000, 3001), (31, 32)]) {
    test('rejects JPEG header dimensions $size before pixel decode', () {
      final bytes = img.encodeJpg(img.Image(width: 32, height: 32));
      final frame = List.generate(bytes.length - 1, (i) => i).firstWhere(
        (i) =>
            bytes[i] == 0xff && (bytes[i + 1] == 0xc0 || bytes[i + 1] == 0xc2),
      );
      bytes[frame + 5] = size.$2 >> 8;
      bytes[frame + 6] = size.$2 & 255;
      bytes[frame + 7] = size.$1 >> 8;
      bytes[frame + 8] = size.$1 & 255;
      expect(() => PhotoProcessor.decodeBounded(bytes), throwsFormatException);
    });
  }
  for (final size in [(8193, 32), (8000, 3001), (31, 32)]) {
    test('rejects PNG header dimensions $size before pixel decode', () {
      final bytes = Uint8List.fromList(img.encodePng(img.Image(width: 32, height: 32)));
      final header = ByteData.sublistView(bytes);
      header.setUint32(16, size.$1);
      header.setUint32(20, size.$2);
      expect(() => PhotoProcessor.decodeBounded(bytes), throwsFormatException);
    });
  }
  test('closes an opened interpreter when manifest parsing fails', () async {
    final interpreter = _Interpreter();
    await expectLater(
      DamageClassifier.load(
        openInterpreter: () async => interpreter,
        readManifest: () async => '{}',
      ),
      throwsA(anything),
    );
    expect(interpreter.closed, isTrue);
  });
  test('thresholds are required, never a fabricated 0.5 default', () {
    expect(
      () => ManifestData.parse(
        jsonEncode({
          'runId': 'test',
          'modelVersion': 'test',
          'labels': ['crack', 'dent', 'glass_shatter', 'scratch'],
          'thresholds': {'crack': 0.7},
        }),
      ),
      throwsFormatException,
    );
  });
}

class _Interpreter implements Interpreter {
  bool closed = false;
  @override
  void close() {
    closed = true;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}
