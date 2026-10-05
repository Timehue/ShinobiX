import { kv } from '../_storage.js';
import { runBackgroundWork } from '../_background-work.js';
import { isIncapacitated } from '../_elapsed-state.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import type { Tournament, TournamentEntry, TournamentMatch } from '../../shared/tournaments.js';
import { advanceBracket, matchSeed, openBracket, resolveNoShow } from './_bracket.js';
import { createTowerPvpMatch, activateReadyTowerPvpMatch, bumpTowerPvpVersion, type TowerPvpFighterSeed, type StoredTowerPvpMatch } from '../towers/_pvp-session.js';
import { readTowerPvpMatch, writeTowerPvpMatch, withTowerPvpMatchMutation, releaseTerminalTowerPvpLeases } from '../towers/_pvp-store.js';
import { towerPvpState } from '../towers/_pvp-lifecycle.js';
import { claimTowerBattleLeases, releaseTowerBattleLeases } from '../towers/_battle-lease.js';
import { resolvePvpPetDuel } from '../pet/_pvp-duel.js';
import type { Pet } from '../_pet-sim/pet-types.js';
import type { ShowdownReplayScript } from '../../shared/pet-showdown-contract.js';

export const TOURNAMENT_KEY = 'game:tournaments:current';
export const loadoutKey = (eventId: string, playerId: string) => `game:tournaments:loadout:${eventId}:${playerId}`;
export const replayKey = (id: string) => `game:tournaments:replay:${id}`;
export const readTournament = () => kv.get<Tournament>(TOURNAMENT_KEY);
export const tournamentLock = <T>(fn: () => Promise<T>) => withKvLock(TOURNAMENT_KEY, fn, { failClosed: true, ttlSec: 120 });
export type TournamentLoadout = { fighter?: TowerPvpFighterSeed; pets?: Pet[] };
export type PetTournamentResult = { winner: string; script: ShowdownReplayScript };
export function matchMembers(event: Tournament, match: TournamentMatch): string[] {
    return event.entries.filter(e => e.id === match.a || e.id === match.b).flatMap(e => e.members.map(m => m.id));
}
function applyCombatResult(match: TournamentMatch, combat: StoredTowerPvpMatch) {
    if (combat.status !== 'done' && combat.status !== 'cancelled') return;
    match.winner = combat.status === 'cancelled' ? null : combat.winner === 'amber' ? match.a
        : combat.winner === 'violet' ? match.b : matchSeed(match.id) % 2 === 0 ? match.a : match.b;
    match.status = 'done'; match.reason = combat.status === 'cancelled' ? 'Battle cancelled' : combat.winner === 'draw' ? 'Draw decided by bracket seed' : 'Battle result';
}
async function startMatch(event: Tournament, match: TournamentMatch, now: number) {
    const members = matchMembers(event, match);
    // A tournament round is published asynchronously after players ready. Recheck
    // live health here as well as at the ready endpoint so a hospitalization
    // between readiness and publication cannot seal a new fight.
    const incapacitated = (await Promise.all(members.map(async id => {
        const save = await kv.get<{ character?: Record<string, unknown> }>(`save:${id}`);
        return !save?.character || isIncapacitated(save.character, now) ? id : null;
    }))).filter((id): id is string => id !== null);
    if (incapacitated.length) {
        match.ready = match.ready.filter(id => !incapacitated.includes(id));
        return;
    }
    const a = event.entries.find(e => e.id === match.a)!, b = event.entries.find(e => e.id === match.b)!;
    const snapshots = await Promise.all(members.map(id => kv.get<TournamentLoadout>(loadoutKey(event.id, id))));
    if (snapshots.some(s => !s)) throw new Error('Tournament loadout missing.');
    const byId = new Map(members.map((id, i) => [id, snapshots[i]!]));
    if (event.mode === 'pet') {
        let result = await kv.get<PetTournamentResult>(replayKey(match.id));
        if (!result) {
            const resolved = resolvePvpPetDuel({ challengeId: match.id, a: a.members[0]!.id, b: b.members[0]!.id,
                aPets: byId.get(a.members[0]!.id)!.pets!, bPets: byId.get(b.members[0]!.id)!.pets!,
                format: event.petFormat, seed: matchSeed(match.id), sealedAt: now });
            result = { winner: resolved.winnerName === a.members[0]!.id ? a.id : b.id, script: resolved.script };
            await kv.set(replayKey(match.id), result, { ex: 7 * 86400 });
        }
        match.winner = result.winner; match.status = 'done'; match.reason = 'Colosseum result';
        return;
    }
    const existing = await readTowerPvpMatch(match.battleId);
    if (existing) { match.status = 'active'; applyCombatResult(match, existing); return; }
    const lease = await claimTowerBattleLeases({ runId: match.battleId, members, mode: 'tournament' });
    if (!lease.ok) {
        match.ready = match.ready.filter(id => !lease.members.includes(id));
        return; // Busy players must finish their other fight and ready again.
    }
    try {
        const battle = createTowerPvpMatch({ matchId: match.battleId, now, seed: matchSeed(match.id),
            fighters: members.map(id => byId.get(id)!.fighter!),
            teams: { amber: a.members.map(m => m.id), violet: b.members.map(m => m.id) },
            binding: { kind: 'tournament', eventId: event.id, bracketMatchId: match.id, endsAt: match.endsAt, tieWinner: matchSeed(match.id) % 2 === 0 ? 'amber' : 'violet' } });
        battle.roster.forEach(m => { m.ready = true; });
        activateReadyTowerPvpMatch(battle, now);
        await writeTowerPvpMatch(battle);
        match.status = 'active';
    } catch (error) {
        // A commit followed by a lost acknowledgement must retain its live leases.
        if (!(await readTowerPvpMatch(match.battleId))) await releaseTowerBattleLeases(match.battleId, members);
        throw error;
    }
}
/** Caller holds the event lock. Absolute timestamps survive downtime and redeploys. */
export async function progressTournament(event: Tournament, now = Date.now()) {
    if (event.cancelRequested) { await cancelTournament(event); return; }
    openBracket(event, now);
    for (let pass = 0; event.status === 'live' && pass < 8; pass++) {
        const results = await Promise.allSettled(event.matches.filter(m => m.round === event.round && m.status !== 'done').map(async match => {
            // Resolve an already published fight before testing no-show deadlines (lost event write recovery).
            if (event.mode !== 'pet') {
                const battle = await readTowerPvpMatch(match.battleId);
                if (battle) {
                    match.status = 'active';
                    const fresh = await towerPvpState(match.battleId, battle.roster[0]!.slug);
                    if (!fresh.ok) throw new Error(fresh.error);
                    applyCombatResult(match, fresh.match);
                    return;
                }
            } else {
                const replay = await kv.get<PetTournamentResult>(replayKey(match.id));
                if (replay) { match.winner = replay.winner; match.status = 'done'; match.reason = 'Colosseum result'; return; }
            }
            if (now >= match.readyEndsAt) { resolveNoShow(event, match); return; }
            if (matchMembers(event, match).every(id => match.ready.includes(id))) await startMatch(event, match, now);
        }));
        // Keep successful results durable even if a different battle had a transient error.
        await kv.set(TOURNAMENT_KEY, event);
        const failed = results.find(r => r.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
        if (!advanceBracket(event, now)) break;
    }
    await kv.set(TOURNAMENT_KEY, event);
}
export async function cancelTournament(event: Tournament) {
    // Durable intent prevents a partial cleanup from advancing players after an admin cancel.
    event.cancelRequested = true;
    await kv.set(TOURNAMENT_KEY, event);
    for (const match of event.matches) {
        await withTowerPvpMatchMutation(match.battleId, async battle => {
            if (!battle) return;
            if (battle.status === 'active' || battle.status === 'ready') {
                battle.status = 'cancelled'; battle.cancellationReason = 'player-left';
                battle.combat.status = 'done'; battle.combat.winner = 'draw';
                bumpTowerPvpVersion(battle, Date.now());
                await writeTowerPvpMatch(battle);
            }
            await releaseTerminalTowerPvpLeases(battle);
        });
        if (match.status !== 'done') { match.status = 'done'; match.winner = null; match.reason = 'Tournament cancelled'; }
    }
    event.status = 'cancelled'; event.message = 'Cancelled by the administrator.';
    delete event.cancelRequested;
    await kv.set(TOURNAMENT_KEY, event);
}
export function entryForPlayer(event: Tournament, id: string): TournamentEntry | undefined {
    return event.entries.find(e => e.members.some(m => m.id === id));
}
export async function tickTournaments() {
    const current = await readTournament();
    if (!current || (!current.cancelRequested && current.status !== 'live' && (current.status !== 'signup' || current.signupEndsAt > Date.now()))) return;
    // Many spectators can poll the board; only one worker scans combat per interval.
    if (await kv.set('game:tournaments:tick', current.id, { nx: true, ex: 3 }) === null) return;
    await tournamentLock(async () => { const event = await readTournament(); if (event) await progressTournament(event); });
}
export function startTournamentClock() {
    let running = false;
    const tick = async () => {
        if (running) return;
        running = true;
        try { await tickTournaments(); }
        catch (error) { if (!(error instanceof LockContendedError)) console.error('[tournaments] Timer update failed', error instanceof Error ? error.message : 'Unknown error'); }
        finally { running = false; }
    };
    const timer = setInterval(() => { void runBackgroundWork(tick); }, 5000); timer.unref(); void runBackgroundWork(tick);
    return () => clearInterval(timer);
}
