import 'dart:typed_data';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:crypto/crypto.dart';

import 'package:autonexus_mobile/evidence/photo_capture.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('prepares the exact bounded JPEG bytes and hash used for local inference/upload', () async {
    final asset = await rootBundle.load('assets/samples/sample.jpg');
    final source = Uint8List.view(
      asset.buffer,
      asset.offsetInBytes,
      asset.lengthInBytes,
    );
    final photo = PhotoProcessor.prepare(source);

    expect(photo.bytes, isNotEmpty);
    expect(photo.bytes.length, lessThanOrEqualTo(PhotoProcessor.maxBytes));
    expect(photo.sha256, sha256.convert(photo.bytes).toString());
    expect(photo.contentType, 'image/jpeg');
    expect(photo.fileName, 'inspection.jpg');
  });

  test(
    'rejects empty or undecodable input instead of queuing it as evidence',
    () {
      expect(
        () => PhotoProcessor.prepare(const <int>[]),
        throwsA(isA<FormatException>()),
      );
      expect(
        () => PhotoProcessor.prepare(List<int>.filled(128, 7)),
        throwsA(isA<FormatException>()),
      );
    },
  );
}
