/*
 * Taking a deleted account's name off the coast's shared records.
 *
 * An account's own coast rows are cleared by key (api/_delete-player-account.ts).
 * Two shared rows also name players, and a name can be registered again:
 *   - a contest's rosters are frozen at its declaration, so a deleted member
 *     stayed listed until the contest closed, and whoever took the name next
 *     was on a roster they never earned;
 *   - a Landing lists who gave what each week, and who staked it.
 *
 * Only the name goes. A contest keeps its score and a Landing keeps its stores:
 * what the player did for the clan while they were in it still counts.
 *
 * Locks: one contest key or one Landing key at a time, never the land lock, a
 * clan lock or a save. That is the order scoring and contributing already use.
 */
import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { clanBareSlug, safeName } from '../_utils.js';
import { OPEN_COAST_SECTOR_IDS } from '../../shared/coast-world.js';
import { coastContestKey, isContestableCoastSector, readCoastContest, type CoastContest } from './_land.js';
import { coastLandingKey, readCoastLanding } from './_landing-store.js';
import type { CoastLanding } from './_landing-rules.js';

const lockOptions = { failClosed: true, maxAttempts: 10, baseBackoffMs: 30 } as const;

/** True when the contest row names this player anywhere. */
function contestNames(contest: CoastContest, player: string): boolean {
    return contest.roster.includes(player) || !!contest.defender?.roster.includes(player) || Object.hasOwn(contest.wins, player)
        || (contest.duels ?? []).some(pair => pair.split('|').slice(0, 2).includes(player));
}

function withoutPlayer(contest: CoastContest, player: string): CoastContest {
    const wins = { ...contest.wins };
    delete wins[player];
    return {
        ...contest,
        roster: contest.roster.filter(name => name !== player),
        wins,
        ...(contest.duels ? { duels: contest.duels.filter(pair => !pair.split('|').slice(0, 2).includes(player)) } : {}),
        ...(contest.defender ? { defender: { ...contest.defender, roster: contest.defender.roster.filter(name => name !== player) } } : {}),
    };
}

/**
 * Remove the name from every contest and from the Landing of the clan the
 * account was in. Returns what was touched, for the deletion report.
 */
export async function releaseCoastRecordsOfPlayer(playerName: string, clanName: string | null | undefined): Promise<string[]> {
    const player = safeName(playerName);
    if (!player) return [];
    const touched: string[] = [];

    for (const sector of OPEN_COAST_SECTOR_IDS) {
        if (!isContestableCoastSector(sector)) continue;
        // Most sectors have no contest, and most contests do not name this player: look before locking.
        const seen = await readCoastContest(sector);
        if (!seen || !contestNames(seen, player)) continue;
        const key = coastContestKey(sector);
        await withKvLock(key, async () => {
            const contest = await readCoastContest(sector);
            if (!contest || !contestNames(contest, player)) return;
            await kv.set(key, withoutPlayer(contest, player));
            touched.push(`coast-contest:${sector}`);
        }, lockOptions);
    }

    const clanSlug = clanBareSlug(String(clanName ?? ''));
    if (clanSlug) {
        const named = (landing: CoastLanding | null) => !!landing
            && (landing.foundedBy === player || Object.values(landing.contributions ?? {}).some(week => Object.hasOwn(week, player)));
        if (named(await readCoastLanding(clanSlug))) {
            const key = coastLandingKey(clanSlug);
            await withKvLock(key, async () => {
                const landing = await readCoastLanding(clanSlug);
                if (!landing || !named(landing)) return;
                const contributions = Object.fromEntries(Object.entries(landing.contributions ?? {}).map(([week, givers]) => {
                    const rest = { ...givers };
                    delete rest[player];
                    return [week, rest];
                }));
                await kv.set(key, { ...landing, contributions, foundedBy: landing.foundedBy === player ? '' : landing.foundedBy } satisfies CoastLanding);
                touched.push(`coast-landing:${clanSlug}`);
            }, lockOptions);
        }
    }
    return touched;
}
