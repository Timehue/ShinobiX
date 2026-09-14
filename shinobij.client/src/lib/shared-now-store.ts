// One display-only clock for mounted countdowns. No game state is settled here.
let now = Date.now();
const listeners = new Set<() => void>();
let interval: number | null = null;

function tick() {
    now = Date.now();
    listeners.forEach(listener => listener());
}

function stopTicker() {
    if (interval !== null) window.clearInterval(interval);
    interval = null;
}

function onVisibility() {
    stopTicker();
    if (document.hidden || listeners.size === 0) return;
    tick();
    interval = window.setInterval(tick, 1000);
}

export function getSharedNow(): number { return now; }

export function subscribeSharedNow(listener: () => void): () => void {
    listeners.add(listener);
    if (listeners.size === 1) {
        document.addEventListener('visibilitychange', onVisibility);
        // A remounted timer reads current time, even after hours with no users.
        now = Date.now();
        onVisibility();
    }
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
            stopTicker();
            document.removeEventListener('visibilitychange', onVisibility);
        }
    };
}
