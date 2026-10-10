/*
 * Settling a finished Combat garrison assault: the one place it happens.
 *
 * A garrison assault is a Solo-PvE fight (api/_sector-war-garrison-encounter.ts)
 * bound to a run record (api/_sector-war-garrison-store.ts). Its result used to
 * be settled ONLY when the attacker's client called garrison-resolve. A fight
 * that client never reported (a closed tab, a blocked request, a lost loss)
 * settled nothing: the defence never got its hold points, and a LOSS never cost
 * its hospital stay or its items. Three callers now settle it, and all three
 * land here:
 *
 *   - garrison-resolve: the client reports the fight it just finished.
 *   - garrison-start: a finished fight nobody reported is settled before the
 *     attacker may open another one on that sector.
 *   - the Solo-PvE terminal hook (api/solo-pve/action.ts and state.ts): the
 *     request that ENDS the fight, or the first read of it, settles it.
 *
 * Exactly once, whichever arrives first: the run lock serializes them, the run
 * caches its answer in `run.settlement`, the attacker's save carries its own
 * receipt (settleGarrisonFight), and the contest dedupes on the battle id
 * `garrison:<runId>`.
 *
 * Scoring reads the BATTLE's clock, never the settling request's: a fight that
 * ended while the war was live still counts when it is settled late, and one
 * that ended after the whistle (or belongs to an earlier war on the sector)
 * scores nothing and writes no receipt. This mirrors the world-PvP
 * continuation (api/pvp/_sector-war-continuation.ts).
 */
import { kv } from './_storage.js';
import { withKvLock } from './_lock.js';
import { safeLogValue } from './_safe-log.js';
import { normalizeVillageWarRecord, villageWarKey } from './_war-state.js';
import { defenderPointsMultiplier, sectorWarDamageMultiplier } from './_war-structures.js';
import { sectorControlSwing, sectorWarRoleOf, ROLE_VILLAGER } from './_war-role.js';
import { applySectorWarBattle, isSectorWarActive } from './_sector-war.js';
import { commitSectorWarBattle, loadSectorWar } from './_sector-war-store.js';
import { readSoloPveSession } from './solo-pve/_store.js';
import type { SoloPveSession } from './solo-pve/_session.js';
import {
    garrisonRunKey,
    readGarrisonRun,
    settleGarrisonFight,
    writeGarrisonRun,
    type GarrisonRun,
} from './_sector-war-garrison-store.js';
import {
    GARRISON_ENCOUNTER_KIND,
    garrisonSessionMatches,
    type GarrisonSessionBinding,
} from './_sector-war-garrison-encounter.js';

export type GarrisonSettleReply = { status: 200 | 403 | 404 | 409; body: Record<string, unknown> };

/** Who asked. `null` is the server settling on its own (the terminal hook),
 *  which the session binding already ties to the run's own attacker. */
export type GarrisonSettleActor = { name: string; admin: boolean } | null;

export function garrisonSessionBinding(run: GarrisonRun): GarrisonSessionBinding {
    return {
        runId: run.runId, attackerName: run.attackerName, sector: run.sector, contestId: run.contestId,
        attackerVillage: run.attackerVillage, defenderVillage: run.defenderVillage,
        anbuSlug: run.anbuSlug, terrain: run.terrain,
    };
}

/** When the fight ended: the terminal evidence's own stamp (a lapse is stamped
 *  at the moment it lapsed), never the moment somebody got round to settling. */
export function garrisonBattleEndedAt(session: SoloPveSession): number {
    const finished = Math.floor(Number(session.terminalEvidence?.finishedAt) || 0);
    if (finished > 0) return finished;
    const lastAction = Math.floor(Number(session.lastActionAt) || 0);
    return lastAction > 0 ? lastAction : Date.now();
}

export function isGarrisonSoloPveSession(session: Pick<SoloPveSession, 'encounter'> | null | undefined): boolean {
    return session?.encounter?.kind === GARRISON_ENCOUNTER_KIND;
}

/** Settle one run. The caller holds `garrisonRunKey(runId)`. */
export async function settleGarrisonRunLocked(runId: string, actor: GarrisonSettleActor): Promise<GarrisonSettleReply> {
    const run = await readGarrisonRun(runId);
    if (!run) return { status: 404, body: { error: 'Assault not found or expired.' } };
    if (actor && !actor.admin && run.attackerName !== actor.name) return { status: 403, body: { error: 'Not your assault.' } };
    if (run.settlement) return { status: 200, body: run.settlement.response };

    const session = await readSoloPveSession(runId);
    if (!garrisonSessionMatches(garrisonSessionBinding(run), session)) {
        return { status: 409, body: { error: 'The garrison combat binding is invalid.' } };
    }
    if (session.status !== 'done' || !session.terminalEvidence) {
        return { status: 409, body: { error: 'The assault is not finished.' } };
    }

    // The attacker's own combat consequence (item usage + surviving HP/hospital)
    // settles independent of whether the contest itself can still score — a real
    // fight was fought either way. Never trusts the client outcome: reads it off
    // the terminal session, same as every other AI fight settlement.
    const physical = await settleGarrisonFight(run, session);
    if (!physical.ok) {
        return physical.error === 'no-save'
            ? { status: 404, body: { error: 'Your save was not found.' } }
            : { status: 409, body: { error: 'The settlement receipt conflicts with this assault.' } };
    }

    const now = Date.now();
    const endedAt = garrisonBattleEndedAt(session);
    // Left idle past the active window: the server ended it as a walk-out.
    const lapsed = session.terminalEvidence.lapsedAt ? { lapsed: true } : {};
    const winner = session.winner;
    // A genuine draw (round budget exhausted with both sides standing, etc.)
    // scores nothing for either side of the contest — mirrors the old headless
    // resolver's 'stall' outcome.
    if (winner !== 'player' && winner !== 'enemy') {
        const contest = await loadSectorWar(run.contestId);
        const response = {
            ok: true, outcome: 'stall' as const,
            attackerPoints: contest?.attackerPoints ?? 0,
            defenderPoints: contest?.defenderPoints ?? 0,
            ...lapsed,
            character: physical.character, _saveVersion: physical.saveVersion,
        };
        await writeGarrisonRun({ ...run, settlement: { settledAt: now, response } });
        return { status: 200, body: response };
    }
    const attackerWon = winner === 'player';

    // Score the contest exactly like a live-defender fight would
    // (api/pvp/_sector-war-continuation.ts), just under the garrison's
    // half-weight fraction + war-wide cap (both applied inside
    // applySectorWarBattle via garrisonBattle/mercBattle). Keyed on the SOLO-PVE
    // SESSION ID (== runId), not on the time of this call — a retried settle
    // after a lost response must be a true no-op replay of the same receipt.
    const battleId = `garrison:${runId}`;
    const attackerRole = await sectorWarRoleOf(run.attackerName, run.attackerVillage);
    const [winnerRole, loserRole] = attackerWon ? [attackerRole, ROLE_VILLAGER] : [ROLE_VILLAGER, attackerRole];
    const committed = await commitSectorWarBattle({
        contestId: run.contestId,
        battleId,
        decide: async (fresh) => {
            // An assault opened against an earlier war on this sector never
            // scores the war that replaced it, and one that ENDED after this war
            // stopped being live is past the whistle. Both read the battle's own
            // clock, so a late settle can neither lose a real score nor add one.
            if (run.createdAt < fresh.startedAt || !isSectorWarActive(fresh, endedAt)) {
                return { kind: 'skip', reason: 'superseded' };
            }
            const [atkRaw, defRaw] = await Promise.all([
                kv.get<Record<string, unknown>>(villageWarKey(fresh.attackerVillage)),
                kv.get<Record<string, unknown>>(villageWarKey(fresh.defenderVillage)),
            ]);
            const outcome = applySectorWarBattle(fresh, attackerWon, {
                now: endedAt,
                roleSwing: sectorControlSwing(winnerRole, loserRole),
                attackerMult: sectorWarDamageMultiplier(normalizeVillageWarRecord(fresh.attackerVillage, atkRaw ?? undefined)),
                defenderMult: defenderPointsMultiplier(normalizeVillageWarRecord(fresh.defenderVillage, defRaw ?? undefined)),
                // Attacker win: the points are the PLAYER's (attribution for the
                // capture credit). Garrison win: the AI scored.
                by: attackerWon ? run.attackerName : '',
                garrisonBattle: attackerWon,
                mercBattle: !attackerWon,
            });
            return {
                kind: 'score', outcome, attackerWon,
                by: attackerWon ? run.attackerName : '', garrison: attackerWon, at: endedAt,
            };
        },
    });
    const scored = committed.status === 'applied'
        ? { ok: true as const, awarded: committed.receipt.points, session: committed.session }
        : { ok: false as const, contest: committed.status === 'skipped' ? committed.contest : null };

    const response = scored.ok
        ? {
            ok: true, outcome: attackerWon ? ('attacker' as const) : ('garrison' as const),
            attackerWon, points: scored.awarded,
            attackerPoints: scored.session.attackerPoints, defenderPoints: scored.session.defenderPoints,
            endsAt: scored.session.endsAt,
            ...lapsed,
            character: physical.character, _saveVersion: physical.saveVersion,
        }
        : {
            // The fight ended after the war on this sector did (captured,
            // defended, abandoned, or replaced by a new war). It still happened
            // and still settled onto the attacker's save above — it just no
            // longer moves a contest that is over.
            ok: true, outcome: 'superseded' as const,
            attackerPoints: scored.contest?.attackerPoints ?? 0,
            defenderPoints: scored.contest?.defenderPoints ?? 0,
            ...lapsed,
            character: physical.character, _saveVersion: physical.saveVersion,
        };
    await writeGarrisonRun({ ...run, settlement: { settledAt: now, response } });
    return { status: 200, body: response };
}

/** Settle one run under its own lock (fail-closed: a contended run throws
 *  LockContendedError, which the route answers as a retryable 503). */
export function settleGarrisonRun(runId: string, actor: GarrisonSettleActor): Promise<GarrisonSettleReply> {
    return withKvLock(garrisonRunKey(runId), () => settleGarrisonRunLocked(runId, actor), { failClosed: true, ttlSec: 30 });
}

/**
 * The Solo-PvE terminal hook: settle a garrison assault the moment its session
 * is seen terminal, without waiting for the attacker's client to report it.
 *
 * Best-effort by design. The fight is already over and stored; if this cannot
 * settle it now (the run lock is busy because the client is reporting it at the
 * same instant, a storage blip), the client's garrison-resolve and the next
 * garrison-start still will, and every path is the same exactly-once settle.
 * It never throws into the combat request that called it.
 */
export async function settleTerminalGarrisonSession(
    session: SoloPveSession | null | undefined,
): Promise<GarrisonSettleReply | null> {
    if (!session || session.status !== 'done' || !isGarrisonSoloPveSession(session)) return null;
    try {
        return await settleGarrisonRun(session.sessionId, null);
    } catch (error) {
        console.warn('[sector-war-garrison] terminal settlement deferred:', safeLogValue(error));
        return null;
    }
}
