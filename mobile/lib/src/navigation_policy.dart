import 'shell_config.dart';

/// What the shell does with a navigation the page asked for.
enum NavigationRoute {
  /// Let the WebView load it. Only the game itself.
  load,

  /// Open in a Chrome Custom Tab over the game, so the game keeps its state.
  customTab,

  /// Hand to another app: the browser for foreign sites, the mail app for
  /// mailto:.
  external,

  /// Google's authorize page for OUR client. Run it in a Chrome Auth Tab,
  /// because Google refuses to sign in inside a WebView.
  googleSignIn,

  /// The website's request for the Play in-app review.
  review,

  /// Refuse silently.
  block,
}

/// Decide where [uri] goes. Pure, so every rule is covered by
/// test/navigation_policy_test.dart.
///
/// [isNewWindow] is true for `target="_blank"` links and `window.open`. A new
/// window never loads inside the game's WebView: doing so would replace the
/// game, which is how a legal page opened during character creation used to
/// lose the whole creation.
NavigationRoute routeFor(Uri uri, {bool isNewWindow = false}) {
  switch (uri.scheme.toLowerCase()) {
    case 'https':
    case 'http':
      return _routeWeb(uri, isNewWindow: isNewWindow);
    case 'mailto':
      return NavigationRoute.external;
    case 'intent':
      // The website's review request, byte-identical to what the old TWA
      // shell handled: intent://review#Intent;scheme=shinobijourney;package=…;end
      // Nothing else in intent: form is ever acted on: web content must not
      // be able to fire arbitrary Android intents.
      final fragment = uri.fragment;
      final isOurReview = uri.host == ShellConfig.reviewHost &&
          fragment.contains('scheme=${ShellConfig.authCallbackScheme};') &&
          fragment.contains('package=com.shinobijourney.app;');
      return isOurReview ? NavigationRoute.review : NavigationRoute.block;
    case ShellConfig.authCallbackScheme:
      // Only the review host is honoured from page content. The auth return
      // arrives through the Auth Tab's own callback, never from the page.
      return uri.host == ShellConfig.reviewHost ? NavigationRoute.review : NavigationRoute.block;
    default:
      // about:, data:, blob:, javascript:, file:, content:, market:, tel: …
      return NavigationRoute.block;
  }
}

NavigationRoute _routeWeb(Uri uri, {required bool isNewWindow}) {
  final host = uri.host.toLowerCase();

  if (host == ShellConfig.googleAuthorizeHost && uri.path == ShellConfig.googleAuthorizePath) {
    // Only OUR sign-in goes through the app return. Any other Google page is
    // just a foreign site.
    final redirect = Uri.tryParse(uri.queryParameters['redirect_uri'] ?? '');
    if (redirect != null && _isOurHost(redirect.host)) return NavigationRoute.googleSignIn;
    return NavigationRoute.external;
  }

  // Play policy: a Play app may not take payment for digital goods outside
  // Play Billing. The website already hides the Tebex checkout in the app;
  // this is the second lock on the same door.
  if (host == 'tebex.io' || host.endsWith('.tebex.io')) return NavigationRoute.block;

  if (_isOurHost(host)) {
    if (isNewWindow) return NavigationRoute.customTab;
    // The game is a single page at "/", with its screen in the hash. Every
    // other path on the site is a document (legal pages, /api/*, *.html) that
    // must not replace the running game.
    final path = uri.path;
    return (path.isEmpty || path == '/') ? NavigationRoute.load : NavigationRoute.customTab;
  }

  return NavigationRoute.external;
}

bool _isOurHost(String host) {
  final h = host.toLowerCase();
  return h == ShellConfig.host || ShellConfig.redirectingHosts.contains(h);
}
