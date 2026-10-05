import 'dart:ui' show DisplayFeature, DisplayFeatureState, DisplayFeatureType;

import 'package:flutter/widgets.dart';

/// Finds a full-width horizontal hinge that divides the app window in two.
///
/// Some Android/Flutter combinations report a nonzero hinge as `postureFlat`
/// even while the display is physically split. Match the same geometry that
/// [DisplayFeatureSubScreen] uses to divide the live WebView, while still
/// accepting a zero-width hinge explicitly marked half-opened.
DisplayFeature? tabletopFeatureFor(MediaQueryData mediaQuery) {
  final size = mediaQuery.size;
  for (final feature in mediaQuery.displayFeatures) {
    final bounds = feature.bounds;
    final separatesWindow =
        (feature.type == DisplayFeatureType.hinge && bounds.shortestSide > 0) ||
        feature.state == DisplayFeatureState.postureHalfOpened;
    final spansWidth = bounds.width >= size.width * 0.8;
    final isHorizontal = bounds.width > bounds.height;
    final isInsideWindow = bounds.top > 0 && bounds.bottom < size.height;
    if (separatesWindow && spansWidth && isHorizontal && isInsideWindow) {
      return feature;
    }
  }
  return null;
}

/// Finds a separating vertical fold that creates left and right panes in book
/// posture. The game surface stays in the leading pane and native navigation
/// uses the trailing pane, so neither is drawn underneath the hinge.
DisplayFeature? bookFeatureFor(MediaQueryData mediaQuery) {
  final size = mediaQuery.size;
  for (final feature in mediaQuery.displayFeatures) {
    final bounds = feature.bounds;
    final separatesWindow =
        (feature.type == DisplayFeatureType.hinge && bounds.shortestSide > 0) ||
        feature.state == DisplayFeatureState.postureHalfOpened;
    final spansHeight = bounds.height >= size.height * 0.8;
    final isVertical = bounds.height > bounds.width;
    final isInsideWindow = bounds.left > 0 && bounds.right < size.width;
    if (separatesWindow && spansHeight && isVertical && isInsideWindow) {
      return feature;
    }
  }
  return null;
}
