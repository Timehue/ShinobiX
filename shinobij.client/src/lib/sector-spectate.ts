import { GAME_STATE_API } from '../constants/game';
import { playerSlug as accountKey } from './utils';
import { parsePvpSessionProjection } from './pvp-session-runtime';
import type { ArenaSpectatorFight } from './world-state';

/** Look up on demand, then verify the public session before leaving the sector.
 * Fighting also covers modes without a spectator stream; never invent a session. */
export async function findSectorSpectatorBattle(target: string, viewer: string, request: typeof fetch = fetch): Promise<string> {
    const signal = AbortSignal.timeout(10_000);
    const feed = await request(GAME_STATE_API, { cache: 'no-store', signal });
    if (!feed.ok) throw new Error('Could not load live fights. Try again.');
    const data = await feed.json() as { arenaActiveFights?: ArenaSpectatorFight[] };
    const fights = (Array.isArray(data.arenaActiveFights) ? data.arenaActiveFights : [])
        .filter(f => f.battleId && Array.isArray(f.fighters) && f.fighters.some(name => accountKey(name) === accountKey(target)))
        .sort((a, b) => b.startedAt - a.startedAt);
    const fight = fights[0];
    if (!fight?.battleId) throw new Error('This fight is not available to spectate. Try again shortly.');
    const response = await request(`/api/pvp/session?id=${encodeURIComponent(fight.battleId)}`, { cache: 'no-store', signal });
    if (!response.ok) throw new Error(response.status === 404 ? 'This fight has ended.' : 'Could not open this fight. Try again.');
    const parsed = parsePvpSessionProjection(await response.json(), fight.battleId);
    if (parsed.kind !== 'session' || parsed.session.status !== 'active')
        throw new Error('This fight has ended or is no longer available.');
    const fighters = [parsed.session.p1.name, parsed.session.p2.name].map(accountKey);
    if (!fighters.includes(accountKey(target)))
        throw new Error('This fight has ended or is no longer available.');
    if (fighters.includes(accountKey(viewer))) throw new Error('You are a participant in this fight. Resume it from your battle screen.');
    return fight.battleId;
}
