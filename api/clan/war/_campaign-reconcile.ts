import { isDeepStrictEqual } from 'node:util';
import { storedValueEquals } from '../../_stored-value.js';
import { kv } from '../../_storage.js';
import { withKvLock } from '../../_lock.js';
import { enforcePvpTurnDeadline } from '../../pvp/_turn-deadline.js';
import { terminalizeLapsedPvpSession } from '../../pvp/_lapse.js';
import { isPvpSessionLapsed } from '../../pvp/_lapse-rules.js';
import type { PvpSession } from '../../pvp/session.js';
import { towerPvpState } from '../../towers/_pvp-lifecycle.js';
import { pruneClanWarQueue,cancelClanWarMatch, type ClanWarCampaignMatch } from '../../../shared/clan-war-campaign.js';
import { applyFinalResult, finalizeClanWarEnd, clanWarCooldownKey, CLAN_WAR_REMATCH_COOLDOWN_SEC, type ClanWar } from './_storage.js';
import { settlePvpClanWarContinuation } from './_pvp-settlement.js';
import { readClanWar2v2Match } from './_mpvp.js';
import { settleClanWar2v2Match } from './_mpvp-settlement.js';
import { clanWarPetSessionKey, normalizeClanWarPetSession, type ClanWarPetSession } from './_pet-duel.js';
import { reconcileClanWarCardDuel } from './tilecards.js';
import { awardCampaignMatch, awardCampaignEnd } from './_campaign-rewards.js';
import { releaseEndedClanWarReservations } from './_declaration-reservations.js';
import {clanWarPvp2v2Disabled} from './_challenge-admission.js';

async function writeWar(key: string, current: ClanWar, next: ClanWar): Promise<void> {
    if (isDeepStrictEqual(current,next)) return;
    try { if (!(await kv.compareSet(key,current,next))) throw new Error('Clan war reconciliation was contended.'); }
    catch (error) { if (!storedValueEquals(await kv.get(key).catch(()=>null),next)) throw error; }
}
/** A consented match that never starts consumes attempts, pays nothing and cannot be replayed. */
export async function abandonCampaignBattle(warId: string, matchId: string, reason: string, now = Date.now(),serviceFailure=false): Promise<void> {
    const key = `clan-war:${warId}`;
    await withKvLock(key,async()=>{
        const current = await kv.get<ClanWar>(key), match = current?.campaign?.matches[matchId];
        if (!current?.campaign || !match || match.status !== 'active') return;
        const challenge = current.pendingChallenges.find(entry=>entry.id===matchId);
        const canceled=serviceFailure?cancelClanWarMatch(current.campaign,matchId,now,reason):null;
        if(canceled&&!canceled.ok)throw new Error(canceled.error);
        const next: ClanWar = { ...current, campaign: canceled?.ok?canceled.campaign:{ ...current.campaign, matches: { ...current.campaign.matches,
            [matchId]: { ...match,status:'cancelled',completedAt:now,cancellation:reason } } },
            pendingChallenges:current.pendingChallenges.filter(entry=>entry.id!==matchId),
            completedChallenges:challenge ? [{...challenge,status:'cancelled' as const,completedAt:now},...current.completedChallenges].slice(0,200) : current.completedChallenges,
            updatedAt:now };
        await writeWar(key,current,next);
    },{failClosed:true});
}
async function reconcilePet(warId: string, match: ClanWarCampaignMatch, now: number): Promise<void> {
    const session = normalizeClanWarPetSession(await kv.get<Partial<ClanWarPetSession>>(clanWarPetSessionKey(warId,match.id)));
    if (session?.status === 'done' && session.winner && session.warId === warId && session.challengeId === match.id) {
        const key = `clan-war:${warId}`;
        await withKvLock(key,async()=>{
            const current = await kv.get<ClanWar>(key), challenge = current?.pendingChallenges.find(entry=>entry.id===match.id);
            if (!current || !challenge || current.endedAt) return;
            if (session.from[0]?.name !== challenge.fromPlayer || session.to[0]?.name !== challenge.acceptedPlayer) throw new Error('Pet battle binding conflicts.');
            const result = applyFinalResult(current,challenge,session.winner!,session.updatedAt);
            await writeWar(key,current,result.war);
        },{failClosed:true});
    } else if (now >= (match.startedAt ?? now) + 5*60_000) await abandonCampaignBattle(warId,match.id,'pet-submission-expired',now);
}
async function reconcileActive(war: ClanWar, match: ClanWarCampaignMatch, now: number): Promise<void> {
    const challenge = war.pendingChallenges.find(entry=>entry.id===match.id);
    if (!challenge) throw new Error('An active campaign match lost its battle capability.');
    if (match.mode === 'pvp1v1') {
        let session = challenge.battleId ? await kv.get<PvpSession>(`pvp:${challenge.battleId}`) : null;
        if (session?.battleId && session.clanWarId === war.id && session.clanWarChallengeId === match.id) {
            if (session.status === 'active') {
                if (isPvpSessionLapsed(session,now)) {
                    const lapsed = await terminalizeLapsedPvpSession(session.battleId,{now:()=>now});
                    if (!lapsed.ok) throw new Error(lapsed.error);
                    session = lapsed.session;
                } else session = (await enforcePvpTurnDeadline(kv,session.battleId,session,now)).session;
            }
            if (session?.status === 'done') {
                if (session.joined?.p1 && session.joined?.p2) await settlePvpClanWarContinuation(session);
                else await abandonCampaignBattle(war.id,match.id,'battle-not-joined',now);
            }
        } else if (now >= (match.startedAt ?? now)+2*60_000) await abandonCampaignBattle(war.id,match.id,'launch-expired',now);
    } else if (match.mode === 'pvp2v2') {
        const published = await readClanWar2v2Match(match.id);
        if(!published&&clanWarPvp2v2Disabled()){
            await abandonCampaignBattle(war.id,match.id,'2v2-service-disabled',now,true);
            return;
        }
        if (published) {
            const state = await towerPvpState(published.matchId,match.fromPlayers[0]);
            if (!state.ok) throw new Error(state.error);
            if (state.match.status === 'cancelled') await abandonCampaignBattle(war.id,match.id,'battle-not-started',now);
            else if (state.match.status === 'done') await settleClanWar2v2Match(state.match);
        } else if (now >= (match.startedAt ?? now)+2*60_000) await abandonCampaignBattle(war.id,match.id,'launch-expired',now);
    } else if (match.mode === 'pet1v1') await reconcilePet(war.id,match,now);
    else {
        const session = await reconcileClanWarCardDuel(match.id,now);
        if ((!session || session.status === 'awaiting-p2') && now >= (match.startedAt ?? now)+5*60_000) {
            await abandonCampaignBattle(war.id,match.id,'card-submission-expired',now);
        }
    }
}
/** Reconcile battle proofs first, freeze the score second, repair payouts last. */
export async function reconcileClanWarBattleResults(war:ClanWar,now=Date.now()):Promise<void> {
    if(!war.campaign||war.endedAt)return;
    for(const match of Object.values(war.campaign.matches))if(match.status==='active')await reconcileActive(war,match,now);
}
export async function reconcileClanWarCampaign(warId: string, now = Date.now()): Promise<ClanWar | null> {
    const key = `clan-war:${warId}`;
    let war = await kv.get<ClanWar>(key);
    if (!war?.campaign) return war;
    if (!war.endedAt) {
        // Battle stores own their locks. Never invert their session -> war order.
        await reconcileClanWarBattleResults(war,now);
        war = await withKvLock(key,async()=>{
            const current = await kv.get<ClanWar>(key);
            if (!current?.campaign || current.endedAt) return current;
            let next: ClanWar = {...current,campaign:pruneClanWarQueue(current.campaign,now)};
            if (now >= current.campaign.endsAt) next = finalizeClanWarEnd(next,{endedAt:current.campaign.endsAt,reason:'timeout'});
            await writeWar(key,current,next);
            return next;
        },{failClosed:true});
    }
    if (!war?.campaign) return war;
    for (const match of Object.values(war.campaign.matches)) if (match.status === 'completed' && match.scoreEligible && !match.rewardsSettledAt) await awardCampaignMatch(war,match);
    if (war.endedAt) {
        const remaining = Math.min(CLAN_WAR_REMATCH_COOLDOWN_SEC,Math.max(0,Math.ceil((war.endedAt+CLAN_WAR_REMATCH_COOLDOWN_SEC*1000-now)/1000)));
        if (remaining&&war.campaign.closeReason!=='service') await kv.set(clanWarCooldownKey(...war.clans),war.endedAt,{ex:remaining});
        await releaseEndedClanWarReservations(war);
        await awardCampaignEnd(war);
    }
    return kv.get<ClanWar>(key);
}
