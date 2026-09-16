package com.shinobijourney.app;

/** Deliberately conservative app-level limits, in addition to Google's quota. */
public final class PlayExperiencePolicy {
    public static boolean reviewDue(long now, long last, int sessions) {
        return sessions >= 3 && (last == 0 || now - last >= 90L * 24 * 60 * 60_000);
    }
    public static boolean updateDue(long now, long last) {
        return last == 0 || now - last >= 24L * 60 * 60_000;
    }
    private PlayExperiencePolicy() {}
}
