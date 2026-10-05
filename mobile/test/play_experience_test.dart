import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:shinobi_app/src/play_experience.dart';

const int _day = 24 * 60 * 60 * 1000;

void main() {
  // The same cases as the old TWA's PlayExperiencePolicyTest.java.
  group('policy', () {
    const now = 100 * _day;

    test('a review waits for experience and respects ninety days', () {
      expect(PlayExperiencePolicy.reviewDue(now: now, last: 0, sessions: 2), isFalse);
      expect(PlayExperiencePolicy.reviewDue(now: now, last: 0, sessions: 3), isTrue);
      expect(PlayExperiencePolicy.reviewDue(now: now, last: now - 89 * _day, sessions: 3), isFalse);
      expect(PlayExperiencePolicy.reviewDue(now: now, last: now - 90 * _day, sessions: 3), isTrue);
      expect(PlayExperiencePolicy.reviewDue(now: now, last: now + 1, sessions: 3), isFalse, reason: 'clock moved back');
    });

    test('a declined update is respected for a day', () {
      expect(PlayExperiencePolicy.updateDue(now: now, last: 0), isTrue);
      expect(PlayExperiencePolicy.updateDue(now: now, last: now - 1000), isFalse);
      expect(PlayExperiencePolicy.updateDue(now: now, last: now - _day), isTrue);
    });

    test('the launch URL tells the website whether the review hand-off may run', () {
      expect(PlayExperiencePolicy.launchUri(reviewDue: false).toString(),
          'https://shinobijourney.com/?playNative=1&playReview=0');
      expect(PlayExperiencePolicy.launchUri(reviewDue: true).toString(),
          'https://shinobijourney.com/?playNative=1&playReview=1');
    });

    test('a debug URL can target only a local web server and retains shell flags', () {
      final uri = PlayExperiencePolicy.resolveLaunchUri(
        reviewDue: true,
        debugMode: true,
        debugGameUrl: 'http://127.0.0.1:4173/?scene=stronghold&playNative=0',
      );
      expect(uri.scheme, 'http');
      expect(uri.host, '127.0.0.1');
      expect(uri.port, 4173);
      expect(uri.path, '/');
      expect(uri.queryParameters, {
        'scene': 'stronghold',
        'playNative': '1',
        'playReview': '1',
      });
    });

    test('release and non-loopback debug URLs always fall back to the production game', () {
      for (final (debugMode, candidate) in [
        (false, 'http://127.0.0.1:4173/'),
        (true, 'http://example.com/'),
        (true, 'https://localhost/'),
        (true, 'http://user@localhost/'),
      ]) {
        final uri = PlayExperiencePolicy.resolveLaunchUri(
          reviewDue: false,
          debugMode: debugMode,
          debugGameUrl: candidate,
        );
        expect(uri.toString(), 'https://shinobijourney.com/?playNative=1&playReview=0');
      }
    });
  });

  group('store', () {
    setUp(() => SharedPreferences.setMockInitialValues({}));

    test('launches and returns closer than thirty minutes are one session', () async {
      final store = await PlayExperienceStore.open();
      const start = 100 * _day;
      await store.countSession(start);
      await store.countSession(start + 29 * 60 * 1000);
      expect(store.sessions, 1);
      await store.countSession(start + 31 * 60 * 1000);
      expect(store.sessions, 2);
    });

    test('a review becomes due after three sessions and waits again once shown', () async {
      final store = await PlayExperienceStore.open();
      var now = 100 * _day;
      for (var i = 0; i < 3; i++) {
        await store.countSession(now);
        now += _day;
      }
      expect(store.reviewDue(now), isTrue);
      await store.recordReview(now);
      expect(store.reviewDue(now + 89 * _day), isFalse);
      expect(store.reviewDue(now + 90 * _day), isTrue);
    });

    test('an update prompt is not repeated within a day', () async {
      final store = await PlayExperienceStore.open();
      const now = 100 * _day;
      expect(store.updateDue(now), isTrue);
      await store.recordUpdatePrompt(now);
      expect(store.updateDue(now + 1000), isFalse);
      expect(store.updateDue(now + _day), isTrue);
    });
  });
}
