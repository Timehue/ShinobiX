/*
 * Combat usage telemetry: how often each jutsu, bloodline, weapon and AI
 * profile is taken into real fights, how often it is actually cast, and how
 * those fights end. It gives balance work live numbers to set beside the
 * offline sims (scripts/pvp-formula-sim.ts).
 *
 * Read-only for the game: nothing here feeds back into combat, rewards or
 * matchmaking. Recording is fire-and-forget and never throws into a
 * settlement path; a lost count is acceptable, a blocked settlement is not.
 *
 * Storage: one aggregate row per mode, `telemetry:combat-usage:v1:<mode>`,
 * updated under the telemetry lock. Each fight is counted exactly once:
 *   - PvP: from the branch where the battle receipt is first created
 *     (api/pvp/_committed-terminal-effects.ts), which succeeds once per battle.
 *   - Solo PvE: from every active → done edge (a finishing action, an
 *     abandon, a lapse), behind an NX gate per session.
 *   - Towers / Endless Spire / Clan Boss: when the run's settlement is
 *     recorded, behind an NX gate per run.
 * Only real players' loadouts are counted in PvP (an NPC side's loadout is
 * client-supplied). In PvE the enemy is counted as its AI profile.
 */
import { kv } from './_storage.js';
import { withTelemetryLock } from './_telemetry-lock.js';
import { safeLogValue } from './_safe-log.js';
import type { PvpSession } from './pvp/session.js';
import type { SoloPveSession } from './solo-pve/_session.js';

export const COMBAT_USAGE_MODES = ['ranked', 'pvp', 'pve', 'tower', 'clan-boss'] as const;
/** Modes whose engine records which jutsu were actually cast. Towers and the
 *  Clan Boss do not keep a cast history, so their `used` count is always 0. */
export const MODES_WITH_CAST_TRACKING: ReadonlySet<CombatUsageMode> = new Set(['ranked', 'pvp', 'pve']);
export type CombatUsageMode = typeof COMBAT_USAGE_MODES[number];
export const COMBAT_USAGE_KINDS = ['jutsu', 'bloodline', 'weapon', 'ai'] as const;
export type CombatUsageKind = typeof COMBAT_USAGE_KINDS[number];

export type UsageOutcome = 'win' | 'loss' | 'draw' | 'fled';
export type UsageCounts = { equipped: number; used: number; win: number; loss: number; draw: number; fled: number };

export type CombatUsageAggregate = {
    version: 1;
    mode: CombatUsageMode;
    /** When counting began (or was last reset). */
    since: number;
    updatedAt: number;
    fights: number;
} & Record<CombatUsageKind, Record<string, UsageCounts>>;

/** One side of a finished fight, as the aggregate sees it. */
export type FighterUsage = {
    outcome: UsageOutcome;
    equippedJutsu: string[];
    usedJutsu: string[];
    bloodline?: string;
    weapons: string[];
    /** Set for an AI side; its outcome is from the AI's point of view. */
    aiProfile?: string;
};

/** Bounds a table so a flood of unique ids can't grow the row without limit. */
export const MAX_ENTRIES_PER_KIND = 2000;
// Letters in any script and the punctuation real names use ("Raijū, the
// Storm-Hound"); anything with markup or control characters is dropped.
const ID_PATTERN = /^[\p{L}\p{N}_:.,\-' ]{1,80}$/u;
const PVE_GATE_TTL_SECONDS = 7 * 24 * 60 * 60;

export function usageKey(mode: CombatUsageMode): string {
    return `telemetry:combat-usage:v1:${mode}`;
}

export function emptyAggregate(mode: CombatUsageMode, now: number): CombatUsageAggregate {
    return { version: 1, mode, since: now, updatedAt: now, fights: 0, jutsu: {}, bloodline: {}, weapon: {}, ai: {} };
}

function cleanId(value: unknown): string | null {
    const id = typeof value === 'string' ? value.trim() : '';
    return ID_PATTERN.test(id) ? id : null;
}

function uniqueIds(values: unknown[]): string[] {
    return [...new Set(values.map(cleanId).filter((id): id is string => id !== null))];
}

function bump(table: Record<string, UsageCounts>, id: string, patch: Partial<UsageCounts>): void {
    let row = table[id];
    if (!row) {
        if (Object.keys(table).length >= MAX_ENTRIES_PER_KIND) return;
        row = { equipped: 0, used: 0, win: 0, loss: 0, draw: 0, fled: 0 };
        table[id] = row;
    }
    for (const [k, v] of Object.entries(patch) as Array<[keyof UsageCounts, number]>) row[k] += v;
}

/** Fold one fighter's fight into the aggregate (mutates and returns it). */
export function applyFighterUsage(agg: CombatUsageAggregate, fighter: FighterUsage): CombatUsageAggregate {
    const result = { [fighter.outcome]: 1 } as Partial<UsageCounts>;
    const equipped = new Set(uniqueIds(fighter.equippedJutsu));
    const used = new Set(uniqueIds(fighter.usedJutsu).filter((id) => equipped.has(id)));
    for (const id of equipped) bump(agg.jutsu, id, { equipped: 1, ...(used.has(id) ? { used: 1 } : {}), ...result });
    const bloodline = cleanId(fighter.bloodline);
    if (bloodline) bump(agg.bloodline, bloodline, { equipped: 1, ...result });
    for (const id of uniqueIds(fighter.weapons)) bump(agg.weapon, id, { equipped: 1, ...result });
    const ai = cleanId(fighter.aiProfile);
    if (ai) bump(agg.ai, ai, { equipped: 1, ...result });
    return agg;
}

function sanitizeAggregate(raw: unknown, mode: CombatUsageMode, now: number): CombatUsageAggregate {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || (raw as { version?: unknown }).version !== 1) {
        return emptyAggregate(mode, now);
    }
    const r = raw as Partial<CombatUsageAggregate>;
    const table = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, UsageCounts> : {});
    return {
        version: 1, mode,
        since: Number(r.since) || now,
        updatedAt: Number(r.updatedAt) || now,
        fights: Math.max(0, Math.floor(Number(r.fights) || 0)),
        jutsu: table(r.jutsu), bloodline: table(r.bloodline), weapon: table(r.weapon), ai: table(r.ai),
    };
}

type UsageStore = Pick<typeof kv, 'get' | 'set' | 'del'>;

export async function recordCombatUsage(
    mode: CombatUsageMode,
    fighters: FighterUsage[],
    store: UsageStore = kv,
    now: number = Date.now(),
): Promise<void> {
    if (!fighters.length) return;
    const key = usageKey(mode);
    await withTelemetryLock(key, store, async () => {
        const agg = sanitizeAggregate(await store.get<unknown>(key), mode, now);
        for (const fighter of fighters) applyFighterUsage(agg, fighter);
        agg.fights += 1;
        agg.updatedAt = now;
        await store.set(key, agg);
    });
}

export async function readCombatUsage(mode: CombatUsageMode, store: UsageStore = kv): Promise<CombatUsageAggregate | null> {
    const raw = await store.get<unknown>(usageKey(mode));
    return raw ? sanitizeAggregate(raw, mode, Date.now()) : null;
}

/** Start counting afresh (after a rebalance). */
export async function resetCombatUsage(mode: CombatUsageMode, store: UsageStore = kv): Promise<void> {
    const key = usageKey(mode);
    await withTelemetryLock(key, store, async () => { await store.del(key); });
}

// ── PvP ─────────────────────────────────────────────────────────────────────

function jutsuIds(character: Record<string, unknown>): string[] {
    const list = Array.isArray(character.jutsu) ? character.jutsu : [];
    return list.map((j) => (j && typeof j === 'object' ? (j as { id?: unknown }).id : null)).filter((id): id is string => typeof id === 'string');
}

function weaponIds(character: Record<string, unknown>): string[] {
    const items = Array.isArray(character.pvpItems) ? character.pvpItems : [];
    return items
        .filter((item): item is { id?: unknown; slot?: unknown } => !!item && typeof item === 'object')
        .filter((item) => item.slot === 'hand' || item.slot === 'thrown')
        .map((item) => item.id)
        .filter((id): id is string => typeof id === 'string');
}

function bloodlineOf(character: Record<string, unknown>): string | undefined {
    if (typeof character.equippedBloodlineId === 'string' && character.equippedBloodlineId) return character.equippedBloodlineId;
    if (typeof character.bloodline === 'string' && character.bloodline) return `starter:${character.bloodline}`;
    return undefined;
}

/** Which aggregate a finished PvP session belongs to, and each real side's
 *  usage. Null for fights that should not be counted (no result, a pet
 *  ranked bout, a duel that was cancelled before it started). */
export function pvpCombatUsage(session: PvpSession): { mode: CombatUsageMode; fighters: FighterUsage[] } | null {
    if (session.status !== 'done' || !session.winner) return null;
    if (session.rankedKind === 'pet') return null;
    if (session.joined && (session.joined.p1 !== true || session.joined.p2 !== true)) return null;
    const mode: CombatUsageMode = session.ranked ? 'ranked' : 'pvp';
    const fighters: FighterUsage[] = [];
    for (const side of ['p1', 'p2'] as const) {
        if (session.realFighters && session.realFighters[side] === false) continue;
        const character = (session[side]?.character ?? {}) as Record<string, unknown>;
        const outcome: UsageOutcome = session.winner === 'draw' ? 'draw'
            : session.winner === side ? 'win'
            : session.fleedBy === side ? 'fled' : 'loss';
        fighters.push({
            outcome,
            equippedJutsu: jutsuIds(character),
            usedJutsu: session.jutsuUsed?.[side] ?? [],
            bloodline: bloodlineOf(character),
            weapons: weaponIds(character),
        });
    }
    return fighters.length ? { mode, fighters } : null;
}

/** Fire-and-forget: count a PvP battle. Call only where the battle is known
 *  to be counted for the first time. */
export function recordPvpCombatUsage(session: PvpSession): void {
    try {
        const usage = pvpCombatUsage(session);
        if (!usage) return;
        void recordCombatUsage(usage.mode, usage.fighters).catch((err) => {
            console.warn('[combat-usage] pvp record failed:', safeLogValue(err));
        });
    } catch (err) {
        console.warn('[combat-usage] pvp extract failed:', safeLogValue(err));
    }
}

// ── Solo PvE ────────────────────────────────────────────────────────────────

export function soloPveCombatUsage(session: SoloPveSession): FighterUsage[] | null {
    if (session.status !== 'done' || !session.outcome) return null;
    const player = (session.player?.character ?? {}) as Record<string, unknown>;
    const usedJutsu = session.huntCombat?.usedJutsuIds ?? (session.events ?? [])
        .filter((e) => e.actor === 'player' && e.action === 'jutsu' && typeof e.actionId === 'string')
        .map((e) => e.actionId as string);
    const playerOutcome = session.outcome;
    const aiOutcome: UsageOutcome = playerOutcome === 'win' ? 'loss' : playerOutcome === 'loss' ? 'win' : playerOutcome === 'fled' ? 'win' : 'draw';
    const encounter = session.encounter;
    const aiProfile = encounter?.id ? `${encounter.kind}:${encounter.id}` : undefined;
    return [
        { outcome: playerOutcome, equippedJutsu: jutsuIds(player), usedJutsu, bloodline: bloodlineOf(player), weapons: weaponIds(player) },
        ...(aiProfile ? [{ outcome: aiOutcome, equippedJutsu: [], usedJutsu: [], weapons: [], aiProfile }] : []),
    ];
}

// ── Towers / Endless Spire / Clan Boss ──────────────────────────────────────

type TowerLike = {
    runId: string;
    status: string;
    winner: string | null;
    actors: Array<{ side: string; name: string; ownerSlug: string | null; ai: boolean; character: Record<string, unknown> }>;
};

/** Every human squad member's loadout, plus each distinct enemy as an AI
 *  profile (`tower:<name>`, outcome from the enemy's side). A run that ends
 *  without a squad win or loss (round cap, stall) counts as a draw. */
export function towerCombatUsage(session: TowerLike): FighterUsage[] | null {
    if (session.status !== 'done') return null;
    const squad: UsageOutcome = session.winner === 'squad' ? 'win' : session.winner === 'enemy' ? 'loss' : 'draw';
    const enemy: UsageOutcome = squad === 'win' ? 'loss' : squad === 'loss' ? 'win' : 'draw';
    const fighters: FighterUsage[] = session.actors
        .filter((a) => a.side === 'squad' && !a.ai && a.ownerSlug)
        .map((a) => ({ outcome: squad, equippedJutsu: jutsuIds(a.character ?? {}), usedJutsu: [], bloodline: bloodlineOf(a.character ?? {}), weapons: weaponIds(a.character ?? {}) }));
    const enemies = new Set(session.actors.filter((a) => a.side === 'enemy' && a.name).map((a) => a.name));
    for (const name of enemies) fighters.push({ outcome: enemy, equippedJutsu: [], usedJutsu: [], weapons: [], aiProfile: `tower:${name}` });
    return fighters.length ? fighters : null;
}

/** Fire-and-forget: count a finished tower or Clan Boss run once per run. */
export function recordTowerCombatUsage(session: TowerLike, mode: 'tower' | 'clan-boss'): void {
    void (async () => {
        const fighters = towerCombatUsage(session);
        if (!fighters) return;
        const first = await kv.set(`telemetry:combat-usage:tower-gate:${session.runId}`, '1', { nx: true, ex: PVE_GATE_TTL_SECONDS });
        if (!first) return;
        await recordCombatUsage(mode, fighters);
    })().catch((err) => {
        console.warn('[combat-usage] tower record failed:', safeLogValue(err));
    });
}

/** Fire-and-forget: count a Solo PvE fight once per session. */
export function recordSoloPveCombatUsage(session: SoloPveSession): void {
    void (async () => {
        const fighters = soloPveCombatUsage(session);
        if (!fighters) return;
        const first = await kv.set(`telemetry:combat-usage:pve-gate:${session.sessionId}`, '1', { nx: true, ex: PVE_GATE_TTL_SECONDS });
        if (!first) return;
        await recordCombatUsage('pve', fighters);
    })().catch((err) => {
        console.warn('[combat-usage] pve record failed:', safeLogValue(err));
    });
}
