import 'dart:ui';

/// Everything the shell knows about the website, in one place.
///
/// The game itself lives entirely at [origin]; this app only frames it. Two of
/// these literals are shared with the TypeScript side, and
/// test/parity_test.dart fails if they ever drift apart:
///   * [userAgentToken] = APP_SHELL_UA_TOKEN in shinobij.client/src/lib/surface.ts
///   * [authCallbackScheme]://[authCallbackHost] = GOOGLE_ANDROID_APP_RETURN_URL
///     in api/_google-auth.ts
abstract final class ShellConfig {
  static const String host = 'shinobijourney.com';
  static const String origin = 'https://$host';

  /// Hosts that answer with a 301 to [origin] (api/_canonical-domain.ts).
  /// Loading them in the WebView is fine: the server lands the player on
  /// the canonical host.
  static const Set<String> redirectingHosts = {
    'www.shinobijourney.com',
    'theravensark.com',
    'www.theravensark.com',
  };

  /// Appended to the WebView's User-Agent. The website reads it to know it is
  /// inside the Play app: no Tebex checkout, back-button history, the native
  /// review prompt, and the app return for Google sign-in.
  static const String userAgentToken = 'ShinobiJourneyApp/';

  /// What this shell can do, sent after [userAgentToken]. Bump it when a
  /// native capability the website might gate on is added, so the website
  /// can tell an old install from a new one without knowing app versions.
  static const int shellProtocol = 1;

  /// Where the server sends a Google sign-in that this app started.
  static const String authCallbackScheme = 'shinobijourney';
  static const String authCallbackHost = 'auth';

  /// `shinobijourney://review`, or the `intent://review…` form the website
  /// uses, asks for the Play in-app review.
  static const String reviewHost = 'review';

  /// Google's authorize endpoint (api/_google-auth.ts AUTHORIZE_URL).
  static const String googleAuthorizeHost = 'accounts.google.com';
  static const String googleAuthorizePath = '/o/oauth2/v2/auth';

  /// The game's background (index.html, manifest.webmanifest).
  static const Color background = Color(0xFF0F172A);

  /// The old TWA's navigation-bar colour, kept so the upgrade looks the same.
  static const Color navigationBar = Color(0xFF000000);

  /// How long the native splash waits for the first page before revealing
  /// whatever the WebView has, so a slow network never looks like a hang.
  static const Duration splashTimeout = Duration(seconds: 8);
}
