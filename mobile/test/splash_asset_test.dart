import 'dart:ui' show instantiateImageCodec;

import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('the in-app splash asset is bundled and decodes at source resolution', () async {
    final data = await rootBundle.load('assets/splash_mark.webp');
    final codec = await instantiateImageCodec(data.buffer.asUint8List());
    final frame = await codec.getNextFrame();

    expect(frame.image.width, 512);
    expect(frame.image.height, 512);

    frame.image.dispose();
    codec.dispose();
  });
}
