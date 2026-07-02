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
        const state = await getEraState();
        for (const def of ERA_DEFS) {
            if (def.trigger?.kind !== kind) continue;
            // Only bank a trigger while the era is actually running its
            // milestone phase — a locked / admin_available / already-unlocked
            // era must not claim its once-ever finisher (verification finding).
            if (effectiveStatus(def, state.overrides[def.id]) !== 'milestone_active') continue;
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
        // Recovery sweep: finish side effects for any gated era that is
        // unlocked but whose effects didn't complete (e.g. a crash between the
        // state flip and the announcement). Idempotent — no-op once done.
        for (const def of ERA_DEFS) {
            if (!isGatedEra(def)) continue;
            if (effectiveStatus(def, state.overrides[def.id]) !== 'unlocked') continue;
            if (await kv.get(effectsDoneKey(def.id))) continue;
            await completeEraEffects(def);
        }
    } catch (err) {
        console.error('[era] unlock check failed:', err instanceof Error ? err.message : err);
    }
    return unlocked;
}

const effectsDoneKey = (id: string) => `era:effects-done:${id}`;
const announcedNxKey = (id: string) => `era:announced:${id}`;

/** Only eras with milestones or a credited trigger emit world-history side
 *  effects. Launch eras (I–IV: no milestones, no trigger, initialStatus
 *  'unlocked') are history that already happened — force-unlocking them must
 *  never broadcast breaking mythic news (verification finding). */
function isGatedEra(def: EraDef): boolean {
    return def.milestones.length > 0 || !!def.trigger;
}

/**
 * Flip an era to unlocked and drive its once-ever side effects to completion.
 * The STATE flip is idempotent and PRESERVES existing credit (an admin cycling
 * the status can't overwrite unlockedBy/At). The side effects
 * (announce/hall/title) are each individually idempotent and driven by a
 * separate `era:effects-done:<id>` marker — so a crash after the flip is fully
 * recovered by ANY later call (the nightly pass sweeps unlocked-but-incomplete
 * eras), closing the "stranded announcement" window. Returns true when this
 * call performed the state transition.
 */
export async function unlockEra(
    def: EraDef,
    credited: EraTriggerRecord | null,
    _source: 'milestone' | 'admin',
): Promise<boolean> {
    const now = Date.now();
    let transitioned = false;
    await withKvLock(ERA_STATE_KEY, async () => {
        const state = await getEraState();
        const override = state.overrides[def.id];
        // Guard on EFFECTIVE status: a launch-unlocked era (I–IV) has no
        // override but is already 'unlocked', so force-unlocking it is a no-op.
        if (effectiveStatus(def, override) === 'unlocked') return;
        state.overrides[def.id] = {
            ...override,
            status: 'unlocked',
            // Preserve any credit already recorded; only fill it in on the
            // genuine first unlock.
            unlockedBy: override?.unlockedBy ?? credited?.player ?? null,
            unlockedVillage: override?.unlockedVillage ?? credited?.village ?? null,
            unlockedAt: override?.unlockedAt ?? now,
        };
        await kv.set(ERA_STATE_KEY, state);
        transitioned = true;
    }, { failClosed: true });

    if (!isGatedEra(def)) return transitioned; // launch era: no side effects, ever
    await completeEraEffects(def);
    return transitioned;
}

/** Idempotently finish an unlocked era's side effects. Safe to call repeatedly
 *  (each effect self-guards); the daily pass calls it for any unlocked-but-
 *  incomplete gated era, so nothing stays half-unlocked. */
export async function completeEraEffects(def: EraDef): Promise<boolean> {
    if (await kv.get(effectsDoneKey(def.id))) return false;
    const state = await getEraState();
    const override = state.overrides[def.id];
    if (effectiveStatus(def, override) !== 'unlocked') return false;

    const player = override?.unlockedBy ?? undefined;
    const village = override?.unlockedVillage ?? undefined;
    const message = def.unlockMessage
        .replace('{player}', player ?? 'the shinobi of the world')
        .replace('{village}', village ?? 'every village');

    // Announce once (NX-guarded so a retry after a crash never double-posts).
    if ((await kv.set(announcedNxKey(def.id), '1', { nx: true })) === 'OK') {
        await announce({
            type: 'era_unlock', importance: 'mythic',
            title: def.unlockTitle, message,
            player, village, meta: { eraId: def.id },
        });
    }
    // Permanent Hall entry (own NX via nxKey).
    await addHallEntry({
        entryType: 'era_unlock', title: def.name, description: message,
        player, village, meta: { eraId: def.id },
    }, { nxKey: `era:${def.id}` });

    // Grant the credited finisher their era title (serverTitles = the
    // server-owned ownership source; idempotent includes-check).
    if (player && def.trigger?.title) {
        try {
            await withKvLock(`save:${player}`, async () => {
                const rec = await kv.get<Record<string, unknown>>(`save:${player}`);
                const char = (rec?.character ?? null) as Record<string, unknown> | null;
                if (!rec || !char) return;
                const earned = Array.isArray(char.earnedTitles) ? (char.earnedTitles as string[]) : [];
                const server = Array.isArray(char.serverTitles) ? (char.serverTitles as string[]) : [];
                if (server.includes(def.trigger!.title)) return;
                const updated = {
                    ...char,
                    serverTitles: [...server, def.trigger!.title],
                    earnedTitles: earned.includes(def.trigger!.title) ? earned : [...earned, def.trigger!.title],
                };
                await kv.set(`save:${player}`, mergePreservingImages(bumpSaveVersion({ ...rec, character: updated }), rec));
            });
        } catch (err) {
            console.error('[era] title grant failed:', err instanceof Error ? err.message : err);
        }
    }
    await kv.set(effectsDoneKey(def.id), true);
    console.log(`[era] side effects complete for ${def.id}${player ? ` (credited ${player})` : ''}`);
    return true;
}

/** Nightly cron pass: evaluate unlocks. No-op unless ENABLE_LEGACY=1. */
export async function runEraDailyPass(): Promise<{ enabled: boolean; unlocked: string[] }> {
    if (!legacyEnabled()) return { enabled: false, unlocked: [] };
    const unlocked = await checkEraUnlocks();
    return { enabled: true, unlocked };
}

export { ERA_DEFS, ERA_BY_ID };
