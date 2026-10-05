const MAX_EARLY_BATCHES = 16;
const MAX_RECEIPTS_PER_BATCH = 16;

/** Small, eager receipt buffer so the native bridge can flush during WebView boot. */
export function createPlayRewardEventInbox() {
    const batches: unknown[][] = [];
    let handedOff = false;

    return {
        capture(detail: unknown): void {
            if (handedOff || !Array.isArray(detail) || batches.length >= MAX_EARLY_BATCHES) return;
            batches.push(detail.slice(0, MAX_RECEIPTS_PER_BATCH));
        },
        take(): unknown[][] {
            handedOff = true;
            return batches.splice(0, batches.length);
        },
    };
}

const inbox = createPlayRewardEventInbox();
if (typeof window !== "undefined") {
    window.addEventListener("shinobiPlayRewardPurchases", (event) => {
        if (event instanceof CustomEvent) inbox.capture(event.detail);
    });
}

export function takeEarlyPlayRewardEvents(): unknown[][] {
    return inbox.take();
}
