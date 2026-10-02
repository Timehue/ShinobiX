/*
 * Sector War Garrison Assault — KV storage.
 *
 * Mirrors the run-record shape of api/_anbu-infiltration-store.ts (InfilRun),
 * scoped to garrison: the authoritative binding from a Combat sector-war
 * contest's attacker to the ANBU snapshot they're assaulting, plus a durable
 * settlement receipt on the ATTACKER'S OWN save (item usage + surviving
 * HP/hospital — this is a real multi-turn fight now, not a free instant
 * dice-roll, so it costs the same as any other sealed AI fight). The CONTEST
 * scoring itself is NOT settled here — that stays api/village/sector-war.ts's
 * job, under the contest's own lock, reusing the exact same
 * applySectorWarBattle/GARRISON_POINTS_CAP machinery a live-defender fight
 * uses (api/_sector-war.ts).
 *
 * ANBU roster/snapshot selection is NOT duplicated here. loadAnbuAppointees /
 * pickAnbuDefender / getOrSealAnbuSnapshot are re-exported straight from
 * api/_anbu-infiltration-store.ts — "read the jutsu/equipment/weapons/items…
 * and use it all properly" is exactly what that store already does, tested,
 * for a different attacker; garrison just picks a different village's ANBU
 * for a different contest.
 */
import { kv as realKv, type KvLike } from './_storage.js';
import { appendSettlementReceipt, inspectSettlementReceipt } from './_settlement-receipts.js';
import { mutatePlayerSave } from './save/_mutate-player-save.js';
import { retryOnSaveVersionConflict } from './save/_projected-write.js';
import { applySoloPveUsageCosts } from './solo-pve/_settlement.js';
import type { SoloPveSession } from './solo-pve/_session.js';
import { applyAiFightOutcomeToCharacter, resolveAiFightOutcome } from './missions/_ai-fight-outcome.js';

export {
    loadAnbuAppointees,
    pickAnbuDefender,
    getOrSealAnbuSnapshot,
    type AnbuSnapshot,
} from './_anbu-infiltration-store.js';

// ─── injectable deps ─────────────────────────────────────────────────────────
/** The run records' store. The attacker's save never goes through it: that
 *  commits through mutatePlayerSave on the shared KV (settleGarrisonFight). */
export type GarrisonKv = Pick<KvLike, 'get' | 'set' | 'del'>;
export type StoreDeps = { kv?: GarrisonKv; now?: () => number };
export type GarrisonSettleDeps = Pick<StoreDeps, 'now'>;
function resolve(deps: StoreDeps) {
    return {
        kv: deps.kv ?? realKv,
        now: deps.now ?? (() => Date.now()),
    };
}

// ─── key scheme ──────────────────────────────────────────────────────────────
export const garrisonRunKey = (runId: string) => `sector-war-garrison:${runId}`;
export const garrisonActiveRunKey = (attackerName: string, sector: number) =>
    `sector-war-garrison-active:${attackerName}:${Math.floor(Number(sector) || 0)}`;

export const GARRISON_RUN_TTL = 60 * 60;              // outlives the 45-minute combat TTL
export const GARRISON_TERMINAL_RUN_TTL = 7 * 24 * 60 * 60;

/** The authoritative live run binding plus sealed assault context (which
 *  contest, which ANBU defends). All scoring parameters derive from THIS
 *  record at resolve — never from the client. */
export interface GarrisonRun {
    runId: string;
    attackerName: string;
    attackerVillage: string;
    sector: number;
    /** the sector-war contest id this assault is bound to */
    contestId: string;
    defenderVillage: string;
    /** which appointed ANBU is defending this run */
    anbuSlug: string;
    anbuName: string;
    /** sector terrain at start (biome / home-terrain edge, sealed) */
    terrain: string;
    createdAt: number;
    startState?: 'prepared' | 'ready';
    settlement?: {
        settledAt: number;
        response: Record<string, unknown>;
    };
}

export async function readGarrisonRun(runId: string, deps: StoreDeps = {}): Promise<GarrisonRun | null> {
    const { kv } = resolve(deps);
    return await kv.get<GarrisonRun>(garrisonRunKey(runId));
}

export async function writeGarrisonRun(run: GarrisonRun, deps: StoreDeps = {}): Promise<void> {
    const { kv } = resolve(deps);
    await kv.set(garrisonRunKey(run.runId), run, { ex: run.settlement ? GARRISON_TERMINAL_RUN_TTL : GARRISON_RUN_TTL });
}

export async function deleteGarrisonRun(runId: string, deps: StoreDeps = {}): Promise<void> {
    const { kv } = resolve(deps);
    await kv.del(garrisonRunKey(runId));
}

function num(v: unknown, fallback = 0): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

const RECEIPT_CONFLICT = 'receipt-conflict';

export type SettleGarrisonFightOutcome =
    | { ok: true; alreadySettled: boolean; saveVersion: number; character: Record<string, unknown> }
    | { ok: false; error: 'no-save' | 'receipt-conflict' };

/**
 * Persist the fight's physical consequence onto the ATTACKER's own save:
 * proven item usage plus surviving HP / a hospital stay on a knockout, exactly
 * like every other sealed AI fight (api/missions/_ai-fight-outcome.ts). This
 * runs regardless of win/loss/draw — a garrison assault is a real multi-turn
 * fight now, so losing (or even winning) still burns potions/chakra items and
 * can send the attacker to the hospital. Without this, garrison-start /
 * garrison-resolve would be a free, consequence-free item-farm against a real
 * AI opponent, since garrison itself pays the attacker no reward at all.
 *
 * Idempotent via a settlement receipt on the character (separate from the run
 * record's own `settlement` cache — the two writes are not atomic with each
 * other), mirroring settleInfiltrationLoss in _anbu-infiltration-store.ts.
 *
 * Commits through mutatePlayerSave. The fight writes HP only, so the chakra and
 * stamina the attacker recovered while the assault ran are settled into the
 * same write rather than discarded by its version bump. The receipt rides in
 * that write too, so re-running after a lost compare-and-set applies the cost
 * exactly once.
 */
export async function settleGarrisonFight(
    run: GarrisonRun,
    session: SoloPveSession,
    deps: GarrisonSettleDeps = {},
): Promise<SettleGarrisonFightOutcome> {
    const { now } = resolve(deps);
    const receiptId = `sector-war-garrison-${run.runId}`.slice(0, 80);
    const fingerprint = `${run.attackerName}:${run.sector}:${run.contestId}:${run.anbuSlug}`;
    const result = await retryOnSaveVersionConflict(() => mutatePlayerSave<{ alreadySettled: boolean }>(run.attackerName, ({ character }) => {
        const inspected = inspectSettlementReceipt(character, receiptId, fingerprint);
        if (inspected.status === 'conflict' || inspected.status === 'invalid') {
            return { ok: false, status: 409, error: RECEIPT_CONFLICT };
        }
        if (inspected.status === 'replay') {
            return { ok: true, write: false, character, value: { alreadySettled: true } };
        }
        const settledAt = now();
        const settledCharacter = applyAiFightOutcomeToCharacter(
            applySoloPveUsageCosts(character, session),
            resolveAiFightOutcome(session),
            session.player,
            settledAt,
        );
        return {
            ok: true,
            character: appendSettlementReceipt(settledCharacter, inspected.receipts, {
                requestId: receiptId,
                fingerprint,
                value: { kind: 'sector-war-garrison', outcome: session.outcome ?? 'unknown' },
                settledAt,
            }),
            value: { alreadySettled: false },
        };
    }));
    if (!result.ok) {
        // Anything but the receipt refusal is a missing save (or an attacker
        // name that could never key one), which the route answers with a 404.
        return { ok: false, error: result.error === RECEIPT_CONFLICT ? 'receipt-conflict' : 'no-save' };
    }
    return {
        ok: true,
        alreadySettled: result.value.alreadySettled,
        saveVersion: num(result._saveVersion),
        character: result.character,
    };
}
