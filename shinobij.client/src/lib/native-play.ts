const REVIEW_GAP_MS = 90 * 24 * 60 * 60_000;
const REVIEW_KEY = 'shinobij:play-review-v1';

export function reviewMilestoneEligible(input: { native: boolean; visible: boolean; activated: boolean; level: number; wins: number; now: number; last: number }): boolean {
    return input.native && input.visible && input.activated && input.level >= 5 && input.wins >= 3
        && (input.last === 0 || input.now - input.last >= REVIEW_GAP_MS);
}

/** Called synchronously by Continue after a verified win; never during combat,
 * from a timer, or as a promise that a rating card will be displayed. */
export function maybeRequestPlayReview(level: number): void {
    if (typeof window === 'undefined') return;
    try {
        const native = /Android/i.test(navigator.userAgent)
            && new URL(location.href).searchParams.get('playNative') === '1'
            && new URL(location.href).searchParams.get('playReview') === '1'
            && matchMedia('(display-mode: standalone)').matches;
        if (!native) return;
        const raw = JSON.parse(localStorage.getItem(REVIEW_KEY) || '{}') as { wins?: number; last?: number };
        const wins = Math.max(0, Number(raw.wins) || 0) + 1;
        const last = Math.max(0, Number(raw.last) || 0);
        const now = Date.now();
        const eligible = reviewMilestoneEligible({ native, visible: document.visibilityState === 'visible', activated: navigator.userActivation?.isActive === true, level, wins, now, last });
        localStorage.setItem(REVIEW_KEY, JSON.stringify({ wins, last: eligible ? now : last }));
        if (eligible) location.href = 'intent://review#Intent;scheme=shinobijourney;package=com.shinobijourney.app;end';
    } catch { /* Storage restrictions / unavailable native handler must not block Continue. */ }
}
