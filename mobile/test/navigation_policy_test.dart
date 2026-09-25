import 'package:flutter_test/flutter_test.dart';
import 'package:shinobi_app/src/navigation_policy.dart';

const _google = 'https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=x'
    '&redirect_uri=https%3A%2F%2Fshinobijourney.com%2Fapi%2Fauth%2Fgoogle%2Fcallback&state=s&nonce=n';

void main() {
  void expectRoute(String url, NavigationRoute expected, {bool isNewWindow = false, String? why}) {
    expect(routeFor(Uri.parse(url), isNewWindow: isNewWindow), expected, reason: why ?? url);
  }

  group('the game itself loads in the WebView', () {
    test('the launch, a sign-in return, and the offline page retry', () {
      expectRoute('https://shinobijourney.com/?playNative=1&playReview=0', NavigationRoute.load);
      expectRoute('https://shinobijourney.com/?gauth=ok&gticket=abc&playNative=1&playReview=0', NavigationRoute.load);
      expectRoute('https://shinobijourney.com/', NavigationRoute.load);
      expectRoute('https://shinobijourney.com', NavigationRoute.load);
      expectRoute('https://shinobijourney.com/#/village', NavigationRoute.load);
    });

    test('hosts that 301 to the apex are ours too', () {
      expectRoute('https://www.shinobijourney.com/', NavigationRoute.load);
      expectRoute('https://theravensark.com/', NavigationRoute.load);
      expectRoute('https://WWW.TheRavensArk.com/', NavigationRoute.load);
    });
  });

  group('documents never replace the running game', () {
    test('legal pages open over the game in a Custom Tab', () {
      for (final path in ['/terms', '/privacy', '/cookies', '/delete-account', '/privacy-request']) {
        expectRoute('https://shinobijourney.com$path', NavigationRoute.customTab);
      }
    });

    test('so do API links and static files a player might post', () {
      expectRoute('https://shinobijourney.com/api/health', NavigationRoute.customTab);
      expectRoute('https://shinobijourney.com/offline.html', NavigationRoute.customTab);
    });

    test('a new window never loads in the game, even for the game itself', () {
      expectRoute('https://shinobijourney.com/terms', NavigationRoute.customTab, isNewWindow: true);
      expectRoute('https://shinobijourney.com/', NavigationRoute.customTab, isNewWindow: true);
    });
  });

  group('Google sign-in', () {
    test('our own authorize request goes to the Auth Tab', () {
      expectRoute(_google, NavigationRoute.googleSignIn);
    });

    test('someone else\'s Google sign-in, or any other Google page, is just a foreign site', () {
      expectRoute(_google.replaceAll('shinobijourney.com', 'evil.example'), NavigationRoute.external);
      expectRoute('https://accounts.google.com/o/oauth2/v2/auth', NavigationRoute.external);
      expectRoute('https://accounts.google.com/signin', NavigationRoute.external);
    });
  });

  group('Play payments policy', () {
    test('no Tebex checkout, from the page or a new window', () {
      expectRoute('https://checkout.tebex.io/checkout/abc', NavigationRoute.block);
      expectRoute('https://headless.tebex.io/api', NavigationRoute.block);
      expectRoute('https://tebex.io/', NavigationRoute.block);
      expectRoute('https://checkout.tebex.io/checkout/abc', NavigationRoute.block, isNewWindow: true);
    });
  });

  group('everything else', () {
    test('foreign sites and mail go to other apps', () {
      expectRoute('https://discord.gg/usr3vzykBh', NavigationRoute.external);
      expectRoute('https://discord.gg/usr3vzykBh', NavigationRoute.external, isNewWindow: true);
      expectRoute('http://example.com/', NavigationRoute.external);
      expectRoute('mailto:support@shinobijourney.com', NavigationRoute.external);
    });

    test('the website\'s review request, in both forms', () {
      expectRoute('intent://review#Intent;scheme=shinobijourney;package=com.shinobijourney.app;end', NavigationRoute.review);
      expectRoute('shinobijourney://review', NavigationRoute.review);
    });

    test('web content can never fire an arbitrary Android intent', () {
      expectRoute('intent://scan#Intent;scheme=zxing;package=com.google.zxing.client.android;end', NavigationRoute.block);
      expectRoute('intent://review#Intent;scheme=shinobijourney;package=com.someone.else;end', NavigationRoute.block);
      expectRoute('shinobijourney://auth?gauth=ok&gticket=abc', NavigationRoute.block,
          why: 'the auth return only ever arrives through the Auth Tab, never from the page');
    });

    test('odd schemes are refused', () {
      for (final url in ['about:blank', 'javascript:alert(1)', 'data:text/html,hi', 'file:///sdcard/x', 'market://details?id=x', 'tel:123']) {
        expectRoute(url, NavigationRoute.block);
      }
    });
  });
}
