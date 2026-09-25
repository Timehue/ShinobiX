import 'package:flutter_test/flutter_test.dart';
import 'package:in_app_update/in_app_update.dart';
import 'package:shinobi_app/src/app_update.dart';

UpdatePlan plan({
  UpdateAvailability availability = UpdateAvailability.updateAvailable,
  InstallStatus installStatus = InstallStatus.unknown,
  int priority = 0,
  bool immediateAllowed = true,
  bool flexibleAllowed = true,
  bool promptDue = true,
}) =>
    planUpdate(
      availability: availability,
      installStatus: installStatus,
      priority: priority,
      immediateAllowed: immediateAllowed,
      flexibleAllowed: flexibleAllowed,
      promptDue: promptDue,
    );

void main() {
  test('an ordinary update downloads in the background', () {
    expect(plan(), UpdatePlan.flexible);
  });

  test('priority 4 and up blocks play until updated', () {
    expect(plan(priority: 3), UpdatePlan.flexible);
    expect(plan(priority: 4), UpdatePlan.immediate);
    expect(plan(priority: 5), UpdatePlan.immediate);
  });

  test('a finished download is offered as a restart before anything else', () {
    expect(plan(installStatus: InstallStatus.downloaded, availability: UpdateAvailability.updateNotAvailable),
        UpdatePlan.offerRestart);
  });

  test('nothing happens without an update, or when Play does not allow the type', () {
    expect(plan(availability: UpdateAvailability.updateNotAvailable), UpdatePlan.none);
    expect(plan(availability: UpdateAvailability.unknown), UpdatePlan.none);
    expect(plan(flexibleAllowed: false), UpdatePlan.none);
    expect(plan(priority: 4, immediateAllowed: false), UpdatePlan.none);
  });

  test('a declined update waits a day, but an accepted immediate update always resumes', () {
    expect(plan(promptDue: false), UpdatePlan.none);
    expect(plan(priority: 4, promptDue: false), UpdatePlan.none);
    expect(plan(availability: UpdateAvailability.developerTriggeredUpdateInProgress, promptDue: false),
        UpdatePlan.immediate);
  });
}
