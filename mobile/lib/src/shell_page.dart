import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_web_auth_2/flutter_web_auth_2.dart';
import 'package:in_app_review/in_app_review.dart';
import 'package:url_launcher/url_launcher.dart';

import 'app_update.dart';
import 'google_auth_return.dart';
import 'navigation_policy.dart';
import 'play_experience.dart';
import 'shell_config.dart';

/// The whole app: one WebView running the game, plus the few native pieces a
/// WebView cannot do by itself.
class ShellPage extends StatefulWidget {
  const ShellPage({super.key});

  @override
  State<ShellPage> createState() => _ShellPageState();
}

class _ShellPageState extends State<ShellPage> with WidgetsBindingObserver {
  /// One WebView for the life of the app. It holds the game's session and the
  /// Google sign-in nonce (sessionStorage), so it is never swapped out — only
  /// rebuilt, with a fresh key, if Android kills its renderer.
  Key _webViewKey = UniqueKey();
  InAppWebViewController? _controller;

  PlayExperienceStore? _store;
  Uri? _launchUri;

  bool _splash = true;
  bool _offline = false;
  bool _signInInFlight = false;
  bool _reviewInFlight = false;
  Timer? _splashTimeout;

  /// A `window.open` whose URL is not known yet. Android only reveals it once
  /// the new window starts loading, so a hidden WebView catches it, hands the
  /// URL on, and is removed.
  int? _popupWindowId;
  Timer? _popupTimeout;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _splashTimeout = Timer(ShellConfig.splashTimeout, _hideSplash);
    unawaited(_start());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _splashTimeout?.cancel();
    _popupTimeout?.cancel();
    super.dispose();
  }

  Future<void> _start() async {
    PlayExperienceStore? store;
    try {
      store = await PlayExperienceStore.open();
      await store.countSession(_now());
    } catch (_) {
      // Preferences unavailable: the game still opens, just without review
      // eligibility.
    }
    if (!mounted) return;
    setState(() {
      _store = store;
      _launchUri = PlayExperiencePolicy.launchUri(reviewDue: store?.reviewDue(_now()) ?? false);
    });
    if (store != null) {
      unawaited(checkForPlayUpdate(store: store, confirmRestart: _confirmRestart));
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(_store?.countSession(_now()));
  }

  static int _now() => DateTime.now().millisecondsSinceEpoch;

  // ── WebView ────────────────────────────────────────────────────────────

  InAppWebViewSettings get _settings => InAppWebViewSettings(
        // The website's app detection (shinobij.client/src/lib/surface.ts).
        applicationNameForUserAgent: '${ShellConfig.userAgentToken}${ShellConfig.shellProtocol}',
        javaScriptEnabled: true,
        domStorageEnabled: true,
        databaseEnabled: true,
        // Music and story cues start on scene changes, not only on taps.
        mediaPlaybackRequiresUserGesture: false,
        // The layout is built for CSS pixels; Android's font-size setting
        // must not inflate it past what the screens were designed for.
        textZoom: 100,
        // Two Android WebView defaults Chrome does not have, both of which
        // clipped and mis-sized the game on the first device test:
        //  * overview mode zooms the WHOLE page out whenever any element is a
        //    pixel wider than the screen;
        //  * an 8px minimum font size enlarges the game's small labels (card
        //    text, badges, HUD counters; 64 declarations sit under 8px) past
        //    the boxes they were sized for.
        // 1 is the lowest minimum Android accepts, which in practice is off.
        loadWithOverviewMode: false,
        minimumFontSize: 1,
        minimumLogicalFontSize: 1,
        supportZoom: false,
        builtInZoomControls: false,
        displayZoomControls: false,
        // New windows reach onCreateWindow instead of replacing the game.
        supportMultipleWindows: true,
        javaScriptCanOpenWindowsAutomatically: true,
        useShouldOverrideUrlLoading: true,
        // Without this a renderer crash (memory pressure in 3D scenes, a
        // WebView update) would take the whole app down.
        useOnRenderProcessGone: true,
        useHybridComposition: true,
        transparentBackground: true,
        disableDefaultErrorPage: true,
        // The site is already dark; never let Android re-colour it.
        algorithmicDarkeningAllowed: false,
        allowFileAccess: false,
        safeBrowsingEnabled: true,
        isInspectable: kDebugMode,
      );

  Future<NavigationActionPolicy?> _onNavigation(InAppWebViewController c, NavigationAction action) async {
    final uri = action.request.url;
    // Subframes are governed by the page's own CSP.
    if (uri == null || !action.isForMainFrame) return NavigationActionPolicy.ALLOW;
    final route = routeFor(uri);
    if (route == NavigationRoute.load) return NavigationActionPolicy.ALLOW;
    unawaited(_follow(route, uri));
    return NavigationActionPolicy.CANCEL;
  }

  Future<bool?> _onCreateWindow(InAppWebViewController c, CreateWindowAction action) async {
    final uri = action.request.url;
    if (uri != null && (uri.scheme == 'https' || uri.scheme == 'http' || uri.scheme == 'mailto')) {
      // A link with a target: Android already told us where it goes.
      unawaited(_follow(routeFor(uri, isNewWindow: true), uri));
      return false;
    }
    // A scripted window.open: catch its first navigation in a hidden WebView.
    setState(() => _popupWindowId = action.windowId);
    _popupTimeout?.cancel();
    _popupTimeout = Timer(const Duration(seconds: 10), _closePopup);
    return true;
  }

  Future<NavigationActionPolicy?> _onPopupNavigation(InAppWebViewController c, NavigationAction action) async {
    final uri = action.request.url;
    if (uri == null || uri.scheme == 'about') return NavigationActionPolicy.ALLOW;
    _closePopup();
    unawaited(_follow(routeFor(uri, isNewWindow: true), uri));
    return NavigationActionPolicy.CANCEL;
  }

  void _closePopup() {
    _popupTimeout?.cancel();
    if (mounted && _popupWindowId != null) setState(() => _popupWindowId = null);
  }

  Future<void> _follow(NavigationRoute route, Uri uri) async {
    switch (route) {
      case NavigationRoute.load:
        await _controller?.loadUrl(urlRequest: URLRequest(url: WebUri.uri(uri)));
      case NavigationRoute.customTab:
        await _launch(uri, LaunchMode.inAppBrowserView);
      case NavigationRoute.external:
        await _launch(uri, LaunchMode.externalApplication);
      case NavigationRoute.googleSignIn:
        await _signInWithGoogle(uri);
      case NavigationRoute.review:
        await _requestReview();
      case NavigationRoute.block:
        break;
    }
  }

  Future<void> _launch(Uri uri, LaunchMode mode) async {
    try {
      if (!await launchUrl(uri, mode: mode) && mode == LaunchMode.inAppBrowserView) {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
      }
    } catch (_) {
      // No browser or mail app to hand it to. Nothing useful to show.
    }
  }

  void _onLoadStop(InAppWebViewController c, WebUri? url) {
    _hideSplash();
  }

  void _onReceivedError(InAppWebViewController c, WebResourceRequest request, WebResourceError error) {
    // Only the game document itself failing means "offline". A failed image or
    // API call is the page's business, and reloading for it would throw the
    // player out of a battle.
    if (request.isForMainFrame != true || error.type == WebResourceErrorType.CANCELLED) return;
    if (!mounted) return;
    setState(() {
      _offline = true;
      _splash = false;
    });
  }

  void _onRenderProcessGone(InAppWebViewController c, RenderProcessGoneDetail detail) {
    // The renderer is gone and this WebView cannot be used again. Build a new
    // one; the game restores the session from its own storage.
    if (!mounted) return;
    setState(() {
      _controller = null;
      _webViewKey = UniqueKey();
      _splash = true;
    });
  }

  Future<PermissionResponse?> _onPermissionRequest(InAppWebViewController c, PermissionRequest request) async {
    // The game needs no camera, microphone or other device permission.
    return PermissionResponse(resources: request.resources, action: PermissionResponseAction.DENY);
  }

  void _hideSplash() {
    _splashTimeout?.cancel();
    if (mounted && _splash) setState(() => _splash = false);
  }

  Future<void> _retry() async {
    final uri = _launchUri;
    if (uri == null) return;
    setState(() {
      _offline = false;
      _splash = true;
    });
    _splashTimeout?.cancel();
    _splashTimeout = Timer(ShellConfig.splashTimeout, _hideSplash);
    await _controller?.loadUrl(urlRequest: URLRequest(url: WebUri.uri(uri)));
  }

  // ── Google sign-in ─────────────────────────────────────────────────────

  /// Google refuses to sign in inside a WebView, so its pages run in a Chrome
  /// Auth Tab. The server sends the result to shinobijourney://auth (because
  /// the website asked it to — see googleStartBody), and the result is loaded
  /// back into THIS WebView, where the nonce that redeems it lives.
  Future<void> _signInWithGoogle(Uri authorizeUrl) async {
    if (_signInInFlight) return;
    _signInInFlight = true;
    Uri target;
    try {
      final result = await FlutterWebAuth2.authenticate(
        url: authorizeUrl.toString(),
        callbackUrlScheme: ShellConfig.authCallbackScheme,
      );
      target = gameUriForAuthResult(result);
    } catch (_) {
      // Closed the tab, or the browser failed. The website shows its usual
      // "did not complete" message and lets the player try again.
      target = authErrorUri();
    } finally {
      _signInInFlight = false;
    }
    // location.replace keeps the pre-sign-in page out of the back history.
    // The URL goes in as a JSON string literal, never spliced in raw.
    await _controller?.evaluateJavascript(source: 'location.replace(${jsonEncode(target.toString())})');
  }

  // ── Play review and update ─────────────────────────────────────────────

  Future<void> _requestReview() async {
    final store = _store;
    if (store == null || _reviewInFlight) return;
    final now = _now();
    if (!store.reviewDue(now)) return;
    _reviewInFlight = true;
    try {
      final review = InAppReview.instance;
      if (!await review.isAvailable().timeout(const Duration(seconds: 5))) return;
      // Once Google shows the card, Google and the player own it: no timeout.
      await review.requestReview();
      await store.recordReview(now);
    } catch (_) {
      // Quota, no Play Store, or a timeout: never the player's problem.
    } finally {
      _reviewInFlight = false;
    }
  }

  Future<bool> _confirmRestart() async {
    if (!mounted) return false;
    final restart = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Update ready'),
        content: const Text('The latest Shinobi Journey update is ready. Restart to install it?'),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Later')),
          TextButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Restart')),
        ],
      ),
    );
    return restart ?? false;
  }

  // ── Back button ────────────────────────────────────────────────────────

  /// Mirrors what Android's back did in the old TWA (shinobij.client/src/lib/
  /// app-history.ts owns the rules). In-game screens carry a `#/screen` hash,
  /// and there back is always given to the page: it may go to the previous
  /// screen, or refuse — during an unresolved battle, back must not become a
  /// way to flee. So it never closes the app from inside the game.
  Future<void> _onBack() async {
    final c = _controller;
    if (c == null || _offline) {
      await SystemNavigator.pop();
      return;
    }
    try {
      final url = await c.getUrl();
      if (url != null && url.fragment.startsWith('/')) {
        // Scripted, not goBack(): Chromium may skip history entries a page
        // re-pushed without a gesture, which is exactly how app-history
        // refuses a back press.
        await c.evaluateJavascript(source: 'history.back()');
        return;
      }
      if (await c.canGoBack()) {
        await c.goBack();
        return;
      }
    } catch (_) {
      // Fall through to closing, as a browser would.
    }
    await SystemNavigator.pop();
  }

  // ── Layout ─────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    // Android 15+ draws every app edge to edge. Paint the bar areas ourselves
    // and keep the page out of them, rather than relying on the WebView to
    // report safe-area insets to the page.
    final bars = MediaQuery.viewPaddingOf(context);
    final keyboard = MediaQuery.viewInsetsOf(context).bottom;
    final launchUri = _launchUri;

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) unawaited(_onBack());
      },
      child: AnnotatedRegion<SystemUiOverlayStyle>(
        value: SystemUiOverlayStyle.light,
        child: ColoredBox(
          color: ShellConfig.background,
          child: Column(
            children: [
              SizedBox(height: bars.top),
              Expanded(
                child: Padding(
                  padding: EdgeInsets.only(left: bars.left, right: bars.right),
                  child: Stack(
                    children: [
                      if (launchUri != null)
                        InAppWebView(
                          key: _webViewKey,
                          initialUrlRequest: URLRequest(url: WebUri.uri(launchUri)),
                          initialSettings: _settings,
                          onWebViewCreated: (c) => _controller = c,
                          shouldOverrideUrlLoading: _onNavigation,
                          onCreateWindow: _onCreateWindow,
                          onLoadStop: _onLoadStop,
                          onReceivedError: _onReceivedError,
                          onRenderProcessGone: _onRenderProcessGone,
                          onPermissionRequest: _onPermissionRequest,
                        ),
                      if (_popupWindowId != null)
                        Positioned(
                          left: 0,
                          top: 0,
                          width: 1,
                          height: 1,
                          child: IgnorePointer(
                            child: Opacity(
                              opacity: 0,
                              child: InAppWebView(
                                windowId: _popupWindowId,
                                initialSettings: InAppWebViewSettings(useShouldOverrideUrlLoading: true),
                                shouldOverrideUrlLoading: _onPopupNavigation,
                                onLoadStart: (c, url) {
                                  if (url != null && url.scheme != 'about') {
                                    _closePopup();
                                    unawaited(_follow(routeFor(url, isNewWindow: true), url));
                                  }
                                },
                              ),
                            ),
                          ),
                        ),
                      if (_offline) _OfflineScreen(onRetry: _retry),
                      if (_splash) const _SplashScreen(),
                    ],
                  ),
                ),
              ),
              ColoredBox(
                color: ShellConfig.navigationBar,
                child: SizedBox(width: double.infinity, height: math.max(bars.bottom, keyboard)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SplashScreen extends StatelessWidget {
  const _SplashScreen();

  @override
  Widget build(BuildContext context) {
    // The Android 12+ system splash shows this same art at 288dp through a
    // 192dp circle; matching it makes the hand-off to this screen invisible.
    return const ColoredBox(
      color: ShellConfig.background,
      child: Center(
        child: ClipOval(
          child: SizedBox.square(
            dimension: 192,
            child: OverflowBox(
              maxWidth: 288,
              maxHeight: 288,
              child: Image(
                image: AssetImage('assets/splash_mark.png'),
                width: 288,
                height: 288,
                semanticLabel: 'Shinobi Journey',
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Same words as the website's own offline page (public/offline.html), for a
/// first launch with no connection, before the page has ever loaded.
class _OfflineScreen extends StatelessWidget {
  const _OfflineScreen({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ColoredBox(
      color: ShellConfig.background,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('You are offline', style: theme.textTheme.headlineSmall, textAlign: TextAlign.center),
                const SizedBox(height: 12),
                Text(
                  'Shinobi Journey needs a connection to reach your village. Any progress already '
                  'saved is safe on the server — nothing is lost by closing this.',
                  style: theme.textTheme.bodyMedium,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 24),
                FilledButton(onPressed: onRetry, child: const Text('Try again')),
                const SizedBox(height: 12),
                Text(
                  'Reconnect to Wi-Fi or mobile data, then tap Try again.',
                  style: theme.textTheme.bodySmall,
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
