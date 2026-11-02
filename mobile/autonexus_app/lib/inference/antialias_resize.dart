import 'dart:typed_data';

import 'package:image/image.dart' as img;

/// Antialiased bilinear downscale, matching `tf.image.resize(..., method: 'bilinear', antialias: true)`.
///
/// Why not `img.copyResize`: its interpolation kernels do not scale their support with the sampling
/// ratio, so a 4000 px photograph reduced to 224 px aliases. Measured on the device, that shifted the
/// `scratch` score by 0.084 against the server. TensorFlow instead widens a triangular filter by the
/// downscale factor, which is what this file reproduces - separable, with normalized weights.
class AntialiasResize {
  const AntialiasResize._();

  /// Returns `size x size` RGB values in [-1, 1], the same scaling as MobileNetV2 preprocessing.
  static List<List<List<double>>> run(img.Image source, int size) {
    final oriented = img.bakeOrientation(source);
    final rgb = oriented.convert(numChannels: 3);
    final width = rgb.width;
    final height = rgb.height;
    final data = rgb.getBytes(order: img.ChannelOrder.rgb);

    // Horizontal pass: height x size x 3
    final horizontal = Float32List(height * size * 3);
    final scaleX = width / size;
    final supportX = scaleX < 1.0 ? 1.0 : scaleX;
    for (var y = 0; y < height; y++) {
      final rowOffset = y * width * 3;
      for (var x = 0; x < size; x++) {
        final center = (x + 0.5) * scaleX - 0.5;
        final left = (center - supportX + 0.5).floor();
        final right = (center + supportX - 0.5).ceil();
        var weightSum = 0.0;
        var r = 0.0, g = 0.0, b = 0.0;
        for (var sample = left; sample <= right; sample++) {
          final clamped = sample < 0 ? 0 : (sample >= width ? width - 1 : sample);
          final distance = (sample - center).abs();
          if (distance > supportX) continue;
          final weight = 1.0 - distance / supportX;
          if (weight <= 0) continue;
          final index = rowOffset + clamped * 3;
          r += data[index] * weight;
          g += data[index + 1] * weight;
          b += data[index + 2] * weight;
          weightSum += weight;
        }
        final target = (y * size + x) * 3;
        if (weightSum == 0) {
          horizontal[target] = 0;
          horizontal[target + 1] = 0;
          horizontal[target + 2] = 0;
        } else {
          horizontal[target] = r / weightSum;
          horizontal[target + 1] = g / weightSum;
          horizontal[target + 2] = b / weightSum;
        }
      }
    }

    // Vertical pass: size x size x 3 -> normalized
    final scaleY = height / size;
    final supportY = scaleY < 1.0 ? 1.0 : scaleY;
    return List.generate(size, (y) {
      final center = (y + 0.5) * scaleY - 0.5;
      final top = (center - supportY + 0.5).floor();
      final bottom = (center + supportY - 0.5).ceil();
      final rows = <int>[];
      final weights = <double>[];
      var weightSum = 0.0;
      for (var sample = top; sample <= bottom; sample++) {
        final distance = (sample - center).abs();
        if (distance > supportY) continue;
        final weight = 1.0 - distance / supportY;
        if (weight <= 0) continue;
        rows.add(sample < 0 ? 0 : (sample >= height ? height - 1 : sample));
        weights.add(weight);
        weightSum += weight;
      }
      final divisor = weightSum == 0 ? 1.0 : weightSum;
      return List.generate(size, (x) {
        var r = 0.0, g = 0.0, b = 0.0;
        for (var index = 0; index < rows.length; index++) {
          final offset = (rows[index] * size + x) * 3;
          r += horizontal[offset] * weights[index];
          g += horizontal[offset + 1] * weights[index];
          b += horizontal[offset + 2] * weights[index];
        }
        return [
          (r / divisor) / 127.5 - 1.0,
          (g / divisor) / 127.5 - 1.0,
          (b / divisor) / 127.5 - 1.0,
        ];
      });
    });
  }
}
