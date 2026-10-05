import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'shell_config.dart';

/// Deliberately conservative app-level limits, on top of Google's own quotas.
/// A straight port of the old TWA's PlayExperiencePolicy.java, with the same
/// thresholds, so moving shells changes nothing a player notices.
abstract final class PlayExperiencePolicy {
  static const String _debugGameUrl = String.fromEnvironment('SJ_DEBUG_GAME_URL');
  static const Set<String> _debugLoopbackHosts = {
    'localhost',
    '127.0.0.1',
    '::1',
    '10.0.2.2',
    '10.0.3.2',
  };
  static const int _minute = 60 * 1000;
  static const int _day = 24 * 60 * _minute;

  /// Launches or returns closer together than this count as one session.
  static const int sessionGapMs = 30 * _minute;

  /// Ask for a review only after three separate sessions, and at most once
  /// every 90 days. A clock that moved backwards never counts as "due".
  static bool reviewDue({required int now, required int last, required int sessions}) =>
      sessions >= 3 && (last == 0 || now - last >= 90 * _day);

  /// A declined update is not offered again for a day.
  static bool updateDue({required int now, required int last}) => last == 0 || now - last >= _day;

  static bool startsNewSession({required int now, required int lastSession}) =>
      now - lastSession > sessionGapMs;

  /// The game URL this shell opens. `playNative=1` tells the website the
  /// native review hand-off exists; `playReview` says whether this session may
  /// use it (shinobij.client/src/lib/native-play.ts).
  static Uri launchUri({required bool reviewDue}) => resolveLaunchUri(
        reviewDue: reviewDue,
        debugMode: kDebugMode,
        debugGameUrl: _debugGameUrl,
      );

  /// Resolves the shell URL without letting a release build leave production.
  /// The override exists so Android WebView checks can exercise the current
  /// local client without deploying it or touching a live player account.
  @visibleForTesting
  static Uri resolveLaunchUri({
    required bool reviewDue,
    required bool debugMode,
    required String debugGameUrl,
  }) {
    final override = debugMode ? _loopbackDebugUri(debugGameUrl) : null;
    final uri = override ?? Uri.https(ShellConfig.host, '/');
    final query = Map<String, String>.of(uri.queryParameters)
      ..['playNative'] = '1'
      ..['playReview'] = reviewDue ? '1' : '0';
    return uri.replace(queryParameters: query);
  }

  static Uri? _loopbackDebugUri(String raw) {
    final uri = Uri.tryParse(raw.trim());
    if (uri == null || uri.scheme != 'http' || uri.userInfo.isNotEmpty || !uri.hasAuthority) return null;
    if (!_debugLoopbackHosts.contains(uri.host.toLowerCase())) return null;
    return uri;
  }
}

/// The policy's counters, kept in SharedPreferences.
///
/// The old TWA kept these in its own Android preferences file, which this app
/// cannot read, so every player's counters start again at zero once. The only
/// effect is that the first review prompt waits for three new sessions.
class PlayExperienceStore {
  PlayExperienceStore(this._prefs);

  static Future<PlayExperienceStore> open() async => PlayExperienceStore(await SharedPreferences.getInstance());

  final SharedPreferences _prefs;

  static const String _sessions = 'playExperience.sessions';
  static const String _lastSession = 'playExperience.lastSession';
  static const String _reviewPrompt = 'playExperience.reviewPrompt';
  static const String _updatePrompt = 'playExperience.updatePrompt';

  int get sessions => _prefs.getInt(_sessions) ?? 0;

  /// Count a launch or a return to the app. The TWA counted every launcher
  /// tap; a Flutter app is usually resumed rather than relaunched, so resumes
  /// count too, with the same 30-minute gap.
  Future<void> countSession(int now) async {
    if (!PlayExperiencePolicy.startsNewSession(now: now, lastSession: _prefs.getInt(_lastSession) ?? 0)) return;
    await _prefs.setInt(_lastSession, now);
    await _prefs.setInt(_sessions, sessions + 1);
  }

  bool reviewDue(int now) =>
      PlayExperiencePolicy.reviewDue(now: now, last: _prefs.getInt(_reviewPrompt) ?? 0, sessions: sessions);

  Future<void> recordReview(int now) => _prefs.setInt(_reviewPrompt, now);

  bool updateDue(int now) => PlayExperiencePolicy.updateDue(now: now, last: _prefs.getInt(_updatePrompt) ?? 0);

  Future<void> recordUpdatePrompt(int now) => _prefs.setInt(_updatePrompt, now);
}
