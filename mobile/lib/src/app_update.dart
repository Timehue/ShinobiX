import 'package:in_app_update/in_app_update.dart';

import 'play_experience.dart';

/// What to do about a Play update, decided from what Play reported.
enum UpdatePlan {
  /// Nothing to do, or not allowed right now.
  none,

  /// A flexible update already finished downloading: offer to restart.
  offerRestart,

  /// Block play until updated (priority 4+, or resuming one already accepted).
  immediate,

  /// Download in the background, then offer to restart.
  flexible,
}

/// The same decision the old TWA launcher made (android/twa LauncherActivity),
/// as a pure function so it is covered by test/app_update_test.dart.
UpdatePlan planUpdate({
  required UpdateAvailability availability,
  required InstallStatus installStatus,
  required int priority,
  required bool immediateAllowed,
  required bool flexibleAllowed,
  required bool promptDue,
}) {
  if (installStatus == InstallStatus.downloaded) return UpdatePlan.offerRestart;
  final resumeImmediate = availability == UpdateAvailability.developerTriggeredUpdateInProgress;
  if (!resumeImmediate && availability != UpdateAvailability.updateAvailable) return UpdatePlan.none;
  final immediate = resumeImmediate || priority >= 4;
  if (!(immediate ? immediateAllowed : flexibleAllowed)) return UpdatePlan.none;
  // A player who said "not now" is left alone for a day. An immediate update
  // they already accepted must still resume, cooldown or not.
  if (!resumeImmediate && !promptDue) return UpdatePlan.none;
  return immediate ? UpdatePlan.immediate : UpdatePlan.flexible;
}

/// Check Play for a newer version of this app and act on it.
///
/// Runs alongside the game rather than in front of it: the website is live, so
/// the shell only needs updating for native changes, and a Play or network
/// failure must never keep a player out. Outside a Play install (a local
/// build, a sideload) the check throws, and that is simply ignored.
Future<void> checkForPlayUpdate({
  required PlayExperienceStore store,
  required Future<bool> Function() confirmRestart,
}) async {
  try {
    final info = await InAppUpdate.checkForUpdate();
    final now = DateTime.now().millisecondsSinceEpoch;
    final plan = planUpdate(
      availability: info.updateAvailability,
      installStatus: info.installStatus,
      priority: info.updatePriority,
      immediateAllowed: info.immediateUpdateAllowed,
      flexibleAllowed: info.flexibleUpdateAllowed,
      promptDue: store.updateDue(now),
    );
    switch (plan) {
      case UpdatePlan.none:
        return;
      case UpdatePlan.offerRestart:
        if (await confirmRestart()) await InAppUpdate.completeFlexibleUpdate();
        return;
      case UpdatePlan.immediate:
        await store.recordUpdatePrompt(now);
        await InAppUpdate.performImmediateUpdate();
        return;
      case UpdatePlan.flexible:
        await store.recordUpdatePrompt(now);
        // Completes once the download has finished (or the player declined).
        final result = await InAppUpdate.startFlexibleUpdate();
        if (result == AppUpdateResult.success && await confirmRestart()) {
          await InAppUpdate.completeFlexibleUpdate();
        }
        return;
    }
  } catch (_) {
    // Not installed from Play, offline, or Play declined: play carries on.
  }
}
