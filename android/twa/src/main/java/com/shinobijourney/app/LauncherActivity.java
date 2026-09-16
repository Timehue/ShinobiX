package com.shinobijourney.app;

import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import com.google.android.play.core.appupdate.AppUpdateManager;
import com.google.android.play.core.appupdate.AppUpdateManagerFactory;
import com.google.android.play.core.appupdate.AppUpdateOptions;
import com.google.android.play.core.install.model.AppUpdateType;
import com.google.android.play.core.install.model.InstallStatus;
import com.google.android.play.core.install.model.UpdateAvailability;

/** Play checks run before gameplay. A network or Play failure never blocks launch. */
public class LauncherActivity extends com.google.androidbrowserhelper.trusted.LauncherActivity {
    private static final int UPDATE_REQUEST = 4107;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable launchFallback = this::openGame;
    private boolean launched;
    private boolean prompting;
    private boolean resumed;
    private boolean launchPending;
    private AppUpdateManager updates;

    @Override protected boolean shouldLaunchImmediately() { return false; }

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (isFinishing()) return;
        SharedPreferences prefs = getSharedPreferences("play-experience", MODE_PRIVATE);
        long now = System.currentTimeMillis();
        if (now - prefs.getLong("lastSession", 0) > 30 * 60_000L) {
            prefs.edit().putLong("lastSession", now).putInt("sessions", prefs.getInt("sessions", 0) + 1).apply();
        }
        updates = AppUpdateManagerFactory.create(this);
        handler.postDelayed(launchFallback, 3500);
        updates.getAppUpdateInfo().addOnSuccessListener(info -> {
            if (launched || isFinishing() || isDestroyed()) return;
            if (!resumed) { openGame(); return; }
            if (info.installStatus() == InstallStatus.DOWNLOADED) {
                prompting = true;
                handler.removeCallbacks(launchFallback);
                new AlertDialog.Builder(this).setTitle("Update ready")
                    .setMessage("The latest Shinobi Journey update is ready. Restart to install it?")
                    .setPositiveButton("Restart", (dialog, which) -> {
                        updates.completeUpdate().addOnFailureListener(error -> { prompting = false; openGame(); });
                    })
                    .setNegativeButton("Later", (dialog, which) -> { prompting = false; openGame(); })
                    .setOnCancelListener(dialog -> { prompting = false; openGame(); }).show();
                return;
            }
            boolean resumeImmediate = info.updateAvailability() == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS;
            if (!resumeImmediate && info.updateAvailability() != UpdateAvailability.UPDATE_AVAILABLE) { openGame(); return; }
            int type = (resumeImmediate || info.updatePriority() >= 4) ? AppUpdateType.IMMEDIATE : AppUpdateType.FLEXIBLE;
            if (!info.isUpdateTypeAllowed(type)) { openGame(); return; }
            // A cancellation is respected for the day. A previously accepted
            // immediate update must still resume regardless of this cooldown.
            long last = prefs.getLong("updatePrompt", 0);
            if (!resumeImmediate && !PlayExperiencePolicy.updateDue(now, last)) { openGame(); return; }
            try {
                prompting = true;
                handler.removeCallbacks(launchFallback);
                boolean started = updates.startUpdateFlowForResult(info, this, AppUpdateOptions.newBuilder(type).build(), UPDATE_REQUEST);
                if (started) prefs.edit().putLong("updatePrompt", now).apply();
                else { prompting = false; openGame(); }
            } catch (Exception error) { prompting = false; openGame(); }
        }).addOnFailureListener(error -> openGame());
    }

    private void openGame() {
        if (launched || prompting || isFinishing() || isDestroyed()) return;
        if (!resumed) { launchPending = true; return; }
        launched = true;
        handler.removeCallbacks(launchFallback);
        launchTwa();
    }

    @Override protected void onResume() {
        super.onResume();
        resumed = true;
        if (launchPending) { launchPending = false; openGame(); }
    }
    @Override protected void onPause() { resumed = false; super.onPause(); }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == UPDATE_REQUEST) { prompting = false; openGame(); }
    }
    @Override protected void onDestroy() { handler.removeCallbacksAndMessages(null); super.onDestroy(); }

    @Override protected Uri getLaunchingUrl() {
        Uri url = super.getLaunchingUrl();
        // Feature handshake: older wrappers never advertise the native review
        // activity, so the deployed website stays compatible with old installs.
        if ("https".equals(url.getScheme()) && "shinobijourney.com".equals(url.getHost())) {
            Uri.Builder builder = url.buildUpon().clearQuery();
            for (String key : url.getQueryParameterNames()) {
                if (!key.equals("playNative") && !key.equals("playReview")) {
                    for (String value : url.getQueryParameters(key)) builder.appendQueryParameter(key, value);
                }
            }
            SharedPreferences prefs = getSharedPreferences("play-experience", MODE_PRIVATE);
            boolean reviewDue = PlayExperiencePolicy.reviewDue(System.currentTimeMillis(), prefs.getLong("reviewPrompt", 0), prefs.getInt("sessions", 0));
            return builder.appendQueryParameter("playNative", "1").appendQueryParameter("playReview", reviewDue ? "1" : "0").build();
        }
        return url;
    }
}
