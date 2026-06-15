/*
 * Day/night cycle — a single, deterministic source of "time of day" derived from
 * the player's real local clock. It drives the <DayNightSky> tint/vignette
 * overlay and the <SceneCritters> fauna picker (fireflies at night, butterflies
 * by day) so the whole world breathes through dawn → day → dusk → night in step.
 *
 * Pure + side-effect free: $0, no network, no assets, no payload. The clock is
 * only ever read by callers (in effects/intervals), never baked into game state,
 * so two devices in different time zones simply see their own local sky — there
 * is nothing to desync.
 *
 * QA overrides (localStorage, client-only):
 *   dayCycle.v1   = "off"   → force flat daylight (disables the whole overlay)
 *   dayCycle.hour = "21"    → pin the sky to a fixed hour (0–24) for feel-checks
 */

export type DayPhase = "dawn" | "day" | "dusk" | "night";

export interface SkyState {
    /** continuous fractional hour 0–24 this state was derived from */
    hour: number;
    phase: DayPhase;
    /** 0 = full daylight … 1 = deep night. Smooth across dusk/dawn. Gates fauna. */
    night: number;
    /** colour the scene is washed with (paired with `tintAlpha`) */
    tint: string;
    /** strength of the colour wash, 0–1 */
    tintAlpha: number;
    /** extra darkening vignette strength, 0–1 */
    vignette: number;
    /** warm/cool key-light colour (god-rays, glows) */
    light: string;
}

// Colour + strength keyframes around the 24h clock. Everything else is a smooth
// interpolation between the two surrounding frames, so the sky never "pops" at a
// phase boundary. Tuned warm at the edges of day, cool/dark at night.
interface Key { h: number; tint: string; a: number; vig: number; light: string }
const KEYS: Key[] = [
    { h: 0,    tint: "#0a1233", a: 0.46, vig: 0.50, light: "#9fb4ff" }, // deep night
    { h: 5,    tint: "#141a3e", a: 0.42, vig: 0.46, light: "#9fb4ff" }, // pre-dawn
    { h: 6.5,  tint: "#ff9e6b", a: 0.24, vig: 0.22, light: "#ffd2a6" }, // dawn glow
    { h: 8,    tint: "#fff3d6", a: 0.06, vig: 0.10, light: "#fff2cf" }, // morning
    { h: 12,   tint: "#fffaf0", a: 0.00, vig: 0.06, light: "#fff7e0" }, // noon
    { h: 16,   tint: "#fff0d2", a: 0.05, vig: 0.10, light: "#ffeccb" }, // afternoon
    { h: 18,   tint: "#ff8a52", a: 0.27, vig: 0.24, light: "#ffb583" }, // dusk
    { h: 19.5, tint: "#7a3b6e", a: 0.35, vig: 0.37, light: "#d59ad0" }, // twilight
    { h: 21,   tint: "#101a48", a: 0.44, vig: 0.48, light: "#9fb4ff" }, // nightfall
    { h: 24,   tint: "#0a1233", a: 0.46, vig: 0.50, light: "#9fb4ff" }, // wrap → deep night
];

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (a: number, b: number, x: number) => {
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
};

function hexToRgb(hex: string): [number, number, number] {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r: number, g: number, b: number): string {
    const c = (v: number) => Math.round(clamp01(v / 255) * 255).toString(16).padStart(2, "0");
    return `#${c(r)}${c(g)}${c(b)}`;
}
function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}
function lerpHex(a: string, b: string, t: number): string {
    const [r1, g1, b1] = hexToRgb(a);
    const [r2, g2, b2] = hexToRgb(b);
    return rgbToHex(lerp(r1, r2, t), lerp(g1, g2, t), lerp(b1, b2, t));
}

// 0 (full daylight) → 1 (deep night), smooth across the dawn/dusk ramps. Kept
// separate from the tint alpha so fauna can gate cleanly on "is it night".
function nightFactor(h: number): number {
    if (h < 5) return 1;
    if (h < 7) return 1 - smoothstep(5, 7, h);
    if (h < 17) return 0;
    if (h < 20.5) return smoothstep(17, 20.5, h);
    return 1;
}

function phaseFor(h: number): DayPhase {
    if (h >= 5 && h < 7.5) return "dawn";
    if (h >= 7.5 && h < 17) return "day";
    if (h >= 17 && h < 20) return "dusk";
    return "night";
}

/** The sky for any fractional hour (0–24). Pure — same hour always maps here. */
export function skyAtHour(hour: number): SkyState {
    const h = ((hour % 24) + 24) % 24;
    // Find the surrounding keyframes and interpolate.
    let lo = KEYS[0];
    let hi = KEYS[KEYS.length - 1];
    for (let i = 0; i < KEYS.length - 1; i++) {
        if (h >= KEYS[i].h && h <= KEYS[i + 1].h) { lo = KEYS[i]; hi = KEYS[i + 1]; break; }
    }
    const span = hi.h - lo.h || 1;
    const t = smoothstep(0, 1, (h - lo.h) / span);
    return {
        hour: h,
        phase: phaseFor(h),
        night: nightFactor(h),
        tint: lerpHex(lo.tint, hi.tint, t),
        tintAlpha: lerp(lo.a, hi.a, t),
        vignette: lerp(lo.vig, hi.vig, t),
        light: lerpHex(lo.light, hi.light, t),
    };
}

/** Continuous local hour (0–24) for a Date, honouring the QA `dayCycle.hour` pin. */
export function currentHour(now: Date): number {
    if (typeof window !== "undefined") {
        try {
            const forced = window.localStorage?.getItem("dayCycle.hour");
            if (forced != null && forced !== "") {
                const f = Number(forced);
                if (Number.isFinite(f)) return ((f % 24) + 24) % 24;
            }
        } catch { /* private mode — fall through to the real clock */ }
    }
    return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
}

/** True when the day/night overlay has been disabled for this device. */
export function dayCycleDisabled(): boolean {
    if (typeof window === "undefined") return false;
    try { return window.localStorage?.getItem("dayCycle.v1") === "off"; } catch { return false; }
}

/** The sky for "now" (a passed-in Date so the read stays out of render). */
export function skyNow(now: Date): SkyState {
    return skyAtHour(currentHour(now));
}

/** A neutral noon sky — safe default state that touches no clock (for render). */
export const NOON_SKY: SkyState = skyAtHour(12);
