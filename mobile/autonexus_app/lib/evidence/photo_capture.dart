import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:image/image.dart' as img;
import 'package:image_picker/image_picker.dart';

enum PhotoSource { camera, gallery }

class PreparedPhoto {
  const PreparedPhoto({required this.bytes, required this.sha256});

  final Uint8List bytes;
  final String sha256;
  String get contentType => 'image/jpeg';
  String get fileName => 'inspection.jpg';
}

abstract interface class PhotoCapturePort {
  Future<Uint8List?> pick(PhotoSource source);
  Future<Uint8List?> retrieveLostPhoto();
}

class MobilePhotoCapture implements PhotoCapturePort {
  MobilePhotoCapture({ImagePicker? picker}) : _picker = picker ?? ImagePicker();

  final ImagePicker _picker;

  @override
  Future<Uint8List?> pick(PhotoSource source) async {
    final file = await _picker.pickImage(
      source: source == PhotoSource.camera
          ? ImageSource.camera
          : ImageSource.gallery,
      maxWidth: 2048,
      maxHeight: 2048,
      imageQuality: 90,
    );
    return file?.readAsBytes();
  }

  @override
  Future<Uint8List?> retrieveLostPhoto() async {
    final response = await _picker.retrieveLostData();
    if (response.isEmpty) return null;
    final files = response.files;
    final file = files != null && files.isNotEmpty
        ? files.first
        : response.file;
    if (file == null)
      throw const FormatException(
        'Android no devolvió la fotografía interrumpida.',
      );
    return file.readAsBytes();
  }
}

class PhotoProcessor {
  const PhotoProcessor._();

  static const int maxBytes = 5 * 1024 * 1024;
  static const int maxSide = 1920;

  static PreparedPhoto prepare(List<int> source) {
    if (source.isEmpty) throw const FormatException('La imagen está vacía.');
    final decoded = img.decodeImage(Uint8List.fromList(source));
    if (decoded == null || decoded.width < 32 || decoded.height < 32) {
      throw const FormatException(
        'Elegí una fotografía JPEG o PNG válida, de al menos 32 × 32 px.',
      );
    }
    final oriented = img.bakeOrientation(decoded);
    for (final dimension in [maxSide, 1600, 1280, 1024]) {
      var candidate = oriented;
      final longest = candidate.width > candidate.height
          ? candidate.width
          : candidate.height;
      if (longest > dimension) {
        final scale = dimension / longest;
        candidate = img.copyResize(
          candidate,
          width: (candidate.width * scale).round(),
          height: (candidate.height * scale).round(),
          interpolation: img.Interpolation.average,
        );
      }
      for (final quality in [90, 84, 78, 72, 66]) {
        final bytes = Uint8List.fromList(
          img.encodeJpg(candidate, quality: quality),
        );
        if (bytes.length <= maxBytes) {
          return PreparedPhoto(
            bytes: bytes,
            sha256: sha256.convert(bytes).toString(),
          );
        }
      }
    }
    throw const FormatException(
      'La fotografía supera el límite de 5 MiB incluso optimizada.',
    );
  }
}
