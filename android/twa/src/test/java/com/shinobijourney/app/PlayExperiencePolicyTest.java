package com.shinobijourney.app;
import org.junit.Test;
import static org.junit.Assert.*;

public class PlayExperiencePolicyTest {
    @Test public void reviewWaitsForExperienceAndRespectsNinetyDays() {
        long now = 100L * 24 * 60 * 60_000;
        assertFalse(PlayExperiencePolicy.reviewDue(now, 0, 2));
        assertTrue(PlayExperiencePolicy.reviewDue(now, 0, 3));
        assertFalse(PlayExperiencePolicy.reviewDue(now, now - 89L * 24 * 60 * 60_000, 3));
        assertTrue(PlayExperiencePolicy.reviewDue(now, now - 90L * 24 * 60 * 60_000, 3));
        assertFalse(PlayExperiencePolicy.reviewDue(now, now + 1, 3));
    }
    @Test public void updateCancellationIsRespectedForADay() {
        long now = 100L * 24 * 60 * 60_000;
        assertTrue(PlayExperiencePolicy.updateDue(now, 0));
        assertFalse(PlayExperiencePolicy.updateDue(now, now - 1000));
        assertTrue(PlayExperiencePolicy.updateDue(now, now - 24L * 60 * 60_000));
    }
}
