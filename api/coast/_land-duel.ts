/*
 * Where a finished world duel meets a land contest on the Unmapped Coast.
 *
 * When a clan declares on a sector another clan holds, duels fought in that
 * sector between the two rosters score for the winner's side (_land.ts). This
 * is the check that a finished PvP session is such a duel. It is called from
 * the PvP terminal settlement, which runs on the server for either fighter's
 * retry, so no browser reports a duel and nothing here trusts one.
 *
 * A duel scores only if all of this holds:
 *   - it was open-world PvP (reward authority `world`), with both fighters
 *     joined and progression allowed. A spar, a ranked match, an arena fight
 *     and a clan-war queue match never count;
 *   - it had a winner;
 *   - it was a real fight. A win the game itself pays nothing for (the loser
 *     fled or stopped answering in the opening rounds, api/pvp/_valid-fight.ts)
 *     scores nothing here either, so a clan cannot be handed points by an
 *     opponent who walks in and gives up;
 *   - the two accounts have not recently shared an address or a browser. This
 *     is the same check ranked uses, read as it is and not changed here, so
 *     one person's two accounts cannot feed each other points;
 *   - the server's own record of where the fight happened is a coast sector
 *     with a contest whose holder is defending.
 * The contest then applies its own rules: opposite rosters, and one point per
 * pair per day.
 */
import { kv } from '../_storage.js';
import { safeName } from '../_utils.js';
import { hasRecentIpOrFpOverlapStrict } from '../_player-ips.js';
import { pvpSessionMayGrantProgress, type PvpSession } from '../pvp/session.js';
import { pvpWorldBattleSector } from '../pvp/_sector-war-continuation.js';
import { classifyPvpTerminal, pvpWinShortMult } from '../pvp/_valid-fight.js';
import { isCoastSector } from '../../shared/world-maps.js';
import { readCoastContest, recordCoastContestDuel } from './_land.js';

export async function settleCoastContestDuel(session: PvpSession, now = Date.now()): Promise<Awaited<ReturnType<typeof recordCoastContestDuel>> | null> {
    if (session.rewardAuthority !== 'world' || !pvpSessionMayGrantProgress(session)) return null;
    if (session.winner !== 'p1' && session.winner !== 'p2') return null;
    const sector = pvpWorldBattleSector(session);
    if (!isCoastSector(sector)) return null;
    // Most coast duels are fought where no clan is defending; stop before any other read.
    if (!(await readCoastContest(sector))?.defender) return null;
    const winner = safeName(String((session.winner === 'p1' ? session.p1 : session.p2).name ?? ''));
    const loser = safeName(String((session.winner === 'p1' ? session.p2 : session.p1).name ?? ''));
    if (!winner || !loser || winner === loser) return null;
    if (pvpWinShortMult(classifyPvpTerminal(session, now)) <= 0) return { counted: false, reason: 'no-fight' };
    if (await hasRecentIpOrFpOverlapStrict(winner, loser, kv)) return { counted: false, reason: 'shared-device' };
    // The duel is judged by when it ended. This runs again whenever either
    // fighter's settlement is read, which can be after the contest has closed.
    const endedAt = Number(session.endedAt);
    const foughtAt = Number.isFinite(endedAt) && endedAt > 0 ? Math.min(endedAt, now) : now;
    return recordCoastContestDuel({ sector, winner, loser, battleId: session.battleId, now: foughtAt });
}
