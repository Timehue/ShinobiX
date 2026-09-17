/*
 * combat-presentation — pure, node-testable helpers for the combat FEEL layer
 * shared by the three shinobi battle surfaces (solo PvE Arena shell, live PvP,
 * Battle Towers): floating hit numbers, actor hit-reactions, per-event
 * sequencing of a server batch, the KO hold before the result card, and the
 * source-of-truth for ambient combat weather.
 *
 * COSMETIC ONLY. Every input here is a snapshot the server already resolved;
 * nothing returned is read back as combat authority (damage, statuses,
 * positions, turn order and settlement all come from the session). Must NOT
 * import from ../App or any screen.
 */
import type { WeatherType } from "../types/core";

export type CombatHitKind = "damage" | "heal" | "shield" | "status";

/** One floating number / label to paint over a fighter's tile. */
export type CombatHitEvent = {
    /** Actor id (or "p1" / "p2" in PvP). */
    target: string;
    amount: number;
    kind: CombatHitKind;
    /** Pre-formatted text; callers fall back to ±amount when absent. */
    label?: string;
};

/** A fighter's presentation-relevant vitals, before or after one event. */
export type CombatVitalsSnapshot = {
    hp: number;
    maxHp?: number;
    shield?: number;
    statuses?: ReadonlyArray<{ name: string }>;
};

/**
 * Diff two vitals snapshots of the SAME fighter into hit events. The server
 * already applied the outcome; this only names what changed so the board can
 * show it where it happened:
 *   HP down       → damage (the true post-shield HP loss)
 *   HP up         → heal
 *   shield down with no HP loss → shield ("guard" absorbed the blow)
 *   shield up     → shield gained
 *   a status name that was not there before → status applied
 * A DoT tick and a hit landing in the same event collapse into one number per
 * fighter, which is the readable outcome for a 12×10 board.
 */
export function diffCombatVitals(
    target: string,
    before: CombatVitalsSnapshot | null | undefined,
    after: CombatVitalsSnapshot | null | undefined,
): CombatHitEvent[] {
    if (!before || !after) return [];
    const out: CombatHitEvent[] = [];
    const hpDelta = Math.round(Number(after.hp) - Number(before.hp));
    if (Number.isFinite(hpDelta) && hpDelta < 0) out.push({ target, amount: -hpDelta, kind: "damage" });
    else if (Number.isFinite(hpDelta) && hpDelta > 0) out.push({ target, amount: hpDelta, kind: "heal", label: `+${hpDelta}` });
    const shieldDelta = Math.round(Number(after.shield ?? 0) - Number(before.shield ?? 0));
    if (Number.isFinite(shieldDelta) && shieldDelta < 0 && hpDelta >= 0) {
        out.push({ target, amount: -shieldDelta, kind: "shield", label: `−${-shieldDelta} guard` });
    } else if (Number.isFinite(shieldDelta) && shieldDelta > 0) {
        out.push({ target, amount: shieldDelta, kind: "shield", label: `+${shieldDelta} guard` });
    }
    const had = new Set((before.statuses ?? []).map((status) => String(status.name ?? "")));
    const seen = new Set<string>();
    for (const status of after.statuses ?? []) {
        const name = String(status.name ?? "").trim();
        if (!name || had.has(name) || seen.has(name)) continue;
        seen.add(name);
        out.push({ target, amount: 0, kind: "status", label: name });
    }
    return out;
}

/** Text for a hit event: the caller's label, else a signed number. */
export function combatHitLabel(hit: Pick<CombatHitEvent, "amount" | "kind" | "label">): string {
    if (hit.label) return hit.label;
    if (hit.kind === "heal") return `+${hit.amount}`;
    if (hit.kind === "damage") return `−${hit.amount}`;
    return String(hit.amount);
}

/**
 * Lane for the n-th label on one tile in the same beat, so a damage number and
 * the status it applied do not stack into one blur: later labels step sideways
 * AND a little lower (a status word is wider than a number).
 */
export function combatHitFloatLane(index: number): { dx: number; dy: number } {
    const dx = [0, -26, 26, -46, 46];
    const dy = [0, 12, 12, 24, 24];
    const slot = Math.abs(index) % dx.length;
    return { dx: dx[slot] ?? 0, dy: dy[slot] ?? 0 };
}

/** Horizontal part of the lane (see combatHitFloatLane). */
export function combatHitFloatOffset(index: number): number {
    return combatHitFloatLane(index).dx;
}

// ── Actor reactions ──────────────────────────────────────────────────────────

export type CombatActorReactionKind = "hit" | "heavy" | "guard" | "heal" | "cast" | "lunge" | "ko";

/** A blow at or above this fraction of max HP reads as a heavy hit. */
export const HEAVY_HIT_FRACTION = 0.18;

/** Lag between a fighter's own attack motion and the impact it causes, so a
 *  lunge visibly precedes the flinch and the number instead of sharing a frame. */
export const ARENA_IMPACT_LAG_MS = 110;

/**
 * Which reaction a fighter plays for one hit event. `down` decides a KO (the
 * fighter's HP reached zero in this event); the fraction of max HP decides
 * heavy vs. light. Status-only events get no body motion — the label is the
 * acknowledgment, and a fighter should not flinch at every debuff refresh.
 */
export function reactionForHit(
    hit: Pick<CombatHitEvent, "kind" | "amount">,
    vitals: { maxHp: number; down: boolean },
): CombatActorReactionKind | null {
    switch (hit.kind) {
        case "damage": {
            if (vitals.down) return "ko";
            const maxHp = Math.max(1, Number(vitals.maxHp) || 1);
            return hit.amount >= maxHp * HEAVY_HIT_FRACTION ? "heavy" : "hit";
        }
        case "shield":
            return hit.amount > 0 && !vitals.down ? "guard" : null;
        case "heal":
            return "heal";
        default:
            return null;
    }
}

/** Unit vector from `from` toward `to` (or +x when they coincide). */
export function reactionDirection(from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number } {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    if (!Number.isFinite(len) || len < 0.001) return { x: 1, y: 0 };
    return { x: dx / len, y: dy / len };
}

// ── Event sequencing ─────────────────────────────────────────────────────────

/** Cadence of one replayed enemy step; matches the actors' 280ms tile glide so
 *  consecutive steps read as one continuous walk with no pause between them. */
export const ARENA_MOVE_STEP_MS = 280;
/** Room given to one resolved action (its plate pops, number floats, the
 *  fighter reacts) before the next event in the same server batch begins. */
export const ARENA_ACTION_BEAT_MS = 320;
/** A whole batch must finish inside this; a longer AI turn is compressed. */
export const ARENA_BATCH_MAX_MS = 1600;
/** Hold after the final blow so the KO reads before the result card lands. */
export const ARENA_KO_HOLD_MS = 650;

export type ArenaBeatLike = { seq: number; movement?: boolean };

export type ArenaBeatSchedule<T extends ArenaBeatLike> = {
    beats: Array<{ beat: T; at: number }>;
    /** When the last beat's own room ends, relative to the batch start. */
    total: number;
};

/**
 * Lay a server batch out on one presentation timeline. The server resolves the
 * player's action AND the enemy's entire reply in one round-trip, so without
 * this every plate, number and reaction of the whole exchange lands on the
 * same frame. Beats are spaced in seq order — movement steps at the walk
 * cadence, actions at the action beat — and the whole batch is compressed to
 * fit `ARENA_BATCH_MAX_MS`. `instant` (reduced motion / lite fx) collapses
 * everything onto t=0, which is exactly today's behaviour.
 */
export function arenaBeatSchedule<T extends ArenaBeatLike>(
    fresh: readonly T[],
    options: { instant?: boolean; stepMs?: number; beatMs?: number; maxMs?: number } = {},
): ArenaBeatSchedule<T> {
    const ordered = [...fresh].sort((a, b) => a.seq - b.seq);
    if (options.instant || ordered.length === 0) {
        return { beats: ordered.map((beat) => ({ beat, at: 0 })), total: 0 };
    }
    const stepMs = options.stepMs ?? ARENA_MOVE_STEP_MS;
    const beatMs = options.beatMs ?? ARENA_ACTION_BEAT_MS;
    const maxMs = options.maxMs ?? ARENA_BATCH_MAX_MS;
    let cursor = 0;
    const raw = ordered.map((beat) => {
        const at = cursor;
        cursor += beat.movement ? stepMs : beatMs;
        return { beat, at };
    });
    const total = cursor;
    if (total <= maxMs) return { beats: raw, total };
    const k = maxMs / total;
    return { beats: raw.map(({ beat, at }) => ({ beat, at: Math.round(at * k) })), total: maxMs };
}

// ── Ambient combat weather ───────────────────────────────────────────────────

export type CombatWeatherPresentation = {
    /** SceneAmbience particle intensity (0–1.5). */
    intensity: number;
    /** Layer opacity: readability of tiles, fighters and numbers always wins. */
    opacity: number;
};

/**
 * How much of each sky the battlefield shows. Deliberately restrained: weather
 * persists for the whole fight, so it is drawn cheaper and quieter than any
 * impact plate. `null` means "draw nothing" — a clear sky adds no particles.
 */
export function combatWeatherPresentation(weather: WeatherType | null | undefined): CombatWeatherPresentation | null {
    switch (weather) {
        case "rain": return { intensity: 0.55, opacity: 0.6 };
        case "thunderstorm": return { intensity: 0.7, opacity: 0.62 };
        case "ashfall": return { intensity: 0.5, opacity: 0.58 };
        case "tornado": return { intensity: 0.55, opacity: 0.5 };
        case "desertHaze": return { intensity: 0.5, opacity: 0.46 };
        default: return null;
    }
}

/**
 * Which sky a fight is standing under. Precedence:
 *   1. an authored cinematic backdrop (story boss art) — weather would fight
 *      the illustration, so none;
 *   2. the weather the SERVER sealed into the session (the modifiers the
 *      environment strip already shows) — the board must agree with its own
 *      +5% / −2% chips;
 *   3. the world sky over the sector the player is standing in, read once at
 *      fight start (no polling; the same deterministic clock the map uses).
 * Lookups are injected so this stays pure and node-testable.
 */
export function combatWeatherSource(input: {
    sealedPositive?: string | null;
    sealedNegative?: string | null;
    authoredBackdrop?: boolean;
    sector?: number | null;
    weatherFromElements: (positive: string, negative: string) => WeatherType;
    weatherForSector: (sector: number) => WeatherType;
}): WeatherType | null {
    if (input.authoredBackdrop) return null;
    const positive = String(input.sealedPositive ?? "");
    const negative = String(input.sealedNegative ?? "");
    if (positive || negative) return input.weatherFromElements(positive, negative);
    const sector = input.sector;
    if (typeof sector === "number" && Number.isFinite(sector)) return input.weatherForSector(sector);
    return null;
}
