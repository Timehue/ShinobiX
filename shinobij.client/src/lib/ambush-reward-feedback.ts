export function ambushRewardFailureMessage(
    result?: { reason?: string; error?: string } | null,
    status?: number,
): string {
    if (result?.reason === "daily-cap") {
        return "Daily ambush reward limit reached. Resets at midnight UTC. Your pending reward will be retried when you reopen the World Map.";
    }
    if (result?.reason === "incomplete") {
        return "The server has not confirmed all four ambush victories. Complete or resume the ambush before claiming its reward.";
    }
    if (result?.reason === "none") return "No unclaimed ambush reward was found.";
    if (status === 401) return "Sign in again, then reopen the World Map to recover your ambush reward.";
    if (result?.error) return result.error;
    return "The ambush reward could not be confirmed. Reopen the World Map to retry.";
}
