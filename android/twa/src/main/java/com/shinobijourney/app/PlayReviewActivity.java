package com.shinobijourney.app;

import android.app.Activity;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import com.google.android.play.core.review.ReviewManager;
import com.google.android.play.core.review.ReviewManagerFactory;

/** Transparent, short-lived activity over the existing TWA. Never reloads the
 * game, asks for stars, or promises that Google's quota will display a card. */
public class PlayReviewActivity extends Activity {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean requested;
    private boolean resumed;
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        Uri uri = getIntent().getData();
        if (state != null || uri == null || !"shinobijourney".equals(uri.getScheme()) || !"review".equals(uri.getHost())) { finish(); return; }
    }
    @Override protected void onResume() {
        super.onResume();
        resumed = true;
        if (requested || isFinishing()) return;
        requested = true;
        SharedPreferences prefs = getSharedPreferences("play-experience", MODE_PRIVATE);
        long now = System.currentTimeMillis();
        if (!PlayExperiencePolicy.reviewDue(now, prefs.getLong("reviewPrompt", 0), prefs.getInt("sessions", 0))) { finish(); return; }
        ReviewManager manager = ReviewManagerFactory.create(this);
        // Only the request has a timeout. Once a review card is shown, Google
        // and the player own its lifetime; never dismiss it programmatically.
        handler.postDelayed(this::finish, 5000);
        manager.requestReviewFlow().addOnCompleteListener(task -> {
            if (isFinishing() || isDestroyed()) return;
            handler.removeCallbacksAndMessages(null);
            if (!task.isSuccessful() || !resumed) { finish(); return; }
            prefs.edit().putLong("reviewPrompt", now).apply();
            manager.launchReviewFlow(this, task.getResult()).addOnCompleteListener(result -> finish());
        });
    }
    @Override protected void onPause() { resumed = false; super.onPause(); }
    @Override protected void onDestroy() { handler.removeCallbacksAndMessages(null); super.onDestroy(); }
}
