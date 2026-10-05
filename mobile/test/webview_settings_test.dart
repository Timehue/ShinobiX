import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:shinobi_app/src/shell_config.dart';
import 'package:shinobi_app/src/tabletop_command_deck.dart';

/// Pins every WebView setting, the callbacks that make those settings take
/// effect, and the manifest and build values that limit what the shell may do.
/// None of them can be exercised without a phone. Build 2.0.1 (6) exists
/// because two of them were wrong on the first device test (overview mode
/// zoomed the whole page out, and Android's 8px minimum font enlarged the small
/// labels), and no test read them. Changing any value now fails here. That
/// forces a deliberate decision and a pass through the device checklist in
/// README.md.
///
/// The test reads the sources instead of building the widget, so the shell code
/// stays exactly as shipped. `flutter test` runs from mobile/.
String _read(String path) =>
    File(path).readAsStringSync().replaceAll('\r\n', '\n');

String _normalizeCode(String value) => value
    .replaceAll(RegExp(r'\s+'), ' ')
    .replaceAll(RegExp(r'\(\s+'), '(')
    .replaceAll(RegExp(r'\s+\)'), ')')
    .replaceAll(RegExp(r',\s*\)'), ')')
    .trim();

/// The index just past the one-line string literal that opens at [i].
int _stringEnd(String source, int i) {
  final quote = source[i];
  for (var j = i + 1; j < source.length && source[j] != '\n'; j++) {
    if (source[j] == r'\') {
      j++;
    } else if (source[j] == quote) {
      return j + 1;
    }
  }
  fail('unterminated string at offset $i');
}

/// The text inside the bracket at [open], up to its match, with `//` comments
/// dropped and string literals kept whole.
String _enclosed(String source, int open) {
  final out = StringBuffer();
  var depth = 0;
  var i = open;
  while (i < source.length) {
    if (source.startsWith('//', i)) {
      final end = source.indexOf('\n', i);
      i = end < 0 ? source.length : end;
      continue;
    }
    final ch = source[i];
    if (ch == "'" || ch == '"') {
      final end = _stringEnd(source, i);
      out.write(source.substring(i, end));
      i = end;
      continue;
    }
    if ('([{'.contains(ch)) depth++;
    if (')]}'.contains(ch) && --depth == 0) return out.toString().substring(1);
    out.write(ch);
    i++;
  }
  fail('no closing bracket for offset $open');
}

/// A call's named arguments as name → value, whitespace collapsed.
Map<String, String> _namedArguments(String arguments) {
  final parts = <String>[];
  var current = StringBuffer();
  var depth = 0;
  var i = 0;
  while (i < arguments.length) {
    final ch = arguments[i];
    if (ch == "'" || ch == '"') {
      final end = _stringEnd(arguments, i);
      current.write(arguments.substring(i, end));
      i = end;
      continue;
    }
    if ('([{'.contains(ch)) depth++;
    if (')]}'.contains(ch)) depth--;
    if (ch == ',' && depth == 0) {
      parts.add(current.toString());
      current = StringBuffer();
    } else {
      current.write(ch);
    }
    i++;
  }
  parts.add(current.toString());
  final named = <String, String>{};
  for (final part in parts.map((p) => p.trim()).where((p) => p.isNotEmpty)) {
    final match = RegExp(r'^(\w+):\s*([\s\S]+)$').firstMatch(part);
    if (match == null) fail('not a named argument: $part');
    named[match.group(1)!] = _normalizeCode(match.group(2)!);
  }
  return named;
}

/// Every `name(` call in [source], as its named arguments.
List<Map<String, String>> _calls(String source, String name) => [
  for (final match in RegExp('\\b$name\\(').allMatches(source))
    _namedArguments(_enclosed(source, match.end - 1)),
];

const _expectedSettings = <String, String>{
  // The website's app detection (shinobij.client/src/lib/surface.ts).
  'applicationNameForUserAgent':
      r"'${ShellConfig.userAgentToken}${ShellConfig.shellProtocol}'",
  'javaScriptEnabled': 'true',
  'domStorageEnabled': 'true',
  'databaseEnabled': 'true',
  'mediaPlaybackRequiresUserGesture': 'false',
  'textZoom': '100',
  // The 2.0.1 fix: never zoom the page out, never enlarge the sub-8px labels.
  'loadWithOverviewMode': 'false',
  'minimumFontSize': '1',
  'minimumLogicalFontSize': '1',
  'supportZoom': 'false',
  'builtInZoomControls': 'false',
  'displayZoomControls': 'false',
  // Without these three, new windows replace the game and the navigation
  // policy never runs.
  'supportMultipleWindows': 'true',
  'javaScriptCanOpenWindowsAutomatically': 'true',
  'useShouldOverrideUrlLoading': 'true',
  // Without this, a renderer crash closes the app.
  'useOnRenderProcessGone': 'true',
  'useHybridComposition': 'true',
  'transparentBackground': 'true',
  'disableDefaultErrorPage': 'true',
  'algorithmicDarkeningAllowed': 'false',
  'allowFileAccess': 'false',
  'safeBrowsingEnabled': 'true',
  'isInspectable': 'kDebugMode',
};

const _expectedGameWebView = <String, String>{
  'key': '_webViewKey',
  'initialUrlRequest': 'URLRequest(url: WebUri.uri(launchUri))',
  'initialSettings': '_settings',
  'onWebViewCreated': '_onWebViewCreated',
  'shouldOverrideUrlLoading': '_onNavigation',
  'onCreateWindow': '_onCreateWindow',
  'onLoadStop': '_onLoadStop',
  'onReceivedError': '_onReceivedError',
  'onRenderProcessGone': '_onRenderProcessGone',
  'onPermissionRequest': '_onPermissionRequest',
};

/// The body of the method whose declaration starts with [signature].
String _methodBody(String source, String signature) {
  final at = source.indexOf(signature);
  expect(
    at,
    isNonNegative,
    reason: '`$signature` moved; move this test with it',
  );
  return _normalizeCode(_enclosed(source, source.indexOf('{', at)));
}

void main() {
  test('every WebView setting is pinned, and nothing unpinned was added', () {
    final source = _read('lib/src/shell_page.dart');
    const getter =
        'InAppWebViewSettings get _settings => InAppWebViewSettings(';
    final at = source.indexOf(getter);
    expect(
      at,
      isNonNegative,
      reason: 'the _settings getter moved; move this test with it',
    );
    expect(
      _namedArguments(_enclosed(source, at + getter.length - 1)),
      _expectedSettings,
    );
  });

  test('the User-Agent suffix the website reads is ShinobiJourneyApp/1', () {
    expect(
      '${ShellConfig.userAgentToken}${ShellConfig.shellProtocol}',
      'ShinobiJourneyApp/1',
    );
  });

  test(
    'the game WebView uses those settings and wires every callback they need',
    () {
      final views = _calls(_read('lib/src/shell_page.dart'), 'InAppWebView');
      expect(
        views.where((args) => args['key'] == '_webViewKey').single,
        _expectedGameWebView,
      );
    },
  );

  test('the live WebView follows safe insets and stays in one foldable display segment', () {
    final source = _read('lib/src/shell_page.dart')
        .replaceAll(RegExp(r'\s+'), ' ');
    expect(source, contains('DisplayFeatureSubScreen('));
    expect(source, contains('anchorPoint: Offset.zero'));
    expect(
      source,
      contains('final bars = MediaQuery.viewPaddingOf(segmentContext);'),
    );
    expect(
      source,
      matches(
        RegExp(
          r'final keyboard = MediaQuery\.viewInsetsOf\(segmentContext\)\s*\.bottom;',
        ),
      ),
    );
    expect(source, contains('SizedBox(height: bars.top)'));
    expect(
      source,
      matches(
        RegExp(
          r'EdgeInsets\.only\(\s*left: bars\.left,\s*right: bars\.right,?\s*\)',
        ),
      ),
    );
    expect(source, contains('height: math.max(bars.bottom, keyboard)'));
    expect(source, contains('SystemUiOverlayStyle.light.copyWith('));
    expect(source, contains('statusBarIconBrightness: Brightness.light'));
    expect(
      source,
      contains(
        'ColoredBox( color: ShellConfig.navigationBar, child: SizedBox(',
      ),
      reason: 'Android 16 needs a Flutter-painted navigation inset.',
    );
    expect(
      source,
      contains('systemNavigationBarColor: ShellConfig.navigationBar'),
    );
    expect(
      source,
      contains('systemNavigationBarIconBrightness: Brightness.light'),
    );
    expect(source, contains('systemNavigationBarContrastEnforced: false'));
    expect(
      source,
      contains('systemNavigationBarDividerColor: ShellConfig.navigationBar'),
    );
    expect(source, contains('key: _webViewKey'));
    expect(source, contains('tabletopFeatureFor(mediaQuery)'));
    expect(source, contains('bookFeatureFor(mediaQuery)'));
    expect(source, contains('TabletopCommandDeck('));
    expect(source, contains("handlerName: 'shinobiFoldNavigationState'"));
    expect(source, contains('TabletopCommandDeck.commandKeys'));
    expect(source, contains('commandButtons.every(button => button !== null)'));
    expect(source, contains('_foldNavigationAvailable'));
    expect(source, contains('axis: Axis.vertical'));
    expect(source, contains('left: bookFeature.bounds.right'));
    expect(
      source,
      contains("document.querySelectorAll('[aria-modal=\"true\"]')"),
    );
    expect(source, contains(".mobile-bottom-nav .mobile-nav-btn"));
    expect(source, contains('data-tabletop-command'));
    expect(source, contains('selectedCommand'));
    expect(source, contains('button?.click()'));
    final websiteNav = _read('../shinobij.client/src/components/MobileNav.tsx');
    final websiteCommands = RegExp(r'data-tabletop-command="([^"]+)"')
        .allMatches(websiteNav)
        .map((match) => match.group(1)!)
        .toList();
    expect(websiteCommands.toSet(), TabletopCommandDeck.commandKeys.toSet());
    expect(websiteCommands.length, TabletopCommandDeck.commandKeys.length);
    final posture = _read('lib/src/tabletop_posture.dart');
    expect(posture, contains('DisplayFeatureState.postureHalfOpened'));
    expect(posture, contains('bounds.shortestSide > 0'));
    expect(posture, contains('bookFeatureFor'));

    final appBuild = _read('android/app/build.gradle.kts');
    expect(
      appBuild,
      contains('targetSdk = 36'),
      reason: 'Android 16 applies large-screen resizability behavior at API 36',
    );
    final manifest = _read('android/app/src/main/AndroidManifest.xml');
    expect(manifest, contains('android:resizeableActivity="true"'));
    final activity = RegExp(
      r'<activity\s+android:name="\.MainActivity"[\s\S]*?</activity>',
    ).firstMatch(manifest)?.group(0);
    expect(activity, isNotNull);
    for (final change in [
      'orientation',
      'screenSize',
      'smallestScreenSize',
      'screenLayout',
      'density',
    ]) {
      expect(
        activity,
        contains(change),
        reason: 'resize/fold must be delivered without replacing the WebView',
      );
    }
  });

  test('the hidden popup WebView only hands a scripted window.open to the navigation policy', () {
    final views = _calls(_read('lib/src/shell_page.dart'), 'InAppWebView');
    expect(
      views,
      hasLength(2),
      reason: 'a third WebView needs its own settings pinned here',
    );
    final popup = views.where((args) => args.containsKey('windowId')).single;
    expect(popup.keys.toSet(), {
      'windowId',
      'initialSettings',
      'shouldOverrideUrlLoading',
      'onLoadStart',
    });
    expect(
      popup['initialSettings'],
      'InAppWebViewSettings(useShouldOverrideUrlLoading: true)',
    );
    expect(popup['shouldOverrideUrlLoading'], '_onPopupNavigation');
    expect(popup['onLoadStart'], contains('routeFor(url, isNewWindow: true)'));
  });

  test('every device permission request is denied, unconditionally', () {
    final source = _read('lib/src/shell_page.dart');
    expect(
      _methodBody(source, 'Future<PermissionResponse?> _onPermissionRequest('),
      'return PermissionResponse(resources: request.resources, action: PermissionResponseAction.DENY);',
    );
    expect(source, isNot(contains('PermissionResponseAction.GRANT')));
  });

  test('a renderer crash rebuilds the WebView instead of closing the app', () {
    final body = _methodBody(
      _read('lib/src/shell_page.dart'),
      'void _onRenderProcessGone(',
    );
    expect(body, contains('_webViewKey = UniqueKey();'));
    expect(body, contains('_controller = null;'));
  });

  test(
    'Android Back always goes to the shell, never straight out of the app',
    () {
      final scopes = _calls(_read('lib/src/shell_page.dart'), 'PopScope');
      expect(scopes, hasLength(1));
      expect(scopes.single['canPop'], 'false');
      expect(
        scopes.single['onPopInvokedWithResult'],
        contains('if (!didPop) unawaited(_onBack());'),
      );
    },
  );

  test('the manifest asks only for required internet, vibration, and Play Billing permissions', () {
    final manifest = _read('android/app/src/main/AndroidManifest.xml');
    final permissions = RegExp(r'<uses-permission android:name="([^"]+)"')
        .allMatches(manifest)
        .map((m) => m.group(1))
        .toSet();
    expect(permissions, {
      'android.permission.INTERNET',
      'android.permission.VIBRATE',
      'com.android.vending.BILLING',
    });
    expect(manifest, contains('android:allowBackup="false"'));
    expect(manifest, contains('android:fullBackupContent="false"'));
    expect(
      manifest,
      contains('android:dataExtractionRules="@xml/data_extraction_rules"'),
    );
    final rules = _read(
      'android/app/src/main/res/xml/data_extraction_rules.xml',
    );
    for (final section in ['cloud-backup', 'device-transfer']) {
      final body =
          RegExp('<$section>([\\s\\S]*?)</$section>')
              .firstMatch(rules)
              ?.group(1) ??
          '';
      final excluded = RegExp(r'<exclude domain="(\w+)"')
          .allMatches(body)
          .map((m) => m.group(1))
          .toSet();
      expect(excluded, {
        'root',
        'file',
        'database',
        'sharedpref',
        'external',
      }, reason: section);
      expect(body, isNot(contains('<include')), reason: section);
    }
  });

  test('the WebView camera capture provider exposes only app-specific capture files', () {
    final manifest = _read('android/app/src/main/AndroidManifest.xml');
    const providerPattern =
        r'<provider\s+android:name="com\.pichillilorenzo\.flutter_inappwebview_android\.InAppWebViewFileProvider"[\s\S]*?</provider>';
    final provider = RegExp(providerPattern).firstMatch(manifest)?.group(0);
    expect(provider, isNotNull);
    expect(
      provider,
      contains(
        'android:authorities="\${applicationId}.flutter_inappwebview_android.fileprovider"',
      ),
    );
    expect(provider, contains('android:exported="false"'));
    expect(provider, contains('android:grantUriPermissions="true"'));
    expect(provider, contains('android:resource="@xml/provider_paths"'));

    final paths = _read('android/app/src/main/res/xml/provider_paths.xml');
    expect(paths, contains('<external-files-path name="captures" path="." />'));
    expect(paths, isNot(contains('<root-path')));
  });

  test('the manifest keeps the launcher alias, the keyboard resize and no web App Links', () {
    final manifest = _read('android/app/src/main/AndroidManifest.xml');
    // The chat keyboard must push the page up, not cover the input.
    expect(manifest, contains('android:windowSoftInputMode="adjustResize"'));
    // The old TWA's launcher name, so icons players pinned survive the upgrade.
    expect(
      RegExp(
        r'<activity-alias\s+android:name="com\.shinobijourney\.app\.LauncherActivity"[\s\S]*?</activity-alias>',
      ).firstMatch(manifest)?.group(0),
      allOf(
        contains('android.intent.action.MAIN'),
        contains('android.intent.category.LAUNCHER'),
      ),
    );
    // Inside <application>, the only link the app accepts is the sign-in
    // return. An https filter would capture the Custom Tab's own navigation.
    final application = RegExp(r'<application[\s\S]*</application>')
        .firstMatch(manifest)!
        .group(0)!;
    expect(application, contains('android:appCategory="game"'));
    expect(
      application,
      contains('android:name="com.android.graphics.driver.prefer_angle"'),
    );
    expect(application, contains('android:value="true"'));
    expect(
      manifest,
      contains(
        '<uses-permission android:name="com.android.vending.BILLING" />',
      ),
    );
    final schemes = RegExp(r'android:scheme="([^"]+)"')
        .allMatches(application)
        .map((m) => m.group(1))
        .toSet();
    expect(schemes, {ShellConfig.authCallbackScheme});
    expect(application, isNot(contains('android:autoVerify')));
    // Package visibility (Android 11+): without these queries, legal pages,
    // Google sign-in, foreign links and mailto: find no app to open them.
    final queries = RegExp(r'<queries>[\s\S]*</queries>')
        .firstMatch(manifest)!
        .group(0)!;
    for (final needed in [
      'android.support.customtabs.action.CustomTabsService',
      '<data android:scheme="https" />',
      '<data android:scheme="mailto" />',
    ]) {
      expect(queries, contains(needed));
    }
  });

  test('the manifest advertises optional gamepad and PC input without filtering phones', () {
    final manifest = _read('android/app/src/main/AndroidManifest.xml');
    expect(
      manifest,
      contains(
        '<uses-feature android:name="android.hardware.gamepad" android:required="false" />',
      ),
    );
    expect(
      manifest,
      contains(
        '<uses-feature android:name="android.hardware.type.pc" android:required="false" />',
      ),
    );
  });

  test('the build targets the Play package at API 36, with the version and WebView plugin pinned', () {
    final gradle = _read('android/app/build.gradle.kts');
    expect(gradle, contains('namespace = "com.shinobijourney.app"'));
    expect(gradle, contains('applicationId = "com.shinobijourney.app"'));
    expect(gradle, contains('compileSdk = 36'));
    expect(gradle, contains('targetSdk = 36'));
    // pubspec.yaml is the only source of the versionCode.
    expect(gradle, contains('versionCode = flutter.versionCode'));
    final pubspec = _read('pubspec.yaml');
    final code = RegExp(
      r'^version: \d+\.\d+\.\d+\+(\d+)$',
      multiLine: true,
    ).firstMatch(pubspec)?.group(1);
    expect(
      code,
      isNotNull,
      reason: 'pubspec.yaml version must be <name>+<code>',
    );
    // 2.0.1 (6) is on Play. A lower code can never be uploaded again.
    expect(int.parse(code!), greaterThanOrEqualTo(6));
    // Exact, not a range: a pub upgrade must never swap the WebView silently.
    expect(pubspec, contains('flutter_inappwebview: 6.2.0-beta.3'));
  });
}
