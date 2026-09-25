import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:shinobi_app/src/navigation_policy.dart';
import 'package:shinobi_app/src/shell_config.dart';

/// The shell and the website agree on a few literals. If one side changes
/// alone, the app silently loses a feature (the shop falls back to the web
/// checkout, Google sign-in never returns, the review prompt never fires), so
/// read the TypeScript sources and hold both ends together.
///
/// `flutter test` runs from mobile/, so the website sources are one level up.
String _read(String repoPath) => File('../$repoPath').readAsStringSync();

void main() {
  test('the User-Agent token matches the website\'s app detection', () {
    final surface = _read('shinobij.client/src/lib/surface.ts');
    expect(surface, contains("APP_SHELL_UA_TOKEN = '${ShellConfig.userAgentToken}'"));
  });

  test('the Google return matches the server\'s constant', () {
    final google = _read('api/_google-auth.ts');
    expect(google,
        contains("GOOGLE_ANDROID_APP_RETURN_URL = '${ShellConfig.authCallbackScheme}://${ShellConfig.authCallbackHost}'"));
  });

  test('the manifest accepts exactly that callback', () {
    final manifest = _read('mobile/android/app/src/main/AndroidManifest.xml');
    expect(manifest,
        contains('android:scheme="${ShellConfig.authCallbackScheme}" android:host="${ShellConfig.authCallbackHost}"'));
  });

  test('the website\'s review request is one this shell acts on', () {
    final nativePlay = _read('shinobij.client/src/lib/native-play.ts');
    final intent = RegExp(r"'(intent://review[^']*)'").firstMatch(nativePlay)?.group(1);
    expect(intent, isNotNull, reason: 'native-play.ts no longer names an intent:// review URL');
    expect(routeFor(Uri.parse(intent!)), NavigationRoute.review);
  });

  test('the hosts that redirect to the game are the server\'s legacy hosts', () {
    final canonical = _read('api/_canonical-domain.ts');
    final legacy = RegExp(r"DEFAULT_LEGACY_DUPLICATE_HOSTS = \[([^\]]*)\]").firstMatch(canonical)?.group(1) ?? '';
    final hosts = RegExp(r"'([^']+)'").allMatches(legacy).map((m) => m.group(1)!).toSet();
    expect(hosts, isNotEmpty);
    expect(ShellConfig.redirectingHosts.containsAll(hosts), isTrue, reason: '$hosts');
  });
}
