/*
 * Clan War — participation / win clan-point payouts on a finalized challenge.
 *
 * Extracted verbatim from api/clan/war/report.ts so the server-resolved PET path
 * (api/clan/war/pet.ts) pays exactly the same points through exactly the same
 * code. Behaviour is unchanged — this is a move, not a rewrite. Every award is
 * keyed by a stable `eventId`, so awardClanPointsToPlayerSave dedupes replays.
 *
 * Underscore-prefixed → a shared helper, not a route.
 */

import { awardClanPointsToPlayerSave } from '../../_clan-points.js';
import type { ClanWar, ClanChallenge } from './_storage.js';

export const CLAN_WAR_PARTICIPATION_POINTS = 25;
export const CLAN_WAR_CHALLENGE_WIN_POINTS = 25;
export const CLAN_WAR_VICTORY_POINTS = 75;

export function challengeParticipants(ch: ClanChallenge): string[] {
    return [...new Set([
        ch.fromPlayer,
        ch.fromPlayer2,
        ch.acceptedPlayer,
        ch.acceptedPlayer2,
    ].filter((name): name is string => typeof name === 'string' && name.trim().length > 0).map((name) => name.toLowerCase()))];
}

export function challengeWinners(ch: ClanChallenge): string[] {
    if (ch.result === 'from-wins') return [ch.fromPlayer, ch.fromPlayer2].filter(Boolean) as string[];
    if (ch.result === 'to-wins') return [ch.acceptedPlayer, ch.acceptedPlayer2].filter(Boolean) as string[];
    return [];
}

export function challengeParticipantsForClan(war: ClanWar, ch: ClanChallenge, clan: string): string[] {
    const defenderClan = war.clans.find(c => c !== ch.fromClan) ?? '';
    if (ch.fromClan === clan) return [ch.fromPlayer, ch.fromPlayer2].filter(Boolean) as string[];
    if (defenderClan === clan) return [ch.acceptedPlayer, ch.acceptedPlayer2].filter(Boolean) as string[];
    return [];
}

type WarPointEvent = {
    source: 'clanWarParticipation' | 'clanWarWin';
    amount: number;
    metadata: Record<string, unknown>;
};

function addWarPointEvent(events: Map<string, WarPointEvent[]>, player: string, event: WarPointEvent): void {
    const key = player.toLowerCase();
    if (!key) return;
    events.set(key, [...(events.get(key) ?? []), event]);
}

async function applyWarPointEvents(player: string, events: WarPointEvent[]): Promise<Record<string, unknown> | undefined> {
    let character: Record<string, unknown> | undefined;
    for (const event of events) {
        const award = await awardClanPointsToPlayerSave(player, event.source, event.amount, event.metadata);
        if (award.found) character = award.character;
    }
    return character;
}

/**
 * Pay out a finalized challenge. Returns the acting player's updated character so
 * the caller can echo it back in the response (the other participants' saves are
 * written too, but their clients pick the change up on their next load).
 */
export async function awardFinalizedWarPoints(body: Record<string, unknown>, actorName: string): Promise<Record<string, unknown> | undefined> {
    if (body.tentative) return undefined;
    const war = body.war as ClanWar | undefined;
    const challenge = body.challenge as ClanChallenge | undefined;
    if (!war || !challenge || challenge.status !== 'completed' || !challenge.result || challenge.result === 'draw') return undefined;

    const events = new Map<string, WarPointEvent[]>();
    for (const participant of challengeParticipants(challenge)) {
        addWarPointEvent(events, participant, {
            source: 'clanWarParticipation',
            amount: CLAN_WAR_PARTICIPATION_POINTS,
            metadata: { eventId: `war:${war.id}:${challenge.id}:participation:${participant}`, warId: war.id, challengeId: challenge.id },
        });
    }
    for (const winner of challengeWinners(challenge)) {
        addWarPointEvent(events, winner, {
            source: 'clanWarWin',
            amount: CLAN_WAR_CHALLENGE_WIN_POINTS,
            metadata: { eventId: `war:${war.id}:${challenge.id}:challenge-win:${winner}`, warId: war.id, challengeId: challenge.id },
        });
    }
    if (body.warEnded && war.winnerClan) {
        const warWinnerParticipants = new Set<string>();
        for (const completed of war.completedChallenges ?? []) {
            if (completed.status !== 'completed' || completed.result === 'draw') continue;
            for (const player of challengeParticipantsForClan(war, completed, war.winnerClan)) {
                warWinnerParticipants.add(player.toLowerCase());
            }
        }
        for (const winner of warWinnerParticipants) {
            addWarPointEvent(events, winner, {
                source: 'clanWarWin',
                amount: CLAN_WAR_VICTORY_POINTS,
                metadata: { eventId: `war:${war.id}:victory:${winner}`, warId: war.id, winnerClan: war.winnerClan },
            });
        }
    }

    const actorEvents = actorName ? events.get(actorName) : undefined;
    const otherEntries = [...events.entries()].filter(([name]) => name !== actorName);
    await Promise.allSettled(otherEntries.map(([name, playerEvents]) => applyWarPointEvents(name, playerEvents)));
    return actorEvents ? await applyWarPointEvents(actorName, actorEvents) : undefined;
}
