import { randomInt, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { storedValueEquals } from '../../_stored-value.js';
import { kv } from '../../_storage.js';
import { readKvProjection } from '../../_storage-projection.js';
import { withKvLock } from '../../_lock.js';
import { clanBareSlug, clanRecordKey, safeName } from '../../_utils.js';
import { onlineStore } from '../../_realtime/online-store.js';
import { activeCarriedPets } from '../../_entitlements.js';
import { petCombatBusyReason } from '../../pet/_pet-busy.js';
import { resolveChronicleDeckMutation } from '../../card-clash/_deck.js';
import {
    CLAN_WAR_RULES, campaignMember, clanWarPlayerKey, isClanWarQueueMode,
    joinClanWarQueue, leaveClanWarQueue, matchClanWarQueue, pruneClanWarQueue,
    readyClanWarMatch, startClanWarMatch, type ClanWarCampaign, type ClanWarCampaignMatch,
    type ClanWarCampaignMutation,
} from '../../../shared/clan-war-campaign.js';
import { redactClanWarForViewer, type ClanWar, type ClanChallenge } from './_storage.js';
import { clanShrinePresenceError, enterClanShrine, leaveClanShrine, clanShrineRoster,clanShrineRoom,refreshClanShrine } from './_shrine-presence.js';
import {clanWarChallengeAdmissionError} from './_challenge-admission.js';

export class ClanWarQueueRefusal extends Error {
    constructor(public status: number, message: string) { super(message); }
}
function mutation(result: ClanWarCampaignMutation): ClanWarCampaign {
    if (!result.ok) throw new ClanWarQueueRefusal(409, result.error);
    return result.campaign;
}
export function campaignChallenge(match: ClanWarCampaignMatch): ClanChallenge {
    if (match.status !== 'active' || !match.startedAt || !match.scoringDeadline) throw new Error('Match must be admitted before publication.');
    return { id: match.id, campaignMatchId: match.id, mode: match.mode, fromClan: match.fromClan,
        fromPlayer: match.fromPlayers[0], fromPlayer2: match.fromPlayers[1],
        acceptedPlayer: match.toPlayers[0], acceptedPlayer2: match.toPlayers[1],
        status: 'accepted', createdAt: match.createdAt, acceptedAt: match.startedAt,
        expiresAt: match.scoringDeadline, ...(match.mode === 'pet1v1' ? { petBattleSeed: randomInt(1, 0x7fff_ffff) } : {}) };
}
/** A battle host must verify this admission before minting a new session. */
export async function campaignBattleAdmissionError(war: ClanWar, challenge: ClanChallenge, now = Date.now(),checkBusy=true): Promise<string | null> {
    if (!war.campaign) return null;
    const modeError=clanWarChallengeAdmissionError('campaign-start',challenge.mode);
    if(modeError)return modeError;
    const match = challenge.campaignMatchId ? war.campaign.matches[challenge.campaignMatchId] : undefined;
    if (!match || match.id !== challenge.id || match.status !== 'active' || war.endedAt
        || now >= (match.scoringDeadline ?? 0) || match.mode !== challenge.mode
        || match.fromClan !== challenge.fromClan || match.fromPlayers[0] !== challenge.fromPlayer
        || match.fromPlayers[1] !== challenge.fromPlayer2 || match.toPlayers[0] !== challenge.acceptedPlayer
        || match.toPlayers[1] !== challenge.acceptedPlayer2) return 'This battle has no active clan-war queue admission.';
    for (const [clan, names] of [[match.fromClan, match.fromPlayers], [match.toClan, match.toPlayers]] as const) {
        const error = await currentParticipantError(war, clan, names, match, now, checkBusy);
        if (error) return error;
    }
    return null;
}
async function currentParticipantError(war: ClanWar, clan: string, names: string[], match: Pick<ClanWarCampaignMatch, 'mode' | 'scope' | 'windowIndex'>,
    now: number, checkBusy = true): Promise<string | null> {
    const record = await kv.get<Record<string, unknown>>(clanRecordKey(clan));
    if (!record) return 'A participating clan no longer exists.';
    const members = new Set((Array.isArray(record.members) ? record.members : []).map(member => safeName(String(typeof member === 'string'
        ? member : member && typeof member === 'object' ? member.name ?? '' : ''))));
    const saves = await kv.mget<Record<string, unknown>[]>(...names.map(name => `save:${safeName(name)}`));
    for (let i = 0; i < names.length; i++) {
        const name = safeName(names[i]), character = saves[i]?.character as Record<string, unknown> | undefined;
        if (!campaignMember(war.campaign!, clan, name) || !members.has(name) || !character
            || clanBareSlug(String(character.clan ?? '')) !== clanBareSlug(clan)) return 'A duellist is no longer an eligible member of this clan.';
        const joined=Number((record.memberJoinedAt as Record<string,unknown>|undefined)?.[name]??war.campaign!.declaredAt);
        if(joined>war.campaign!.declaredAt)return 'A duellist rejoined after this war’s roster was sealed. They can participate in the next campaign.';
        if (checkBusy && onlineStore.get(name)?.inBattle) return 'A duellist is already in an active battle.';
        if (match.mode === 'pet1v1' && !activeCarriedPets<Record<string, unknown>>(character).some(pet => !petCombatBusyReason(character, pet))) {
            return 'Bring an available carried pet before joining the pet queue.';
        }
        if (match.mode === 'tilecards' && !resolveChronicleDeckMutation(character, []).ok) return 'Prepare a legal Chronicle deck before joining the card queue.';
        if (match.scope === 'shrine') {
            const error = clanShrinePresenceError(name, war, match.windowIndex!, now);
            if (error) return error;
        }
    }
    return null;
}
/** All queue, ready and challenge publication changes share the exact war-row lock. */
export async function actClanWarQueue(input: { warId: string; playerName: string; action: string; mode?: unknown;
    scope?: unknown; windowIndex?: unknown; partnerEntryId?: unknown; matchId?: unknown;tile?:unknown }, now = Date.now()): Promise<Record<string, unknown>> {
    if (!/^[a-z0-9-]{3,100}$/.test(input.warId)) throw new ClanWarQueueRefusal(400, 'Choose a valid clan war.');
    if(input.action==='provisions'){const {activateClanWarProvisions}=await import('./_campaign-provisions.js');return activateClanWarProvisions(input.warId,input.playerName,now);}
    const name = safeName(input.playerName), key = `clan-war:${input.warId}`;
    return withKvLock(key, async () => {
        const current = await kv.get<ClanWar>(key);
        if (!current?.campaign) throw new ClanWarQueueRefusal(404, 'This war does not use campaign queues.');
        const roster = current.campaign.rosters.find(side => side.members.some(member => clanWarPlayerKey(member.name) === name));
        if (!roster) throw new ClanWarQueueRefusal(403, 'You are not on this war’s eligible roster.');
        let campaign = pruneClanWarQueue(current.campaign, now);
        let next: ClanWar = { ...current, campaign };
        const scope = input.scope === undefined || input.scope === 'normal' ? 'normal' : input.scope === 'shrine' ? 'shrine' : undefined;
        const windowIndex = input.windowIndex === undefined ? undefined : Number(input.windowIndex);
        if (!scope || (scope === 'shrine' && (!Number.isSafeInteger(windowIndex) || windowIndex! < 0))) throw new ClanWarQueueRefusal(400, 'Choose a valid battle location.');
        if (input.action === 'leave' || input.action === 'shrine-leave') {
            if(input.action==='leave'||campaign.queue.some(entry=>entry.scope==='shrine'&&entry.windowIndex===windowIndex&&entry.players.includes(name)))
                campaign = leaveClanWarQueue(campaign, name);
            if (input.action === 'shrine-leave') leaveClanShrine(name,current,windowIndex);
        } else if (input.action === 'decline') {
            const match = campaign.matches[String(input.matchId ?? '')];
            if (!match || match.status !== 'ready' || ![...match.fromPlayers, ...match.toPlayers].includes(name)) {
                throw new ClanWarQueueRefusal(409, 'That ready check has ended.');
            }
            campaign = { ...campaign, matches: { ...campaign.matches, [match.id]: { ...match, status: 'cancelled', completedAt: now, cancellation: 'ready-declined' } } };
        } else if (input.action === 'join' || input.action === 'heartbeat') {
            if (!isClanWarQueueMode(input.mode)) throw new ClanWarQueueRefusal(400, 'Choose one of the four clan-war battle modes.');
            const modeError=clanWarChallengeAdmissionError(input.action,input.mode);
            if(modeError)throw new ClanWarQueueRefusal(503,modeError);
            const inQueue=campaign.queue.some(entry=>entry.players.includes(name));
            const paired=input.action==='heartbeat'&&!inQueue&&Object.values(campaign.matches).some(match=>
                (match.status==='ready'||match.status==='active')&&[...match.fromPlayers,...match.toPlayers].includes(name));
            if(!paired){
                const error = await currentParticipantError(next, roster.clan, [name], { mode: input.mode, scope, windowIndex }, now);
                if (error) throw new ClanWarQueueRefusal(409, error);
                if (input.action === 'heartbeat' && !inQueue) throw new ClanWarQueueRefusal(409, 'Your queue entry expired. Join again when ready.');
                campaign = mutation(joinClanWarQueue(campaign, { entryId: `cwq-${randomUUID().replaceAll('-', '')}`,
                    clan: roster.clan, name, mode: input.mode, scope, windowIndex,
                    partnerEntryId: typeof input.partnerEntryId === 'string' ? input.partnerEntryId : undefined, now }));
            }
        } else if (input.action === 'ready') {
            const matchId = String(input.matchId ?? '');
            const modeError=clanWarChallengeAdmissionError('ready',campaign.matches[matchId]?.mode);
            if(modeError)throw new ClanWarQueueRefusal(503,modeError);
            campaign = mutation(readyClanWarMatch(campaign, matchId, name, now));
            const match = campaign.matches[matchId], names = [...match.fromPlayers, ...match.toPlayers];
            if (names.every(player => match.readyPlayers.includes(clanWarPlayerKey(player)))) {
                for (const [clan, side] of [[match.fromClan, match.fromPlayers], [match.toClan, match.toPlayers]] as const) {
                    const error = await currentParticipantError({ ...next, campaign }, clan, side, match, now);
                    if (error) throw new ClanWarQueueRefusal(409, error);
                }
                campaign = mutation(startClanWarMatch(campaign, matchId, now));
                next = { ...next, pendingChallenges: [...next.pendingChallenges, campaignChallenge(campaign.matches[matchId])] };
            }
        } else if (input.action === 'shrine-enter') {
            const error = await currentParticipantError(next, roster.clan, [name], { mode: 'pvp1v1', scope: 'normal' }, now);
            if (error) throw new ClanWarQueueRefusal(409, error);
            const presenceError = enterClanShrine(name, next, windowIndex!, now);
            if (presenceError) throw new ClanWarQueueRefusal(409, presenceError);
        } else if(input.action==='shrine-state'||input.action==='shrine-walk') {
            const error=refreshClanShrine(name,next,windowIndex!,input.action==='shrine-walk'?Number(input.tile):undefined,now);
            if(error)throw new ClanWarQueueRefusal(409,error);
        } else if (input.action !== 'state') throw new ClanWarQueueRefusal(400, 'Unknown clan-war queue action.');
        // Pair every currently complete opposing entry, respecting FIFO. A
        // ready check reserves nothing until all participants confirm.
        for (let i = 0; i < CLAN_WAR_RULES.maxQueueEntries / 2; i++) {
            const paired = matchClanWarQueue(campaign, `cwm-${randomUUID().replaceAll('-', '')}`, now);
            if (!paired.ok) break;
            campaign = paired.campaign;
            if (!paired.matchId) break;
        }
        next = { ...next, campaign, updatedAt: now };
        if (!isDeepStrictEqual(current, next)) {
            try { if (!(await kv.compareSet(key, current, next))) throw new Error('The clan war changed during queue admission. Retry.'); }
            catch (error) { if (!storedValueEquals(await kv.get(key).catch(() => null), next)) throw error; }
        }
        // Every shrine step and 5 s room poll lands here: read the one upgrade, not the clan record.
        const [record] = await readKvProjection(kv, [clanRecordKey(roster.clan)], { scoutNetwork: ['upgrades', 'scoutNetwork'] });
        const scout = Number(record?.scoutNetwork ?? 0);
        return { war: redactClanWarForViewer(next, roster.clan, name, now, scout), serverNow: now,
            ...(scope === 'shrine' && windowIndex !== undefined&&!clanShrinePresenceError(name,next,windowIndex,now)
                ? { shrinePlayers: clanShrineRoster(next, windowIndex, now),room:clanShrineRoom(next,windowIndex,now) } : {}) };
    }, { failClosed: true });
}
