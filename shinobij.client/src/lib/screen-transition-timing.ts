export interface ScreenTransitionRecord {
    from: string;
    to: string;
    ms: number;
}

export interface ScreenTransitionTracker {
    readyScreen: string;
    pendingScreen: string;
    pendingFrom: string;
    pendingAt: number;
}

export function createScreenTransitionTracker(): ScreenTransitionTracker {
    return { readyScreen: "", pendingScreen: "", pendingFrom: "", pendingAt: 0 };
}

/** Mark navigation intent (or the first committed loading fallback). */
export function startScreenTransition(
    tracker: ScreenTransitionTracker,
    screen: string,
    at: number,
): void {
    if (tracker.readyScreen === screen || tracker.pendingScreen === screen) return;
    tracker.pendingScreen = screen;
    tracker.pendingFrom = tracker.readyScreen;
    tracker.pendingAt = at;
}

/** Mark real screen content committed inside Suspense, not merely its fallback. */
export function completeScreenTransition(
    tracker: ScreenTransitionTracker,
    screen: string,
    at: number,
): ScreenTransitionRecord | null {
    let record: ScreenTransitionRecord | null = null;
    if (
        tracker.pendingScreen === screen &&
        tracker.pendingFrom &&
        tracker.pendingFrom !== screen
    ) {
        record = {
            from: tracker.pendingFrom,
            to: screen,
            ms: Math.max(0, Math.round(at - tracker.pendingAt)),
        };
    }

    tracker.readyScreen = screen;
    tracker.pendingScreen = "";
    tracker.pendingFrom = "";
    tracker.pendingAt = 0;
    return record;
}
