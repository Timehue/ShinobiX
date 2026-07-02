/*
 * Era engine — contribution counters, milestone evaluation, and the unlock
 * transaction (docs/legacy-system-plan.md §14).
 *
 * State model: definitions are static (api/_era-defs.ts); the KV row
 * `game:era-state` stores only OVERRIDES (admin status/milestone tuning) and
 * unlock records. Contributions are global `era:contrib:<metric>` counters
 * bumped with atomic kv.incr from the same settle endpoints that feed Legacy
 * tracking — contention-free by design (plan §14.3).
 *
 * The credited trigger can land BEFORE the milestones finish: it is recorded
 * once (NX) at `era:trigger:<id>` and honored when the nightly pass finds the
 * milestones complete — the finisher keeps their credit either way.
 * Unlocking is exactly-once via the `era:unlocked:<id>` NX marker.
 */
import { kv } from './_storage.js';
import { withKvLock } from './_lock.js';
import { announce, addHallEntry } from './_announce.js';
import { legacyEnabled } from './_legacy-track.js';
import { bumpSaveVersion } from './save/_save-version.js';
import { mergePreservingImages } from './_utils.js';
import {
    ERA_DEFS, ERA_BY_ID, ERA_METRICS,
    type EraDef, type EraMetric, type EraStatus, type EraTriggerKind,
} from './_era-defs.js';

export const ERA_STATE_KEY = 'game:era-state';
const contribKey = (m: EraMetric) => `era:contrib:${m}`;
const unlockedNxKey = (id: string) => `era:unlocked:${id}`;
const triggerKey = (id: string) => `era:trigger:${id}`;

export type EraOverride = {
    status?: EraStatus;
    /** Admin-tuned milestone requirements: metric -> new required value. */
    milestoneOverrides?: Partial<Record<EraMetric, number>>;
    unlockedBy?: string | null;
    unlockedVillage?: string | null;
    unlockedAt?: number;
};

export type EraState = { overrides: Record<string, EraOverride> };

export type EraTriggerRecord = { player: string; village?: string; ts: number };

export async function getEraState(): Promise<EraState> {
    try {
        const raw = await kv.get<EraState>(ERA_STATE_KEY);
        return raw && typeof raw === 'object' && raw.overrides ? raw : { overrides: {} };
    } catch {
        return { overrides: {} };
    }
}

export async function readEraContributions(): Promise<Record<EraMetric, number>> {
    const out = {} as Record<EraMetric, number>;
    for (const m of ERA_METRICS) {
        out[m] = Math.max(0, Math.floor(Number(await kv.get(contribKey(m))) || 0));
    }
    return out;
}

/** Fire-and-forget global contribution bump from settle endpoints. */
export async function bumpEraContribution(metric: EraMetric, n = 1): Promise<void> {
    if (!legacyEnabled() || n <= 0) return;
    try {
        for (let i = 0; i < n; i++) await kv.incr(contribKey(metric));
    } catch (err) {
        console.error(`[era] contribution bump failed (${metric}):`, err instanceof Error ? err.message : err);
    }
}

// ─── Pure helpers (unit-tested in _era.test.ts) ─────────────────────────────

export function effectiveStatus(def: EraDef, override?: EraOverride): EraStatus {
    return override?.status ?? def.initialStatus;
}

export function effectiveRequired(def: EraDef, metric: EraMetric, override?: EraOverride): number {
    const o = Number(override?.milestoneOverrides?.[metric]);
    const base = def.milestones.find((m) => m.metric === metric)?.required ?? 0;
    return Number.isFinite(o) && o >= 0 ? o : base;
}

export function eraMilestonesMet(
    def: EraDef,
    counters: Partial<Record<EraMetric, number>>,
    override?: EraOverride,
): boolean {
    return def.milestones.every((m) => (counters[m.metric] ?? 0) >= effectiveRequired(def, m.metric, override));
}

export type EraView = {
    id: string; number: number; name: string; description: string; lore: string; banner: string;
    status: EraStatus;
    milestones: Array<{ metric: EraMetric; label: string; required: number; current: number; done: boolean }>;
    trigger: { label: string; fired: boolean; firedBy?: string } | null;
    unlockedBy: string | null;
    unlockedVillage: string | null;
    unlockedAt: number | null;
};

export function buildEraViews(
    state: EraState,
    counters: Partial<Record<EraMetric, number>>,
    triggers: Record<string, EraTriggerRecord | null>,
): EraView[] {
    return ERA_DEFS.map((def) => {
        const override = state.overrides[def.id];
        const status = effectiveStatus(def, override);
        const trigRec = triggers[def.id] ?? null;
        return {
            id: def.id, number: def.number, name: def.name,
            description: def.description, lore: def.lore, banner: def.banner,
            status,
            milestones: def.milestones.map((m) => {
                const required = effectiveRequired(def, m.metric, override);
                const current = Math.min(counters[m.metric] ?? 0, required);
                return { metric: m.metric, label: m.label, required, current, done: current >= required };
            }),
            trigger: def.trigger
                ? { label: def.trigger.label, fired: !!trigRec, ...(trigRec ? { firedBy: trigRec.player } : {}) }
                : null,
            unlockedBy: override?.unlockedBy ?? null,
            unlockedVillage: override?.unlockedVillage ?? null,
            unlockedAt: override?.unlockedAt ?? null,
        };
    });
}

export async function getEraViews(): Promise<EraView[]> {
    const [state, counters] = await Promise.all([getEraState(), readEraContributions()]);
    const triggers: Record<string, EraTriggerRecord | null> = {};
    for (const def of ERA_DEFS) {
        triggers[def.id] = def.trigger ? await kv.get<EraTriggerRecord>(triggerKey(def.id)) : null;
    }
    return buildEraViews(state, counters, triggers);
}

// ─── Trigger + unlock transaction ───────────────────────────────────────────

/**
 * Record a credited final trigger (first caller wins, NX). Then attempt the
 * unlock immediately — if milestones are already met the finisher sees their
 * era open in real time; otherwise the record waits for the nightly pass.
 */
export async function recordEraTrigger(
    kind: EraTriggerKind,
    credited: { player: string; village?: string },
): Promise<void> {
    if (!legacyEnabled()) return;
    try {
        for (const def of ERA_DEFS) {
            if (def.trigger?.kind !== kind) continue;
            await kv.set(triggerKey(def.id), { player: credited.player, village: credited.village, ts: Date.now() } satisfies EraTriggerRecord, { nx: true });
            await checkEraUnlocks();
        }
    } catch (err) {
        console.error('[era] trigger record failed:', err instanceof Error ? err.message : err);
    }
}

/**
 * Evaluate every milestone_active era and unlock the ones that are complete
 * (milestones met + trigger fired when required). Exactly-once per era via
 * the NX marker; safe to call from the cron pass, trigger hooks, and admin.
 */
export async function checkEraUnlocks(): Promise<string[]> {
    if (!legacyEnabled()) return [];
    const unlocked: string[] = [];
    try {
        const [state, counters] = await Promise.all([getEraState(), readEraContributions()]);
        for (const def of ERA_DEFS) {
            const override = state.overrides[def.id];
            if (effectiveStatus(def, override) !== 'milestone_active') continue;
            if (!eraMilestonesMet(def, counters, override)) continue;
            let credited: EraTriggerRecord | null = null;
            if (def.trigger) {
                credited = await kv.get<EraTriggerRecord>(triggerKey(def.id));
                if (!credited) continue; // waiting on the finisher
            }
            const did = await unlockEra(def, credited, 'milestone');
            if (did) unlocked.push(def.id);
        }
    } catch (err) {
        console.error('[era] unlock check failed:', err instanceof Error ? err.message : err);
    }
    return unlocked;
}

/** The unlock transaction. Returns true only for the run that actually flips it.
 *  Order matters (same lesson as the Sage accept fix): the STATE write commits
 *  first under the fail-closed lock — it is the source of truth and is
 *  repairable by retry. The NX marker guards only the once-ever side effects
 *  (announcement/hall/title), so a crash between the two can never leave the
 *  era half-unlocked, and an admin later cycling the status back to
 *  milestone_active can't re-announce world history. */
export async function unlockEra(
    def: EraDef,
    credited: EraTriggerRecord | null,
    source: 'milestone' | 'admin',
): Promise<boolean> {
    const now = Date.now();
    let flipped = false;
    await withKvLock(ERA_STATE_KEY, async () => {
        const state = await getEraState();
        if (state.overrides[def.id]?.status === 'unlocked') return;
        state.overrides[def.id] = {
            ...state.overrides[def.id],
            status: 'unlocked',
            unlockedBy: credited?.player ?? null,
            unlockedVillage: credited?.village ?? null,
            unlockedAt: now,
        };
        await kv.set(ERA_STATE_KEY, state);
        flipped = true;
    }, { failClosed: true });
    if (!flipped) return false;

    const claimed = await kv.set(unlockedNxKey(def.id), { ts: now, source }, { nx: true });
    if (claimed !== 'OK') return true; // state repaired; history already written

    const message = def.unlockMessage
        .replace('{player}', credited?.player ?? 'the shinobi of the world')
        .replace('{village}', credited?.village ?? 'every village');
    await announce({
        type: 'era_unlock', importance: 'mythic',
        title: def.unlockTitle, message,
        player: credited?.player, village: credited?.village,
        meta: { eraId: def.id, source },
    });
    await addHallEntry({
        entryType: 'era_unlock',
        title: def.name,
        description: message,
        player: credited?.player, village: credited?.village,
        meta: { eraId: def.id },
    }, { nxKey: `era:${def.id}` });

    // Grant the credited finisher their era title (best-effort, save-locked).
    if (credited?.player && def.trigger?.title) {
        try {
            await withKvLock(`save:${credited.player}`, async () => {
                const rec = await kv.get<Record<string, unknown>>(`save:${credited.player}`);
                const char = (rec?.character ?? null) as Record<string, unknown> | null;
                if (!rec || !char) return;
                const earned = Array.isArray(char.earnedTitles) ? (char.earnedTitles as string[]) : [];
                if (earned.includes(def.trigger!.title)) return;
                const updated = { ...char, earnedTitles: [...earned, def.trigger!.title] };
                await kv.set(`save:${credited.player}`, mergePreservingImages(bumpSaveVersion({ ...rec, character: updated }), rec));
            });
        } catch (err) {
            console.error('[era] title grant failed:', err instanceof Error ? err.message : err);
        }
    }
    console.log(`[era] UNLOCKED ${def.id} (${source})${credited ? ` credited to ${credited.player}` : ''}`);
    return true;
}

/** Nightly cron pass: evaluate unlocks. No-op unless ENABLE_LEGACY=1. */
export async function runEraDailyPass(): Promise<{ enabled: boolean; unlocked: string[] }> {
    if (!legacyEnabled()) return { enabled: false, unlocked: [] };
    const unlocked = await checkEraUnlocks();
    return { enabled: true, unlocked };
}

export { ERA_DEFS, ERA_BY_ID };
