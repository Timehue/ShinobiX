import 'package:flutter_test/flutter_test.dart';
import 'package:shinobi_app/src/game_recovery.dart';

void main() {
  final launch = Uri.parse('https://shinobijourney.com/?playReviewDue=1');
  final previous = launch.replace(fragment: '/userHub');

  test(
    'retry follows SPA navigation while retaining only trusted launch data',
    () {
      expect(
        gameRecoveryUri(
          launch,
          launch.replace(fragment: '/battleTowers'),
          previous,
        ),
        launch.replace(fragment: '/battleTowers'),
      );
      expect(
        gameRecoveryUri(
          launch,
          Uri.parse('https://shinobijourney.com/#/worldMap'),
          previous,
        ),
        launch.replace(fragment: '/worldMap'),
      );
      expect(
        gameRecoveryUri(launch, launch.removeFragment(), previous),
        launch,
      );
      expect(
        gameRecoveryUri(launch, launch.replace(fragment: '/start'), previous),
        launch,
      );
    },
  );

  test(
    'auth returns, documents and foreign navigation cannot replace recovery',
    () {
      for (final value in [
        'https://shinobijourney.com/?code=secret&state=nonce#/profile',
        'https://shinobijourney.com/api/auth/google/callback#/profile',
        'https://shinobijourney.com/legal.html',
        'http://shinobijourney.com/#/profile',
        'https://shinobijourney.com:8443/#/profile',
        'https://foreign.example/#/profile',
        'https://someone@shinobijourney.com/#/profile',
        'https://shinobijourney.com/#/profile?ticket=secret',
        'https://shinobijourney.com/#//foreign.example',
        'about:blank',
        'javascript:alert(1)',
        'file:///profile',
      ]) {
        expect(
          gameRecoveryUri(launch, Uri.parse(value), previous),
          previous,
          reason: value,
        );
      }
      expect(gameRecoveryUri(launch, null, previous), previous);
    },
  );

  test('debug loopback keeps its own origin and navigation', () {
    final local = Uri.parse('http://127.0.0.1:4173/');
    expect(
      gameRecoveryUri(local, local.replace(fragment: '/userHub'), local),
      local.replace(fragment: '/userHub'),
    );
    expect(gameRecoveryUri(local, launch, local), local);
  });
}
