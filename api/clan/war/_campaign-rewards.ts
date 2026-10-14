import { createHash } from 'node:crypto';
import { storedValueEquals } from '../../_stored-value.js';
import { kv } from '../../_storage.js';
import { withKvLock } from '../../_lock.js';
import { safeName } from '../../_utils.js';
import { awardClanPoints, clanPointWeekKey, type ClanPointSource } from '../../_clan-points.js';
import { mutatePlayerSave } from '../../save/_mutate-player-save.js';
import { retryOnSaveVersionConflict } from '../../save/_projected-write.js';
import { CLAN_WAR_RULES, type ClanWarCampaignMatch } from '../../../shared/clan-war-campaign.js';
import { clanWarPvpTerritoryScrollDrop, grantClanWarPvpWinScrolls, type WarPointSaveEcho } from './_war-points.js';
import { awardPvpWarEndClanXp } from './_war-xp.js';
import type { ClanWar } from './_storage.js';
import {recordClanCampaignHistory} from './_campaign-history.js';

const REWARD_RETENTION_MS = 60 * 86_400_000;
type Receipt = { fingerprint: string; paidAt: number };
function receipts(character: Record<string, unknown>): Record<string, Receipt> {
    const raw = character.clanWarRewardReceipts;
    if (raw === undefined) return {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length > 1024) throw new Error('Clan war reward journal is invalid.');
    const result: Record<string, Receipt> = {};
    for (const [id, entry] of Object.entries(raw)) {
        const row = entry as Receipt;
        if (!/^[a-f0-9]{64}$/.test(id) || !row || typeof row.fingerprint !== 'string'
            || !/^[a-f0-9]{64}$/.test(row.fingerprint) || !Number.isSafeInteger(row.paidAt) || row.paidAt <= 0) throw new Error('Clan war reward journal is invalid.');
        result[id] = row;
    }
    return result;
}
export function campaignRewardId(instanceId: string, event: string): string {
    return createHash('sha256').update(`${instanceId}:${event}`).digest('hex');
}
/** Fee compensation uses the protected in-save journal and currency-ledger writer. */
export async function refundCampaignPersonalFee(war:ClanWar):Promise<void> {
    const payment=war.campaign?.declarationPayment;
    if(!payment||payment.funding!=='personal'||war.campaign?.closeReason!=='service')throw new Error('Campaign refund proof is invalid.');
    const id=campaignRewardId(war.campaign.instanceId,'declaration-refund');
    const fingerprint=createHash('sha256').update(JSON.stringify(payment)).digest('hex');
    const result=await retryOnSaveVersionConflict(()=>mutatePlayerSave(payment.payerName,({character})=>{
        const journal=receipts(character),prior=journal[id],now=Date.now();
        if(prior){
            if(prior.fingerprint!==fingerprint)throw new Error('Campaign refund proof conflicts.');
            return {ok:true,character,value:undefined,write:false};
        }
        const seals=Number(character.honorSeals??0);
        if(!Number.isSafeInteger(seals)||seals<0||!Number.isSafeInteger(seals+payment.amount))throw new Error('Honor Seal balance is invalid.');
        const retained=Object.fromEntries(Object.entries(journal).filter(([,row])=>row.paidAt>=now-REWARD_RETENTION_MS));
        if(Object.keys(retained).length>=1024)throw new Error('Campaign refund journal is full.');
        return {ok:true,character:{...character,honorSeals:seals+payment.amount,
            clanWarRewardReceipts:{...retained,[id]:{fingerprint,paidAt:now}}},value:undefined};
    }));
    if(!result.ok)throw new Error('The original payer save is unavailable. The campaign fee refund remains pending.');
}
async function creditPlayer(war: ClanWar, player: string, clan: string, event: string,
    events: Array<{source: ClanPointSource; amount: number}>, scrolls = 0): Promise<WarPointSaveEcho> {
    const id = campaignRewardId(war.campaign!.instanceId, event);
    const fingerprint = createHash('sha256').update(JSON.stringify({clan, events, scrolls})).digest('hex');
    const out = await retryOnSaveVersionConflict(() => mutatePlayerSave(player, ({ character }) => {
        const journal = receipts(character), prior = journal[id], now = Date.now();
        if (prior) {
            if (prior.fingerprint !== fingerprint) throw new Error('Clan war reward proof conflicts.');
            return { ok: true, character, value: undefined, write: false };
        }
        const retained = Object.fromEntries(Object.entries(journal).filter(([, row]) => row.paidAt >= now - REWARD_RETENTION_MS));
        if (Object.keys(retained).length >= 1024) throw new Error('Clan war reward journal is full.');
        let next = character;
        // An earned payout belongs to its sealed war side even after departure.
        // It shares the current weekly cap and cannot turn the clock backwards.
        if (String(character.weeklyClanPointsWeek ?? '') <= clanPointWeekKey(new Date(now))) {
            for (let i = 0; i < events.length; i++) {
                const item = events[i];
                const awarded = awardClanPoints({ ...next, clan }, item.source, item.amount,
                    { eventId: `campaign:${id}:${i}`, warId: war.id, campaignId: war.campaign!.instanceId, earnedClan: clan }, new Date(now));
                next = { ...awarded.character, clan: character.clan };
            }
        }
        if (scrolls) next = grantClanWarPvpWinScrolls(next, scrolls);
        return { ok: true, character: { ...next, clanWarRewardReceipts: { ...retained, [id]: { fingerprint, paidAt: now } } }, value: undefined };
    }));
    if (!out.ok) throw new Error(`Clan war reward save is unavailable: ${safeName(player)}`);
    return { character: out.character, _saveVersion: out._saveVersion };
}
async function markRewards(war: ClanWar, matchId?: string): Promise<void> {
    const key = `clan-war:${war.id}`;
    await withKvLock(key, async () => {
        const current = await kv.get<ClanWar>(key);
        if (!current?.campaign || current.campaign.instanceId !== war.campaign!.instanceId) return;
        const campaign = current.campaign, now = Date.now();
        if (matchId && (!campaign.matches[matchId] || campaign.matches[matchId].status !== 'completed'
            || !campaign.matches[matchId].scoreEligible)) throw new Error('Clan war reward stamp lost its completion proof.');
        const next: ClanWar = { ...current, campaign: matchId
            ? { ...campaign, matches: { ...campaign.matches, [matchId]: { ...campaign.matches[matchId], rewardsSettledAt: now } } }
            : { ...campaign, endRewardsSettledAt: now } };
        try { if (!(await kv.compareSet(key, current, next))) throw new Error('Clan war reward stamp was contended.'); }
        catch (error) { if (!storedValueEquals(await kv.get(key).catch(() => null), next)) throw error; }
    }, { failClosed: true });
}
/** All four battle families use one receipt namespace; retry repairs missing players. */
export async function awardCampaignMatch(war: ClanWar, match: ClanWarCampaignMatch): Promise<Record<string, WarPointSaveEcho>> {
    if (!war.campaign || !match.scoreEligible || match.status !== 'completed' || match.rewardsSettledAt
        || Date.now() > war.campaign.endsAt + REWARD_RETENTION_MS) return {};
    const echoes: Record<string, WarPointSaveEcho> = {};
    for (const [clan, side, won] of [[match.fromClan, match.fromPlayers, match.result === 'from-wins'],
        [match.toClan, match.toPlayers, match.result === 'to-wins']] as const) {
        for (const name of side) {
            const events: Array<{source: ClanPointSource;amount:number}> = [{ source: 'clanWarParticipation', amount: CLAN_WAR_RULES.participationPoints }];
            if (won) events.push({ source: 'clanWarWin', amount: CLAN_WAR_RULES.matchWinPoints });
            if(match.provisionedClans?.includes(clan))events.push({source:'clanWarParticipation',amount:Math.floor(
                (CLAN_WAR_RULES.participationPoints+(won?CLAN_WAR_RULES.matchWinPoints:0))*CLAN_WAR_RULES.provisionCpBonus)});
            const scrolls = won && match.mode === 'pvp1v1' && match.battleId && clanWarPvpTerritoryScrollDrop(match.battleId, name) ? 1 : 0;
            echoes[name] = await creditPlayer(war,name,clan,`match:${match.id}`,events,scrolls);
        }
    }
    await markRewards(war,match.id);
    return echoes;
}
export async function awardCampaignEnd(war: ClanWar): Promise<void> {
    if (!war.campaign || !war.endedAt || war.campaign.endRewardsSettledAt
        || Date.now() > war.campaign.endsAt + REWARD_RETENTION_MS) return;
    const participants = Object.values(war.campaign.contributions).filter(entry=>entry.played>0);
    if (participants.length && !['service','withdrawal'].includes(war.campaign.closeReason??'')) {
        for (const member of participants) if (member.clan === war.winnerClan) {
            await creditPlayer(war,member.name,member.clan,'victory',[{source:'clanWarWin',amount:CLAN_WAR_RULES.victoryPoints}]);
        }
        await awardPvpWarEndClanXp(war,`campaign:${war.campaign.instanceId}`,war.endedAt);
    }
    await recordClanCampaignHistory(war);
    await markRewards(war);
}
