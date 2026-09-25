/**
 * "Slow down" notices — a server rate-limit refusal (or a momentary save-lock
 * "retry") surfaced through alert().
 *
 * These are never worth a blocking modal: the player only has to wait a moment,
 * and a burst of refused requests used to stack a queue of identical "Rate limit
 * exceeded." dialogs to click through. GameAlert routes a matching message to a
 * quiet toast instead, and drops a REPEAT of the same message within
 * SLOW_DOWN_TOAST_GAP_MS — a different feature's notice still shows. Every other
 * alert (a real error, a refusal the player must read) keeps its modal, and so
 * does any multi-line message, which carries detail that must not be squashed.
 *
 * Matches the server's rate-limit wording (api/_ratelimit.ts rateLimitBody, plus
 * the older "Rate limit exceeded."), the client's own paraphrases of a 429
 * ("Too many exploration requests…", "…busy (rate limited)…"), and the transient
 * save-lock replies that only ask for a retry. scripts/slow-down-notice-contract
 * .test.mjs fails if the server wording stops matching.
 */
const SLOW_DOWN_PATTERN = /this action is temporarily unavailable\. try again in|going a little fast|rate limit exceeded|too many (?:[a-z-]+ )?requests|\(rate limited\)|concurrent save in flight|change is saving\. retry/i;

export const SLOW_DOWN_TOAST_GAP_MS = 20_000;

export function isSlowDownNotice(message: string): boolean {
    return SLOW_DOWN_PATTERN.test(message);
}

/** The same notice with a different countdown ("…in 3s" / "…in 4s") is still a repeat. */
function noticeKey(message: string): string {
    return message.replace(/\d+/g, "#").trim().toLowerCase();
}

export type AlertRoute = "modal" | "toast" | "drop";

/**
 * Decide how GameAlert shows `message` at `now`. Keeps its own clock per notice
 * so it is testable without React.
 */
export function createAlertRouter(gapMs = SLOW_DOWN_TOAST_GAP_MS) {
    const lastShownAt = new Map<string, number>();
    return (message: string, now: number): AlertRoute => {
        if (message.includes("\n") || !isSlowDownNotice(message)) return "modal";
        const key = noticeKey(message);
        if (now - (lastShownAt.get(key) ?? Number.NEGATIVE_INFINITY) < gapMs) return "drop";
        lastShownAt.set(key, now);
        // Bounded: a handful of distinct notices exist; forget stale ones.
        if (lastShownAt.size > 32) for (const [k, at] of lastShownAt) if (now - at >= gapMs) lastShownAt.delete(k);
        return "toast";
    };
}
