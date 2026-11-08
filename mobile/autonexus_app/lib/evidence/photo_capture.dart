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
    );
    if (file == null) return null;
    if (await file.length() > PhotoProcessor.maxBytes) {
      throw const FormatException(
        'La imagen supera 5 MiB. Elegí otra o registrá manualmente.',
      );
    }
    return file.readAsBytes();
  }

  @override
  Future<Uint8List?> retrieveLostPhoto() async {
    final response = await _picker.retrieveLostData();
    if (response.isEmpty) return null;
    final files = response.files;
    final file = files != null && files.isNotEmpty
        ? files.first
        : response.file;
    if (file == null) {
      throw const FormatException(
        'Android no devolvió la fotografía interrumpida.',
      );
    }
    if (await file.length() > PhotoProcessor.maxBytes) {
      throw const FormatException('La imagen supera 5 MiB.');
    }
    return file.readAsBytes();
  }
}

class PhotoInputException extends FormatException {
  const PhotoInputException(super.message, this.reason);
  final String reason;
}

class PhotoProcessor {
  const PhotoProcessor._();

  static const int maxBytes = 5 * 1024 * 1024;
  static const int maxSide = 1920;

  static img.Image decodeBounded(List<int> source) {
    if (source.isEmpty || source.length > maxBytes) {
      throw const FormatException(
        'La imagen debe ocupar entre 1 byte y 5 MiB.',
      );
    }
    final bytes = source is Uint8List ? source : Uint8List.fromList(source);
    final img.Decoder decoder;
    if (bytes.length >= 3 &&
        bytes[0] == 0xff &&
        bytes[1] == 0xd8 &&
        bytes[2] == 0xff) {
      decoder = img.JpegDecoder(maxPixels: 24000000);
    } else if (bytes.length >= 8 &&
        bytes.take(8).join(',') == '137,80,78,71,13,10,26,10') {
      if (bytes.length < 24 ||
          bytes.sublist(12, 16).join(',') != '73,72,68,82') {
        throw const FormatException('Cabecera PNG inválida.');
      }
      final header = ByteData.sublistView(bytes);
      _checkDimensions(header.getUint32(16), header.getUint32(20));
      decoder = img.PngDecoder(maxPixels: 24000000);
    } else {
      throw const FormatException('Sólo se admiten imágenes JPEG o PNG.');
    }
    final info = decoder.startDecode(bytes);
    if (info == null) {
      throw const FormatException('Cabecera JPEG/PNG inválida.');
    }
    _checkDimensions(info.width, info.height);
    final decoded = decoder.decodeFrame(0);
    if (decoded == null) {
      throw const FormatException('La imagen no se pudo decodificar.');
    }
    return decoded;
  }

  static void _checkDimensions(int width, int height) {
    if (width > 8192 || height > 8192 || width * height > 24000000) {
      throw const PhotoInputException(
        'Recursos insuficientes: máximo 8192 px por lado y 24 MP.',
        'insufficient_resources',
      );
    }
    if (width < 32 || height < 32) {
      throw const PhotoInputException(
        'Calidad insuficiente: mínimo 32 × 32 px.',
        'input_rejected',
      );
    }
  }

  static PreparedPhoto prepare(List<int> source) {
    final decoded = decodeBounded(source);
    if (decoded.width < 32 || decoded.height < 32) {
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
