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
import 'book_welcome_deck.dart';
import 'google_auth_return.dart';
import 'navigation_policy.dart';
import 'play_experience.dart';
import 'shell_config.dart';
import 'tabletop_command_deck.dart';
import 'tabletop_posture.dart';

/// The whole app: one WebView running the game, plus the few native pieces a
/// WebView cannot do by itself.
class ShellPage extends StatefulWidget {
  const ShellPage({super.key});

  @override
  State<ShellPage> createState() => _ShellPageState();
}

class _ShellPageState extends State<ShellPage> with WidgetsBindingObserver {
  static const MethodChannel _playGamesChannel = MethodChannel(
    'com.shinobijourney.app/play_games',
  );
  static const MethodChannel _playRewardsChannel = MethodChannel(
    'com.shinobijourney.app/play_rewards',
  );

  /// One WebView for the life of the app. It holds the game's session and the
  /// Google sign-in nonce (sessionStorage), so it is never swapped out — only
  /// rebuilt, with a fresh key, if Android kills its renderer.
  Key _webViewKey = UniqueKey();
  InAppWebViewController? _controller;
  final List<Map<String, String>> _queuedPlayRewardPurchases = [];
  bool _gameDocumentReady = false;
  bool _tabletopMode = false;
  bool _bookMode = false;
  bool _foldNavigationAvailable = false;
  bool _foldLandingAvailable = false;
  bool _foldSignInAvailable = false;
  bool _foldCreatorAvailable = false;
  String? _foldCreatorStep;
  String? _foldCreatorNextLabel;
  String? _foldCreatorBackLabel;
  bool _foldModalOpen = false;
  String? _foldSelectedCommand;

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
    _playRewardsChannel.setMethodCallHandler(_handleNativePlayRewardsEvent);
    _splashTimeout = Timer(ShellConfig.splashTimeout, _hideSplash);
    unawaited(_start());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _playRewardsChannel.setMethodCallHandler(null);
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
      _launchUri = PlayExperiencePolicy.launchUri(
        reviewDue: store?.reviewDue(_now()) ?? false,
      );
    });
    // PGS v2 performs platform authentication at launch. The result is
    // intentionally independent of the game's own account and never blocks it.
    unawaited(
      _playGamesChannel.invokeMethod<Object?>('status').catchError((_) => null),
    );
    if (store != null) {
      unawaited(
        checkForPlayUpdate(store: store, confirmRestart: _confirmRestart),
      );
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(_store?.countSession(_now()));
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final mediaQuery = MediaQuery.of(context);
    final nextTabletopMode = tabletopFeatureFor(mediaQuery) != null;
    final nextBookMode = bookFeatureFor(mediaQuery) != null;
    final hadFoldNavigation = _tabletopMode || _bookMode;
    final hasFoldNavigation = nextTabletopMode || nextBookMode;
    if (nextTabletopMode == _tabletopMode && nextBookMode == _bookMode) return;
    _tabletopMode = nextTabletopMode;
    _bookMode = nextBookMode;
    if (hadFoldNavigation == hasFoldNavigation) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(_syncFoldNavigation());
    });
  }

  static int _now() => DateTime.now().millisecondsSinceEpoch;

  // ── WebView ────────────────────────────────────────────────────────────

  InAppWebViewSettings get _settings => InAppWebViewSettings(
    // The website's app detection (shinobij.client/src/lib/surface.ts).
    applicationNameForUserAgent:
        '${ShellConfig.userAgentToken}${ShellConfig.shellProtocol}',
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

  Future<NavigationActionPolicy?> _onNavigation(
    InAppWebViewController c,
    NavigationAction action,
  ) async {
    final uri = action.request.url;
    // Subframes are governed by the page's own CSP.
    if (uri == null || !action.isForMainFrame) {
      return NavigationActionPolicy.ALLOW;
    }
    final route = routeFor(uri);
    if (route == NavigationRoute.load) return NavigationActionPolicy.ALLOW;
    unawaited(_follow(route, uri));
    return NavigationActionPolicy.CANCEL;
  }

  Future<bool?> _onCreateWindow(
    InAppWebViewController c,
    CreateWindowAction action,
  ) async {
    final uri = action.request.url;
    if (uri != null &&
        (uri.scheme == 'https' ||
            uri.scheme == 'http' ||
            uri.scheme == 'mailto')) {
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

  Future<NavigationActionPolicy?> _onPopupNavigation(
    InAppWebViewController c,
    NavigationAction action,
  ) async {
    final uri = action.request.url;
    if (uri == null || uri.scheme == 'about') {
      return NavigationActionPolicy.ALLOW;
    }
    _closePopup();
    unawaited(_follow(routeFor(uri, isNewWindow: true), uri));
    return NavigationActionPolicy.CANCEL;
  }

  void _closePopup() {
    _popupTimeout?.cancel();
    if (mounted && _popupWindowId != null) {
      setState(() => _popupWindowId = null);
    }
  }

  Future<void> _follow(NavigationRoute route, Uri uri) async {
    switch (route) {
      case NavigationRoute.load:
        await _controller?.loadUrl(
          urlRequest: URLRequest(url: WebUri.uri(uri)),
        );
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
      if (!await launchUrl(uri, mode: mode) &&
          mode == LaunchMode.inAppBrowserView) {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
      }
    } catch (_) {
      // No browser or mail app to hand it to. Nothing useful to show.
    }
  }

  void _onLoadStop(InAppWebViewController c, WebUri? url) {
    _gameDocumentReady = true;
    unawaited(_flushPlayRewardPurchases());
    unawaited(_syncFoldNavigation());
    _hideSplash();
  }

  void _onWebViewCreated(InAppWebViewController controller) {
    _controller = controller;
    _gameDocumentReady = false;
    // The browser game can request only the small Play Games surface exposed
    // here. A website error, unavailable Play Services, or missing Console IDs
    // never blocks gameplay or the game's own account sign-in.
    controller.addJavaScriptHandler(
      handlerName: 'shinobiPlayGames',
      callback: _handlePlayGamesRequest,
    );
    controller.addJavaScriptHandler(
      handlerName: 'shinobiFoldNavigationState',
      callback: _handleFoldNavigationState,
    );
  }

  dynamic _handleFoldNavigationState(List<dynamic> args) {
    if (args.isEmpty || args.first is! Map) {
      return null;
    }
    final state = Map<String, dynamic>.from(args.first as Map);
    final selectedCommand = state['selectedCommand'];
    final modalOpen = state['modalOpen'];
    final navigationAvailable = state['navigationAvailable'];
    final landingAvailable = state['landingAvailable'];
    final signInAvailable = state['signInAvailable'];
    final creatorAvailable = state['creatorAvailable'];
    final creatorStep = state['creatorStep'];
    final creatorNextLabel = state['creatorNextLabel'];
    final creatorBackLabel = state['creatorBackLabel'];
    if (!mounted ||
        (selectedCommand is! String && selectedCommand != null) ||
        (selectedCommand is String &&
            !TabletopCommandDeck.commandKeys.contains(selectedCommand)) ||
        modalOpen is! bool ||
        navigationAvailable is! bool ||
        landingAvailable is! bool ||
        signInAvailable is! bool ||
        creatorAvailable is! bool ||
        (creatorStep is! String && creatorStep != null) ||
        (creatorNextLabel is! String && creatorNextLabel != null) ||
        (creatorBackLabel is! String && creatorBackLabel != null)) {
      return null;
    }
    setState(() {
      _foldSelectedCommand = selectedCommand as String?;
      _foldModalOpen = modalOpen;
      _foldNavigationAvailable = navigationAvailable;
      _foldLandingAvailable = landingAvailable;
      _foldSignInAvailable = signInAvailable;
      _foldCreatorAvailable = creatorAvailable;
      _foldCreatorStep = creatorStep as String?;
      _foldCreatorNextLabel = creatorNextLabel as String?;
      _foldCreatorBackLabel = creatorBackLabel as String?;
    });
    return true;
  }

  Future<void> _syncFoldNavigation() async {
    final controller = _controller;
    if (!_gameDocumentReady || controller == null) return;
    final enabled = (_tabletopMode || _bookMode) ? 'true' : 'false';
    final commands = jsonEncode(TabletopCommandDeck.commandKeys);
    try {
      await controller.evaluateJavascript(
        source:
            '''
        (() => {
          const tabletopCommands = $commands;
          const root = document.documentElement;
          if (!root) return;
          let style = document.getElementById('shinobi-native-fold-style');
          if (!style) {
            style = document.createElement('style');
            style.id = 'shinobi-native-fold-style';
            style.textContent = 'html[data-shinobi-fold-navigation="true"] .mobile-bottom-nav { display: none !important; }';
            document.head.appendChild(style);
          }
          root.dataset.shinobiFoldNavigation = $enabled ? 'true' : 'false';
          const previousObserver = window.__shinobiFoldNavigationObserver;
          if (previousObserver) previousObserver.disconnect();
          if (!$enabled) return;
          let lastState = '';
          const report = () => {
            const commandButtons = tabletopCommands.map(command =>
              document.querySelector('.mobile-bottom-nav .mobile-nav-btn[data-tabletop-command="' + command + '"]')
            );
            const selectedCommand = tabletopCommands.find((command, index) =>
              commandButtons[index]?.getAttribute('aria-current') === 'page'
            ) ?? null;
            const navigationAvailable = commandButtons.every(button => button !== null);
            const landing = document.querySelector('#landing-home');
            const landingAvailable = !!(
              landing?.querySelector('.landing-hero-actions .landing-cta--primary') &&
              landing?.querySelector('.landing-hero-actions .landing-cta--ghost') &&
              landing?.querySelector('.landing-utility button')
            );
            const signIn = document.querySelector('.landing-login-screen .login-gate');
            const signInAvailable = !!signIn;
            const creator = document.querySelector('.cc-flow');
            const creatorStep = creator?.querySelector('.cc-progress-step[aria-current="step"]')?.textContent?.trim() ?? null;
            const creatorNextLabel = creator?.querySelector('.cc-primary')?.textContent?.trim() ?? null;
            const creatorBackLabel = creator?.querySelector('.cc-back-link')?.textContent?.trim() ?? null;
            const creatorAvailable = !!(creator && creatorStep && creatorNextLabel && creatorBackLabel);
            const modalOpen = [...document.querySelectorAll('[aria-modal="true"]')].some(element => {
              const rect = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
            });
            const state = JSON.stringify({ selectedCommand, modalOpen, navigationAvailable, landingAvailable, signInAvailable, creatorAvailable, creatorStep, creatorNextLabel, creatorBackLabel });
            if (state === lastState) return;
            lastState = state;
            window.flutter_inappwebview?.callHandler('shinobiFoldNavigationState', {
              selectedCommand,
              modalOpen,
              navigationAvailable,
              landingAvailable,
              signInAvailable,
              creatorAvailable,
              creatorStep,
              creatorNextLabel,
              creatorBackLabel
            });
          };
          const observer = new MutationObserver(report);
          observer.observe(document.documentElement, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['aria-current', 'aria-modal', 'class', 'style']
          });
          window.__shinobiFoldNavigationObserver = observer;
          report();
        })();
      ''',
      );
    } catch (_) {
      // A renderer reload or navigation can race this best-effort state sync.
      // The next page load reinstalls it without affecting gameplay.
    }
  }

  void _activateFoldCommand(String commandKey) {
    final controller = _controller;
    if ((!_tabletopMode && !_bookMode) ||
        !_foldNavigationAvailable ||
        _foldModalOpen ||
        controller == null ||
        !TabletopCommandDeck.commandKeys.contains(commandKey)) {
      return;
    }
    unawaited(
      controller.evaluateJavascript(
        source:
            '''
      (() => {
        const button = document.querySelector(
          '.mobile-bottom-nav .mobile-nav-btn[data-tabletop-command="$commandKey"]'
        );
        button?.click();
      })();
    ''',
      ),
    );
  }

  void _activateBookLandingAction(String actionKey) {
    final controller = _controller;
    const selectors = <String, String>{
      'begin': '.landing-hero-actions .landing-cta--primary',
      'explore': '.landing-hero-actions .landing-cta--ghost',
      'login': '.landing-utility button',
      'back': '.landing-login-screen .landing-login-back',
    };
    final selector = selectors[actionKey];
    if (!_bookMode ||
        (!_foldLandingAvailable && !_foldSignInAvailable) ||
        controller == null ||
        selector == null) {
      return;
    }
    unawaited(
      controller.evaluateJavascript(
        source:
            '''
          (() => {
            const scope = '$actionKey' === 'back'
              ? document
              : document.querySelector('#landing-home');
            scope?.querySelector('$selector')?.click();
          })();
        ''',
      ),
    );
  }

  void _activateBookCreatorAction(String actionKey) {
    final controller = _controller;
    final selector = actionKey == 'next'
        ? '.cc-flow .cc-primary'
        : actionKey == 'back'
        ? '.cc-flow .cc-back-link'
        : null;
    if (!_bookMode ||
        !_foldCreatorAvailable ||
        controller == null ||
        selector == null) {
      return;
    }
    unawaited(
      controller.evaluateJavascript(
        source: '''
          (() => document.querySelector('$selector')?.click())();
        ''',
      ),
    );
  }

  Future<void> _handleNativePlayRewardsEvent(MethodCall call) async {
    if (call.method != 'onRewardPurchases' || call.arguments is! List) return;
    for (final value in call.arguments as List) {
      if (value is! Map) continue;
      final receipt = Map<String, dynamic>.from(value);
      final productId = receipt['productId'];
      final purchaseToken = receipt['purchaseToken'];
      if (productId is! String ||
          purchaseToken is! String ||
          productId.isEmpty ||
          purchaseToken.isEmpty) {
        continue;
      }
      final duplicate = _queuedPlayRewardPurchases.any(
        (item) =>
            item['productId'] == productId &&
            item['purchaseToken'] == purchaseToken,
      );
      if (!duplicate) {
        _queuedPlayRewardPurchases.add({
          'productId': productId,
          'purchaseToken': purchaseToken,
        });
      }
    }
    await _flushPlayRewardPurchases();
  }

  Future<void> _flushPlayRewardPurchases() async {
    final controller = _controller;
    if (!_gameDocumentReady ||
        controller == null ||
        _queuedPlayRewardPurchases.isEmpty) {
      return;
    }
    final payload = jsonEncode(
      List<Map<String, String>>.of(_queuedPlayRewardPurchases),
    );
    try {
      await controller.evaluateJavascript(
        source:
            'window.dispatchEvent(new CustomEvent("shinobiPlayRewardPurchases", { detail: $payload }));',
      );
      _queuedPlayRewardPurchases.clear();
    } catch (_) {
      // Keep the receipts queued; the next page load or app foreground retries.
    }
  }

  Future<dynamic> _handlePlayGamesRequest(List<dynamic> args) async {
    if (args.isEmpty || args.first is! Map) return {'available': false};
    final request = Map<String, dynamic>.from(args.first as Map);
    final action = request['action'];
    try {
      switch (action) {
        case 'status':
          return await _playGamesChannel.invokeMethod<Map<dynamic, dynamic>>(
                'status',
              ) ??
              {'available': false};
        case 'unlockAchievement':
          final key = request['key'];
          if (key is! String || key.isEmpty) return {'available': false};
          return await _playGamesChannel.invokeMethod<Map<dynamic, dynamic>>(
                'unlockAchievement',
                {'key': key},
              ) ??
              {'available': false};
        case 'recordEvent':
          final key = request['key'];
          final properties = request['properties'];
          if (key is! String || key.isEmpty || properties is! Map) {
            return {'available': false};
          }
          return await _playGamesChannel.invokeMethod<Map<dynamic, dynamic>>(
                'recordEvent',
                {
                  'key': key,
                  'properties': Map<String, dynamic>.from(properties),
                },
              ) ??
              {'available': false};
        case 'showAchievements':
          return await _playGamesChannel.invokeMethod<bool>(
                'showAchievements',
              ) ??
              false;
        default:
          return {'available': false};
      }
    } on PlatformException {
      return {'available': false};
    } catch (_) {
      return {'available': false};
    }
  }

  void _onReceivedError(
    InAppWebViewController c,
    WebResourceRequest request,
    WebResourceError error,
  ) {
    // Only the game document itself failing means "offline". A failed image or
    // API call is the page's business, and reloading for it would throw the
    // player out of a battle.
    if (request.isForMainFrame != true ||
        error.type == WebResourceErrorType.CANCELLED) {
      return;
    }
    if (!mounted) return;
    setState(() {
      _offline = true;
      _splash = false;
    });
  }

  void _onRenderProcessGone(
    InAppWebViewController c,
    RenderProcessGoneDetail detail,
  ) {
    // The renderer is gone and this WebView cannot be used again. Build a new
    // one; the game restores the session from its own storage.
    if (!mounted) return;
    setState(() {
      _controller = null;
      _webViewKey = UniqueKey();
      _splash = true;
    });
  }

  Future<PermissionResponse?> _onPermissionRequest(
    InAppWebViewController c,
    PermissionRequest request,
  ) async {
    // The game needs no camera, microphone or other device permission.
    return PermissionResponse(
      resources: request.resources,
      action: PermissionResponseAction.DENY,
    );
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
    await _controller?.evaluateJavascript(
      source: 'location.replace(${jsonEncode(target.toString())})',
    );
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
      if (!await review.isAvailable().timeout(const Duration(seconds: 5))) {
        return;
      }
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
        content: const Text(
          'The latest Shinobi Journey update is ready. Restart to install it?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Later'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Restart'),
          ),
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
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) unawaited(_onBack());
      },
      child: AnnotatedRegion<SystemUiOverlayStyle>(
        // Android 16 ignores systemNavigationBarColor in enforced
        // edge-to-edge mode. The bottom ColoredBox below paints the nav-area
        // background; disabling contrast enforcement removes the default
        // three-button scrim. Both system bars use light icons over the shell's
        // dark background.
        value: SystemUiOverlayStyle.light.copyWith(
          statusBarIconBrightness: Brightness.light,
          systemNavigationBarColor: ShellConfig.navigationBar,
          systemNavigationBarIconBrightness: Brightness.light,
          systemNavigationBarContrastEnforced: false,
          systemNavigationBarDividerColor: ShellConfig.navigationBar,
        ),
        child: ColoredBox(
          color: ShellConfig.background,
          child: Builder(
            builder: (rootContext) {
              final mediaQuery = MediaQuery.of(rootContext);
              final tabletopFeature = tabletopFeatureFor(mediaQuery);
              final bookFeature = bookFeatureFor(mediaQuery);
              return Stack(
                fit: StackFit.expand,
                children: [
                  DisplayFeatureSubScreen(
                    // Keep the live game surface out of the hinge. Native
                    // commands use the second pane in book and tabletop poses.
                    anchorPoint: Offset.zero,
                    child: Builder(
                      builder: (segmentContext) {
                        // Android 15+ draws every app edge to edge. Paint the bar areas
                        // ourselves and keep the page out of them, using the selected
                        // display segment's adjusted insets on foldables.
                        final bars = MediaQuery.viewPaddingOf(segmentContext);
                        final keyboard = MediaQuery.viewInsetsOf(segmentContext)
                            .bottom;
                        final launchUri = _launchUri;
                        return Column(
                          children: [
                            SizedBox(height: bars.top),
                            Expanded(
                              child: Padding(
                                padding: EdgeInsets.only(
                                  left: bars.left,
                                  right: bars.right,
                                ),
                                child: Stack(
                                  children: [
                                    if (launchUri != null)
                                      InAppWebView(
                                        key: _webViewKey,
                                        initialUrlRequest: URLRequest(
                                          url: WebUri.uri(launchUri),
                                        ),
                                        initialSettings: _settings,
                                        onWebViewCreated: _onWebViewCreated,
                                        shouldOverrideUrlLoading: _onNavigation,
                                        onCreateWindow: _onCreateWindow,
                                        onLoadStop: _onLoadStop,
                                        onReceivedError: _onReceivedError,
                                        onRenderProcessGone:
                                            _onRenderProcessGone,
                                        onPermissionRequest:
                                            _onPermissionRequest,
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
                                              initialSettings:
                                                  InAppWebViewSettings(
                                                    useShouldOverrideUrlLoading:
                                                        true,
                                                  ),
                                              shouldOverrideUrlLoading:
                                                  _onPopupNavigation,
                                              onLoadStart: (c, url) {
                                                if (url != null &&
                                                    url.scheme != 'about') {
                                                  _closePopup();
                                                  unawaited(
                                                    _follow(
                                                      routeFor(
                                                        url,
                                                        isNewWindow: true,
                                                      ),
                                                      url,
                                                    ),
                                                  );
                                                }
                                              },
                                            ),
                                          ),
                                        ),
                                      ),
                                    if (_offline)
                                      _OfflineScreen(onRetry: _retry),
                                    if (_splash) const _SplashScreen(),
                                  ],
                                ),
                              ),
                            ),
                            ColoredBox(
                              color: ShellConfig.navigationBar,
                              child: SizedBox(
                                width: double.infinity,
                                height: math.max(bars.bottom, keyboard),
                              ),
                            ),
                          ],
                        );
                      },
                    ),
                  ),
                  if (tabletopFeature != null && _foldNavigationAvailable)
                    Positioned(
                      left: mediaQuery.viewPadding.left,
                      right: mediaQuery.viewPadding.right,
                      top: tabletopFeature.bounds.bottom,
                      bottom: math.max(
                        mediaQuery.viewPadding.bottom,
                        mediaQuery.viewInsets.bottom,
                      ),
                      child: TabletopCommandDeck(
                        selectedCommand: _foldSelectedCommand,
                        modalOpen: _foldModalOpen,
                        onActivate: _activateFoldCommand,
                      ),
                    ),
                  if (bookFeature != null &&
                      _bookMode &&
                      _foldNavigationAvailable)
                    Positioned(
                      left: bookFeature.bounds.right,
                      top: mediaQuery.viewPadding.top,
                      right: mediaQuery.viewPadding.right,
                      bottom: math.max(
                        mediaQuery.viewPadding.bottom,
                        mediaQuery.viewInsets.bottom,
                      ),
                      child: TabletopCommandDeck(
                        axis: Axis.vertical,
                        selectedCommand: _foldSelectedCommand,
                        modalOpen: _foldModalOpen,
                        onActivate: _activateFoldCommand,
                      ),
                    ),
                  if (bookFeature != null &&
                      _bookMode &&
                      !_foldNavigationAvailable &&
                      (_foldLandingAvailable ||
                          _foldSignInAvailable ||
                          _foldCreatorAvailable))
                    Positioned(
                      left: bookFeature.bounds.right,
                      top: mediaQuery.viewPadding.top,
                      right: mediaQuery.viewPadding.right,
                      bottom: math.max(
                        mediaQuery.viewPadding.bottom,
                        mediaQuery.viewInsets.bottom,
                      ),
                      child: BookWelcomeDeck(
                        signIn: _foldSignInAvailable,
                        creator: _foldCreatorAvailable,
                        creatorStep: _foldCreatorStep,
                        creatorNextLabel: _foldCreatorNextLabel,
                        creatorBackLabel: _foldCreatorBackLabel,
                        onActivate: _foldCreatorAvailable
                            ? (action) => _activateBookCreatorAction(
                                action == 'creatorNext' ? 'next' : 'back',
                              )
                            : _activateBookLandingAction,
                      ),
                    ),
                ],
              );
            },
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
                image: AssetImage('assets/splash_mark.webp'),
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
                Text(
                  'You are offline',
                  style: theme.textTheme.headlineSmall,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 12),
                Text(
                  'Shinobi Journey needs a connection to reach your village. Any progress already '
                  'saved is safe on the server — nothing is lost by closing this.',
                  style: theme.textTheme.bodyMedium,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 24),
                FilledButton(
                  onPressed: onRetry,
                  child: const Text('Try again'),
                ),
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
