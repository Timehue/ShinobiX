const STORAGE_KEY = 'displayBrightness.v1';

export const BRIGHTNESS_MIN = 70;
export const BRIGHTNESS_DEFAULT = 100;
export const BRIGHTNESS_MAX = 160;

function clampBrightness(level: number): number {
    if (!Number.isFinite(level)) return BRIGHTNESS_DEFAULT;
    return Math.min(BRIGHTNESS_MAX, Math.max(BRIGHTNESS_MIN, Math.round(level)));
}

/**
 * The art and UI sit near black, and brightness() alone only multiplies: black
 * stays black. Going lighter also eases contrast first, which lifts the shadows.
 * The default returns 'none' so a player who never moves the slider pays nothing.
 */
export function brightnessFilter(level: number): string {
    const clamped = clampBrightness(level);
    if (clamped === BRIGHTNESS_DEFAULT) return 'none';
    const brightness = clamped / 100;
    if (clamped < BRIGHTNESS_DEFAULT) return `brightness(${brightness})`;
    const contrast = 1 - (brightness - 1) * 0.35;
    return `contrast(${contrast.toFixed(3)}) brightness(${brightness})`;
}

export function getDisplayBrightness(): number {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored === null ? BRIGHTNESS_DEFAULT : clampBrightness(Number(stored));
    } catch { return BRIGHTNESS_DEFAULT; }
}

// On <html> because the root is the one element whose filter does not become the
// containing block for position: fixed, and the game's overlays depend on that.
export function applyDisplayBrightness(level = getDisplayBrightness()): void {
    const filter = brightnessFilter(level);
    document.documentElement.style.filter = filter === 'none' ? '' : filter;
}

export function setDisplayBrightness(level: number): void {
    const clamped = clampBrightness(level);
    try { localStorage.setItem(STORAGE_KEY, String(clamped)); } catch { /* private mode */ }
    applyDisplayBrightness(clamped);
}
