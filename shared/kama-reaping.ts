/**
 * Kama Reaping: the harvesting minigame (docs/harvesting-minigame-plan.md §3).
 *
 * Five stalks sway in a seeded wind. The player gets three kama strokes; each
 * stroke is one straight segment across the field. A stroke cuts every uncut
 * stalk it crosses, and the cut is graded by how close it lands to that stalk's
 * cut band. Client preview and server settlement run this same pure module, so
 * the server re-scores the strokes itself and never trusts a client outcome.
 *
 * Coordinates are field percent: x 0-100 left to right, y 0-100 top to bottom,
 * on a 3:2 field. Geometry runs in "height units" (x scaled by KAMA_FIELD_ASPECT)
 * so a rotation looks the same as it is scored.
 */
export const KAMA_READY_MS = 600;
export const KAMA_LIMIT_MS = 15_000;
export const KAMA_STROKES = 3;
export const KAMA_STALKS = 5;
/** Minimum gap between two strokes: a kama cannot swing twice at once. */
export const KAMA_STROKE_GAP_MS = 150;
export const KAMA_FIELD_ASPECT = 1.5;
/** Where stalk bases stand: the open soil band of /assets/harvesting/kama-meadow.webp. */
export const KAMA_BASE_Y = 86;
export const KAMA_CLEAN = 0.04;
export const KAMA_ROUGH = 0.09;
/** Gusts are telegraphed this long before they bite (renderer only). */
export const KAMA_GUST_WARNING_MS = 500;
/** A stroke may be stamped this far past the server's elapsed time. The client
 * clock is an estimate of server time, and the run resolves the instant the last
 * stroke lands, so without slack a few ms of skew refused a finished row. Same
 * allowance as the kunai scorer (shared/kunai-fishing.ts). */
export const KAMA_CLOCK_SLACK_MS = 100;
/** A finished row is submitted only after its cut tops have fallen this long:
 * the client's settle delay, and the length of the renderer's fall. */
export const KAMA_SETTLE_MS = 900;

export type KamaStroke = { kind: 'stroke'; at: number; x1: number; y1: number; x2: number; y2: number };
export type KamaCut = 'clean' | 'rough' | 'wasted' | 'tear';
export type KamaCutTally = { clean: number; rough: number; wasted: number; tear: number };
export type KamaStalk = {
    /** Base position, field percent. */
    x: number;
    /** Stalk height in height units (field percent of the field's height). */
    height: number;
    /** Cut band centre as a fraction of the stalk height from the root. */
    band: number;
    /** Calm sway amplitude, radians. */
    amplitude: number;
    period: number;
    phase: number;
};
export type KamaGust = { start: number; duration: number };
export type KamaField = { stalks: KamaStalk[]; gusts: KamaGust[] };
export type KamaStalkResult = { cut?: KamaCut; at?: number; height?: number };

export const kamaSeed = (attempt: { hookAt: number; template: number }) => attempt.hookAt + attempt.template * 997;

/** mulberry32: small, fast and identical in every JS engine (integer math only). */
function random(seed: number) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function kamaField(seed: number): KamaField {
    const next = random(seed);
    const between = (low: number, high: number) => low + (high - low) * next();
    const stalks = Array.from({ length: KAMA_STALKS }, (_, index): KamaStalk => ({
        x: 14 + index * 18 + between(-3, 3),
        height: between(50, 62),
        band: between(0.34, 0.52),
        amplitude: between(4, 8) * Math.PI / 180,
        period: between(1600, 2600),
        phase: between(0, Math.PI * 2),
    }));
    const gustCount = 2 + Math.floor(next() * 2);
    const gusts: KamaGust[] = [];
    // Gusts fall in their own slices of the window, so they never overlap and a
    // calm always follows each one.
    const slice = (KAMA_LIMIT_MS - 1500) / gustCount;
    for (let index = 0; index < gustCount; index++) {
        const duration = between(1200, 2000);
        const start = KAMA_READY_MS + 1500 + index * slice + between(0, Math.max(0, slice - duration - 600));
        gusts.push({ start: Math.round(start), duration: Math.round(duration) });
    }
    return { stalks, gusts };
}

/** 0 in calm air, rising smoothly to 1 at the height of a gust. */
export function kamaGustStrength(field: KamaField, at: number): number {
    let strength = 0;
    for (const gust of field.gusts) {
        const progress = (at - gust.start) / gust.duration;
        if (progress > 0 && progress < 1) strength = Math.max(strength, Math.sin(progress * Math.PI) ** 2);
    }
    return strength;
}

/** Lean of a stalk from vertical, radians; positive leans right. */
export function kamaStalkAngle(field: KamaField, index: number, at: number): number {
    const stalk = field.stalks[index];
    const gust = 1 + 1.5 * kamaGustStrength(field, at);
    return stalk.amplitude * gust * Math.sin((at / stalk.period) * Math.PI * 2 + stalk.phase);
}

/** Base and tip of a stalk at `at`, in field percent. */
export function kamaStalkPose(field: KamaField, index: number, at: number) {
    const stalk = field.stalks[index], angle = kamaStalkAngle(field, index, at);
    return {
        base: { x: stalk.x, y: KAMA_BASE_Y },
        tip: { x: stalk.x + (stalk.height * Math.sin(angle)) / KAMA_FIELD_ASPECT, y: KAMA_BASE_Y - stalk.height * Math.cos(angle) },
        angle,
    };
}

/**
 * Where a stroke crosses a stalk, as a fraction of the stalk from the root, or
 * undefined when it misses. Both segments are scaled to height units first.
 */
export function kamaCrossing(field: KamaField, index: number, stroke: KamaStroke): number | undefined {
    const { base, tip } = kamaStalkPose(field, index, stroke.at);
    const ax = stroke.x1 * KAMA_FIELD_ASPECT, ay = stroke.y1, bx = stroke.x2 * KAMA_FIELD_ASPECT, by = stroke.y2;
    const cx = base.x * KAMA_FIELD_ASPECT, cy = base.y, dx = tip.x * KAMA_FIELD_ASPECT, dy = tip.y;
    const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy;
    const denominator = rx * sy - ry * sx;
    if (Math.abs(denominator) < 1e-9) return undefined;
    const along = ((cx - ax) * sy - (cy - ay) * sx) / denominator;
    const up = ((cx - ax) * ry - (cy - ay) * rx) / denominator;
    return along >= 0 && along <= 1 && up >= 0 && up <= 1 ? up : undefined;
}

export function kamaClassify(height: number, band: number): KamaCut {
    const offset = height - band;
    if (Math.abs(offset) <= KAMA_CLEAN) return 'clean';
    if (Math.abs(offset) <= KAMA_ROUGH) return 'rough';
    return offset < 0 ? 'tear' : 'wasted';
}

const inField = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
/** Validate and copy the client's strokes. Any malformed entry rejects the whole list. */
export function readKamaStrokes(events: unknown, elapsed: number): KamaStroke[] | null {
    if (!Array.isArray(events) || events.length > KAMA_STROKES) return null;
    const strokes: KamaStroke[] = [];
    for (const raw of events) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
        const event = raw as Record<string, unknown>;
        if (event.kind !== 'stroke' || typeof event.at !== 'number' || !Number.isFinite(event.at)) return null;
        if (!inField(event.x1) || !inField(event.y1) || !inField(event.x2) || !inField(event.y2)) return null;
        const at = event.at, previous = strokes.at(-1);
        if (at < KAMA_READY_MS || at > KAMA_READY_MS + KAMA_LIMIT_MS || at > elapsed + KAMA_CLOCK_SLACK_MS) return null;
        if (previous && at - previous.at < KAMA_STROKE_GAP_MS) return null;
        if (Math.hypot((event.x2 - event.x1) * KAMA_FIELD_ASPECT, event.y2 - event.y1) < 3) return null;
        strokes.push({ kind: 'stroke', at, x1: event.x1, y1: event.y1, x2: event.x2, y2: event.y2 });
    }
    return strokes;
}

/** Guide-line input (keyboard, and taps on small screens): the line glides up and
 * down over the band heights every KAMA_GUIDE_PERIOD_MS. */
export const KAMA_GUIDE_PERIOD_MS = 2400;
const GUIDE_TOP = KAMA_BASE_Y - 62 * .56, GUIDE_BOTTOM = KAMA_BASE_Y - 50 * .3;
export function kamaGuideY(at: number): number {
    return GUIDE_TOP + (GUIDE_BOTTOM - GUIDE_TOP) * (.5 - .5 * Math.cos(at / KAMA_GUIDE_PERIOD_MS * Math.PI * 2));
}
/** Where stalk `index` stands at field height `y` (field percent), at `at`. */
export function kamaStalkXAt(field: KamaField, index: number, at: number, y: number): number {
    const { base, tip } = kamaStalkPose(field, index, at);
    const u = (base.y - y) / (base.y - tip.y);
    return base.x + (tip.x - base.x) * u;
}
/** A guide stroke: level, at the guide's height, across just the chosen stalk. */
export function kamaGuideStroke(field: KamaField, index: number, at: number): KamaStroke {
    const y = Math.round(kamaGuideY(at) * 100) / 100, x = kamaStalkXAt(field, index, at, y);
    const clamp = (value: number) => Math.round(Math.max(0, Math.min(100, value)) * 100) / 100;
    return { kind: 'stroke', at, x1: clamp(x - 4), y1: y, x2: clamp(x + 4), y2: y };
}
/** The relaxed-mode animation: three clean sweeps that take every stalk. Visual only. */
export function kamaDemoStrokes(field: KamaField): KamaStroke[] {
    const bandPoint = (index: number, at: number) => {
        const { base, tip } = kamaStalkPose(field, index, at), u = field.stalks[index].band;
        return { x: base.x + (tip.x - base.x) * u, y: base.y + (tip.y - base.y) * u };
    };
    const sweep = (first: number, second: number, at: number): KamaStroke => {
        const a = bandPoint(first, at), b = bandPoint(second, at), dx = b.x - a.x, dy = b.y - a.y;
        return { kind: 'stroke', at, x1: a.x - dx * .05, y1: a.y - dy * .05, x2: b.x + dx * .05, y2: b.y + dy * .05 };
    };
    const last = bandPoint(4, 2300);
    return [sweep(0, 1, 900), sweep(2, 3, 1600), { kind: 'stroke', at: 2300, x1: last.x - 3, y1: last.y, x2: last.x + 3, y2: last.y }];
}

/**
 * Score a run. Returns null while the run is still playable (fewer than three
 * strokes, stalks left standing and time left) or when the strokes are
 * malformed; the resolve route reports that as an incomplete sequence.
 */
export function scoreKamaReaping(seed: number, events: unknown, elapsed: number, preview = false) {
    const strokes = readKamaStrokes(events, preview ? Number.POSITIVE_INFINITY : elapsed);
    if (!strokes) return null;
    const field = kamaField(seed);
    const stalks: KamaStalkResult[] = field.stalks.map(() => ({}));
    for (const stroke of strokes) {
        field.stalks.forEach((stalk, index) => {
            if (stalks[index].cut) return;
            const height = kamaCrossing(field, index, stroke);
            if (height !== undefined) stalks[index] = { cut: kamaClassify(height, stalk.band), at: stroke.at, height };
        });
    }
    const tally: KamaCutTally = { clean: 0, rough: 0, wasted: 0, tear: 0 };
    for (const stalk of stalks) if (stalk.cut) tally[stalk.cut]++;
    const finished = strokes.length >= KAMA_STROKES || stalks.every(stalk => stalk.cut)
        || elapsed >= KAMA_READY_MS + KAMA_LIMIT_MS;
    if (!finished && !preview) return null;
    const performance = Math.max(0, Math.min(10, 2 * tally.clean + tally.rough - 2 * tally.tear));
    const failed = tally.clean + tally.rough + tally.wasted === 0 || tally.tear >= 2;
    return { field, stalks, tally, performance, failed, finished, strokesLeft: KAMA_STROKES - strokes.length };
}
