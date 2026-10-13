import { randomInt } from 'node:crypto';
import { kv } from './_storage.js';
import { withKvLock } from './_lock.js';
import { commitWarBattleSettlement } from './_war-battle-settlement.js';
import { HOME_SECTORS, isWarVillage } from './_war-map-sectors.js';
import { applyShrineClosingControl } from './_village-war-shrine-closing.js';
import {
    advanceCampaign, campaignScore, scoreCampaignBattle, WAR_DAY_MS, WAR_MODES,
    VILLAGE_CAMPAIGN_DURATION_MS, SHRINE_WIN_LIMIT, type VillageCampaign,
} from '../shared/village-war-campaign.js';

export interface CampaignWarRow {
    id: string; villages: [string, string]; startedAt: number; updatedAt: number;
    pendingUntil?: number; declarationGeneration?: number; endedAt?: number; winnerVillage?: string;
    declarationFunding?: { status: string }; campaign?: VillageCampaign;
    contributions?: Record<string, { damage: number; raids: number; pvpKills: number; side: string; name: string }>;
}
export function createVillageCampaign(villages: readonly string[], startsAt: number, shrineSector: number,
    ownedSectors?: Record<string, number[]>): VillageCampaign {
    const endsAt = startsAt + VILLAGE_CAMPAIGN_DURATION_MS;
    const strongholds = villages.flatMap((village, side) => {
        const candidates = [...new Set(ownedSectors?.[village] ?? (isWarVillage(village) ? HOME_SECTORS[village].slice(1) : []))];
        if (candidates.length < 3) throw new Error('Each village needs three eligible strongholds.');
        for (let i = candidates.length - 1; i > 0; i--) { const j = randomInt(i + 1); [candidates[i], candidates[j]] = [candidates[j], candidates[i]]; }
        return WAR_MODES.map((mode, i) => ({ id: `stronghold-${side}-${i}`, sector: candidates[i], village, mode,
            opensAt: startsAt, closesAt: endsAt, limit: 3, bouts: 0, wins: {} }));
    });
    return { version: 2, startsAt, endsAt, strongholds,
        shrine: Array.from({ length: 5 }, (_, day) => ({ id: `shrine-${day}`, sector: shrineSector,
            mode: 'combat' as const, opensAt: startsAt + day * WAR_DAY_MS + 20 * 3_600_000,
            closesAt: startsAt + (day + 1) * WAR_DAY_MS, limit: SHRINE_WIN_LIMIT, bouts: 0, wins: {}, controlTimeMs: Object.fromEntries(villages.map(v => [v, 0])) })),
        intel: {}, pvp: {}, pve: {}, usage: {}, admissions: {}, receipts: {} };
}
export function campaignWarPlayable(war: CampaignWarRow, now = Date.now()): boolean {
    return !!war.campaign && !war.endedAt && (!war.declarationFunding || war.declarationFunding.status === 'active')
        && now >= war.campaign.startsAt && now < war.campaign.endsAt;
}
/** Pure projection shared with world-state's ending/reward machinery. */
export function advanceCampaignWar<T extends CampaignWarRow>(war: T, now: number): T {
    if (!war.campaign || war.endedAt) return war;
    const next = structuredClone(war);
    applyShrineClosingControl(next, now);
    advanceCampaign(next.campaign!, now);
    if (now >= next.campaign!.endsAt) {
        next.endedAt = next.campaign!.endsAt;
        const [a, b] = next.villages;
        const difference = campaignScore(next.campaign!, a).total - campaignScore(next.campaign!, b).total;
        if (difference !== 0) next.winnerVillage = difference > 0 ? a : b;
    }
    return next;
}
export function awardCampaignBattle<T extends CampaignWarRow>(war: T, args: Parameters<typeof scoreCampaignBattle>[1], displayName: string): { row: T; points: number; replayed: boolean } {
    const replayed = !!war.campaign?.receipts[args.receipt];
    const row = structuredClone(war);
    if (!row.campaign) throw new Error('Village campaign missing.');
    // Once rewards have been finalized, late deliveries cannot change the winning side.
    if (row.endedAt && !replayed) return { row, points: 0, replayed: false };
    const admission = row.campaign.admissions[args.receipt.replace(/^(field|run):/, '')];
    const points = scoreCampaignBattle(row.campaign, { ...args, supportTiers: admission?.supportTiers ?? args.supportTiers });
    if (!replayed && points > 0) {
        row.contributions ??= {};
        const entry = Object.hasOwn(row.contributions, args.player) ? row.contributions[args.player] : { damage: 0, raids: 0, pvpKills: 0, side: args.village, name: displayName };
        entry.damage += points; entry.raids += args.pve ? 1 : 0; entry.pvpKills += args.pve ? 0 : 1;
        row.contributions = { ...row.contributions, [args.player]: entry };
    }
    applyShrineClosingControl(row, args.at);
    advanceCampaign(row.campaign, args.at);
    row.updatedAt = Math.max(row.updatedAt, Date.now());
    return { row, points, replayed };
}
export async function mutateCampaignWar<T>(id: string, action: (war: CampaignWarRow) => Promise<{ row: CampaignWarRow; value: T }>): Promise<T> {
    if (!/^[a-z0-9-]{3,120}$/.test(id)) throw new Error('Invalid village war.');
    const key = `world:war:${id}`;
    return withKvLock(key, async () => {
        const current = await kv.get<CampaignWarRow>(key);
        if (!current?.campaign) throw new Error('This village war has no campaign objectives.');
        const { row, value } = await action(structuredClone(current));
        const commit = await commitWarBattleSettlement(kv, key, current, row);
        if (commit.status === 'conflict') throw new Error('Village war changed. Please retry.');
        return value;
    }, { failClosed: true });
}
export async function villageCampaignStronghold(village: string, sector: number) {
    const keys = await kv.keys('world:war:*');
    const wars = keys.length ? await kv.mget<CampaignWarRow[]>(...keys) : [];
    for (const war of wars) {
        if (!war || !war.villages.includes(village) || !campaignWarPlayable(war)) continue;
        const objective = war.campaign!.strongholds.find(o => o.sector === sector);
        if (objective) return { war, objective };
    }
    return null;
}
