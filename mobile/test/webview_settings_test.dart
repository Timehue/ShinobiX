import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:shinobi_app/src/shell_config.dart';

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
String _read(String path) => File(path).readAsStringSync().replaceAll('\r\n', '\n');

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
    named[match.group(1)!] = match.group(2)!.replaceAll(RegExp(r'\s+'), ' ');
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
  'applicationNameForUserAgent': r"'${ShellConfig.userAgentToken}${ShellConfig.shellProtocol}'",
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
  'onWebViewCreated': '(c) => _controller = c',
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
  expect(at, isNonNegative, reason: '`$signature` moved; move this test with it');
  return _enclosed(source, source.indexOf('{', at)).replaceAll(RegExp(r'\s+'), ' ').trim();
}

void main() {
  test('every WebView setting is pinned, and nothing unpinned was added', () {
    final source = _read('lib/src/shell_page.dart');
    const getter = 'InAppWebViewSettings get _settings => InAppWebViewSettings(';
    final at = source.indexOf(getter);
    expect(at, isNonNegative, reason: 'the _settings getter moved; move this test with it');
    expect(_namedArguments(_enclosed(source, at + getter.length - 1)), _expectedSettings);
  });

  test('the User-Agent suffix the website reads is ShinobiJourneyApp/1', () {
    expect('${ShellConfig.userAgentToken}${ShellConfig.shellProtocol}', 'ShinobiJourneyApp/1');
  });

  test('the game WebView uses those settings and wires every callback they need', () {
    final views = _calls(_read('lib/src/shell_page.dart'), 'InAppWebView');
    expect(views.where((args) => args['key'] == '_webViewKey').single, _expectedGameWebView);
  });

  test('the hidden popup WebView only hands a scripted window.open to the navigation policy', () {
    final views = _calls(_read('lib/src/shell_page.dart'), 'InAppWebView');
    expect(views, hasLength(2), reason: 'a third WebView needs its own settings pinned here');
    final popup = views.where((args) => args.containsKey('windowId')).single;
    expect(popup.keys.toSet(), {'windowId', 'initialSettings', 'shouldOverrideUrlLoading', 'onLoadStart'});
    expect(popup['initialSettings'], 'InAppWebViewSettings(useShouldOverrideUrlLoading: true)');
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
    final body = _methodBody(_read('lib/src/shell_page.dart'), 'void _onRenderProcessGone(');
    expect(body, contains('_webViewKey = UniqueKey();'));
    expect(body, contains('_controller = null;'));
  });

  test('Android Back always goes to the shell, never straight out of the app', () {
    final scopes = _calls(_read('lib/src/shell_page.dart'), 'PopScope');
    expect(scopes, hasLength(1));
    expect(scopes.single['canPop'], 'false');
    expect(scopes.single['onPopInvokedWithResult'], contains('if (!didPop) unawaited(_onBack());'));
  });

  test('the manifest asks for internet and vibration only, and keeps backups off', () {
    final manifest = _read('android/app/src/main/AndroidManifest.xml');
    final permissions =
        RegExp(r'<uses-permission android:name="([^"]+)"').allMatches(manifest).map((m) => m.group(1)).toSet();
    expect(permissions, {'android.permission.INTERNET', 'android.permission.VIBRATE'});
    expect(manifest, contains('android:allowBackup="false"'));
    expect(manifest, contains('android:fullBackupContent="false"'));
    expect(manifest, contains('android:dataExtractionRules="@xml/data_extraction_rules"'));
    final rules = _read('android/app/src/main/res/xml/data_extraction_rules.xml');
    for (final section in ['cloud-backup', 'device-transfer']) {
      final body = RegExp('<$section>([\\s\\S]*?)</$section>').firstMatch(rules)?.group(1) ?? '';
      final excluded = RegExp(r'<exclude domain="(\w+)"').allMatches(body).map((m) => m.group(1)).toSet();
      expect(excluded, {'root', 'file', 'database', 'sharedpref', 'external'}, reason: section);
      expect(body, isNot(contains('<include')), reason: section);
    }
  });

  test('the manifest keeps the launcher alias, the keyboard resize and no web App Links', () {
    final manifest = _read('android/app/src/main/AndroidManifest.xml');
    // The chat keyboard must push the page up, not cover the input.
    expect(manifest, contains('android:windowSoftInputMode="adjustResize"'));
    // The old TWA's launcher name, so icons players pinned survive the upgrade.
    expect(
      RegExp(r'<activity-alias\s+android:name="com\.shinobijourney\.app\.LauncherActivity"[\s\S]*?</activity-alias>')
          .firstMatch(manifest)
          ?.group(0),
      allOf(contains('android.intent.action.MAIN'), contains('android.intent.category.LAUNCHER')),
    );
    // Inside <application>, the only link the app accepts is the sign-in
    // return. An https filter would capture the Custom Tab's own navigation.
    final application = RegExp(r'<application[\s\S]*</application>').firstMatch(manifest)!.group(0)!;
    final schemes = RegExp(r'android:scheme="([^"]+)"').allMatches(application).map((m) => m.group(1)).toSet();
    expect(schemes, {ShellConfig.authCallbackScheme});
    expect(application, isNot(contains('android:autoVerify')));
    // Package visibility (Android 11+): without these queries, legal pages,
    // Google sign-in, foreign links and mailto: find no app to open them.
    final queries = RegExp(r'<queries>[\s\S]*</queries>').firstMatch(manifest)!.group(0)!;
    for (final needed in [
      'android.support.customtabs.action.CustomTabsService',
      '<data android:scheme="https" />',
      '<data android:scheme="mailto" />',
    ]) {
      expect(queries, contains(needed));
    }
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
    final code = RegExp(r'^version: \d+\.\d+\.\d+\+(\d+)$', multiLine: true).firstMatch(pubspec)?.group(1);
    expect(code, isNotNull, reason: 'pubspec.yaml version must be <name>+<code>');
    // 2.0.1 (6) is on Play. A lower code can never be uploaded again.
    expect(int.parse(code!), greaterThanOrEqualTo(6));
    // Exact, not a range: a pub upgrade must never swap the WebView silently.
    expect(pubspec, contains('flutter_inappwebview: 6.2.0-beta.3'));
  });
}
