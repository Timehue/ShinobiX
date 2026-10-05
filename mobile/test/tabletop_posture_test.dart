import 'dart:ui' show DisplayFeature, DisplayFeatureState, DisplayFeatureType;

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/widgets.dart';
import 'package:shinobi_app/src/tabletop_posture.dart';

void main() {
  const size = Size(1000, 1800);

  test('finds a nonzero horizontal hinge that divides two display panes', () {
    const hinge = DisplayFeature(
      bounds: Rect.fromLTWH(0, 899, 1000, 2),
      type: DisplayFeatureType.hinge,
      state: DisplayFeatureState.postureFlat,
    );
    final mediaQuery = MediaQueryData(size: size, displayFeatures: [hinge]);

    expect(tabletopFeatureFor(mediaQuery), hinge);
  });

  test('finds a zero-width hinge when Android reports half-open posture', () {
    const hinge = DisplayFeature(
      bounds: Rect.fromLTWH(0, 899, 1000, 0),
      type: DisplayFeatureType.fold,
      state: DisplayFeatureState.postureHalfOpened,
    );
    final mediaQuery = MediaQueryData(size: size, displayFeatures: [hinge]);

    expect(tabletopFeatureFor(mediaQuery), hinge);
  });

  test('does not turn a book hinge into tabletop controls', () {
    const hinge = DisplayFeature(
      bounds: Rect.fromLTWH(499, 0, 2, 1800),
      type: DisplayFeatureType.hinge,
      state: DisplayFeatureState.postureHalfOpened,
    );
    final mediaQuery = MediaQueryData(size: size, displayFeatures: [hinge]);

    expect(tabletopFeatureFor(mediaQuery), isNull);
    expect(bookFeatureFor(mediaQuery), hinge);
  });

  test('finds a zero-width vertical fold in half-opened book posture', () {
    const fold = DisplayFeature(
      bounds: Rect.fromLTWH(499, 0, 0, 1800),
      type: DisplayFeatureType.fold,
      state: DisplayFeatureState.postureHalfOpened,
    );
    final mediaQuery = MediaQueryData(size: size, displayFeatures: [fold]);

    expect(bookFeatureFor(mediaQuery), fold);
    expect(tabletopFeatureFor(mediaQuery), isNull);
  });

  test('does not treat a flat crease as a separated tabletop display', () {
    const fold = DisplayFeature(
      bounds: Rect.fromLTWH(0, 899, 1000, 0),
      type: DisplayFeatureType.fold,
      state: DisplayFeatureState.postureFlat,
    );
    final mediaQuery = MediaQueryData(size: size, displayFeatures: [fold]);

    expect(tabletopFeatureFor(mediaQuery), isNull);
    expect(bookFeatureFor(mediaQuery), isNull);
  });
}
