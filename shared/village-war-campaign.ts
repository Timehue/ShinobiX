/** Village wars use score objectives; sector wars retain their own rules. */
import { preparationTier, supportPoints } from './war-preparations.js';
export const WAR_DAY_MS = 86_400_000;
export const VILLAGE_CAMPAIGN_DURATION_MS = 5 * WAR_DAY_MS;
export const SHRINE_ROOM_PRESENCE_TTL_MS = 20_000;
export const SHRINE_WIN_LIMIT = 10;
export const SHRINE_WIN_POINTS = 20;
export const SHRINE_CONTROL_BONUS = 100;
export type VillageCampaignVersion = 2 | 3;
/** Persisted declaration version owns rewards, including delayed settlements. */
export function shrineRules(c: { version: VillageCampaignVersion }) {
    return c.version === 2 ? { winPoints: 100, controlBonus: 1000 }
        : { winPoints: SHRINE_WIN_POINTS, controlBonus: SHRINE_CONTROL_BONUS };
}
export interface ShrineWindow { id: string; opensAt: number; closesAt: number }
/** Elapsed milliseconds from scoring start, independent of calendar days and DST. */
export function rotatingShrineWindows(startsAt: number): ShrineWindow[] {
    return Array.from({ length: 5 }, (_, day) => ({ id: `shrine-${day}`,
        opensAt: startsAt + (2 + 29 * day) * 3_600_000,
        closesAt: startsAt + (4 + 29 * day) * 3_600_000 }));
}
export type WarBattleMode = 'combat' | 'pet' | 'card';
export type WarOperation = 'supply' | 'sabotage' | 'espionage';
export const WAR_MODES: readonly WarBattleMode[] = ['combat', 'pet', 'card'];
export const WAR_OPERATIONS: readonly WarOperation[] = ['supply', 'sabotage', 'espionage'];
export const WAR_INTEL_THRESHOLDS = [24, 48, 72] as const;
export const WAR_INTEL_MAX = WAR_INTEL_THRESHOLDS[2];
export const WAR_OPERATION_CAPS = { player: 4, byType: {
    supply: { player: 1 }, sabotage: { player: 2 }, espionage: { player: 2 },
} } as const;
export const WAR_OPERATION_REWARDS = { supply: { points: 10, intel: 1 }, sabotage: { points: 20, intel: 1 }, espionage: { points: 20, intel: 2 } } as const;
export interface CampaignFieldMission {
    id: string; kind: WarOperation; village: string; enemy: string; createdAt: number;
    sectors: number[]; pickupSector?: number; pickedUp?: boolean; completedSectors: number[];
    status: 'active' | 'complete' | 'failed' | 'abandoned'; battleRunId?: string; finishedAt?: number;
}
export interface CampaignFieldMissionView extends CampaignFieldMission {
    earnedPoints?: number; earnedIntel?: number;
    holdSeconds: number; holdRequired: number; insideStronghold: boolean; serverNow: number;
}
export interface CampaignObjective {
    id: string; sector: number; village?: string; mode: WarBattleMode;
    opensAt: number; closesAt: number; limit: number;
    wins: Record<string, number>; bouts: number; bonusSettled?: boolean; bonusWinner?: string;
    /** Server-measured uncontested milliseconds; never multiplied by headcount. */
    controlTimeMs?: Record<string, number>;
    /** Private reward attribution, stripped from public campaign projections. */
    controlParticipantMs?: Record<string, { village: string; ms: number }>;
    controlVillage?: string; controlCheckedAt?: number;
    closingControlVillage?: string | null; controlCapturedAt?: number;
}
export interface CampaignUsage {
    total: number; categories: Partial<Record<WarOperation, number>>;
    players: Record<string, { total: number; categories: Partial<Record<WarOperation, number>> }>;
}
export interface VillageCampaign {
    espionageIntelBonuses?: Record<string, boolean>;
    version: VillageCampaignVersion; startsAt: number; endsAt: number;
    shrine: CampaignObjective[]; strongholds: CampaignObjective[];
    intel: Record<string, number>; pvp: Record<string, number>; pve: Record<string, number>;
    usage: Record<string, CampaignUsage>;
    admissions: Record<string, { player: string; objectiveId?: string; operation?: WarOperation; createdAt: number; npc?: boolean; finished?: boolean;
        supportTiers?: { watchtower: number; warAcademy: number }; field?: CampaignFieldMission; prepared?: { run: unknown; solo?: unknown } }>;
    /** Permanent receipts stay with this declaration, including zero-point outcomes. */
    receipts: Record<string, { points: number; village: string; player: string; at: number; intel?: number }>;
}
export interface CampaignView {
    supportTiers?: { watchtower: number; warAcademy: number };
    espionageBonusUsed?: boolean;
    version: VillageCampaignVersion; startsAt: number; endsAt: number;
    scores: Record<string, { pvp: number; pve: number; rawPve: number; total: number }>;
    shrine: CampaignObjective[];
    strongholds: CampaignObjective[];
    hiddenStrongholds: number; intel: number; operationAllowance: CampaignUsage;
    operationResetAt: number;
}
export function campaignDay(c: VillageCampaign, now: number): number {
    return Math.floor((now - c.startsAt) / WAR_DAY_MS);
}
export function campaignScore(c: VillageCampaign, village: string) {
    const pvp = c.pvp[village] ?? 0;
    const rawPve = c.pve[village] ?? 0;
    const pve = Math.min(rawPve, Math.floor(pvp / 4));
    return { pvp, pve, rawPve, total: pvp + pve };
}
export function emptyCampaignUsage(): CampaignUsage { return { total: 0, categories: {}, players: {} }; }
export function campaignView(c: VillageCampaign, villages: readonly string[], viewerVillage: string, now: number): CampaignView {
    const revealed = WAR_INTEL_THRESHOLDS.filter(threshold => (c.intel[viewerVillage] ?? 0) >= threshold).length;
    const enemy = c.strongholds.filter(o => o.village !== viewerVillage);
    return {
        version: c.version, startsAt: c.startsAt, endsAt: c.endsAt,
        scores: Object.fromEntries(villages.map(v => [v, campaignScore(c, v)])),
        shrine: c.shrine.map(({ controlParticipantMs: _private, ...objective }) => objective),
        strongholds: c.strongholds.filter(o => o.village === viewerVillage || enemy.indexOf(o) < revealed),
        hiddenStrongholds: 3 - revealed, intel: c.intel[viewerVillage] ?? 0,
        operationAllowance: c.usage[`${viewerVillage}:${campaignDay(c, now)}`] ?? emptyCampaignUsage(),
        operationResetAt: Math.min(c.endsAt, c.startsAt + (campaignDay(c, now) + 1) * WAR_DAY_MS),
    };
}
export function campaignObjectiveAvailable(c: VillageCampaign, o: CampaignObjective, village: string, now: number): boolean {
    return now >= c.startsAt && now < c.endsAt && now >= o.opensAt && now < o.closesAt
        && (!o.village || o.bouts < o.limit) && (!o.village || o.village === village
            || c.strongholds.filter(s => s.village === o.village).indexOf(o) < WAR_INTEL_THRESHOLDS.filter(threshold => (c.intel[village] ?? 0) >= threshold).length);
}
/** Charge the bounded allowance when admitting a fight, so simultaneous starts cannot overbook it. */
export function reserveCampaignOperation(c: VillageCampaign, village: string, player: string, kind: WarOperation, now: number): boolean {
    const day = campaignDay(c, now);
    if (day < 0 || day >= 5 || now >= c.endsAt) return false;
    const key = `${village}:${day}`;
    const usage = c.usage[key] ?? emptyCampaignUsage();
    const personal = Object.hasOwn(usage.players, player) ? usage.players[player] : { total: 0, categories: {} };
    const typeCaps = WAR_OPERATION_CAPS.byType[kind];
    if (personal.total >= WAR_OPERATION_CAPS.player || (personal.categories[kind] ?? 0) >= typeCaps.player) return false;
    usage.total++; usage.categories[kind] = (usage.categories[kind] ?? 0) + 1;
    personal.total++; personal.categories[kind] = (personal.categories[kind] ?? 0) + 1;
    usage.players = { ...usage.players, [player]: personal }; c.usage[key] = usage;
    return true;
}
export function scoreCampaignBattle(c: VillageCampaign, args: {
    receipt: string; village: string; player: string; at: number; createdAt: number;
    objectiveId?: string; operation?: WarOperation; pve?: boolean;
    /** Server-sealed role rewards for a shrine fight; never accepted from a client. */
    shrineVictory?: { enemyVillage: string; winPoints: number; lossPenalty: number };
    supportTiers?: { watchtower: number; warAcademy: number };
}): number {
    if (c.receipts[args.receipt]) return c.receipts[args.receipt].points;
    let points = 0;
    let intel = 0;
    const o = [...c.shrine, ...c.strongholds].find(o => o.id === args.objectiveId);
    const validTime = args.createdAt >= c.startsAt && args.at >= args.createdAt && args.at < c.endsAt;
    if (validTime) {
        if (args.pve) {
            const reward = WAR_OPERATION_REWARDS[args.operation ?? 'sabotage'];
            points = supportPoints(reward.points, args.supportTiers?.warAcademy ?? 0);
            c.pve[args.village] = (c.pve[args.village] ?? 0) + points;
            let extraIntel = 0;
            if (args.operation === 'espionage') {
                const key = `${args.village}:${args.player}:${campaignDay(c, args.at)}`;
                c.espionageIntelBonuses ??= {};
                if (!Object.hasOwn(c.espionageIntelBonuses, key)) {
                    // First success consumes the opportunity even at tier zero.
                    c.espionageIntelBonuses[key] = true;
                    extraIntel = preparationTier(args.supportTiers?.watchtower);
                }
            }
            const previousIntel = c.intel[args.village] ?? 0;
            c.intel[args.village] = Math.min(WAR_INTEL_MAX, previousIntel + reward.intel + extraIntel);
            intel = c.intel[args.village] - previousIntel;
        } else if (!args.objectiveId || (o && args.createdAt >= o.opensAt && args.at < o.closesAt
            && (o.bouts < o.limit || (c.version === 3 && !o.village)))) {
            const normalShrineVictory = c.version === 3 && o && !o.village;
            points = normalShrineVictory ? (args.shrineVictory?.winPoints ?? 5) : o ? (o.village ? 50 : shrineRules(c).winPoints) : 20;
            if (normalShrineVictory) {
                if (o.bouts < o.limit) points += shrineRules(c).winPoints;
                const normal = args.shrineVictory;
                if (normal && normal.enemyVillage !== args.village) {
                    c.pvp[normal.enemyVillage] = Math.max(0, (c.pvp[normal.enemyVillage] ?? 0) - normal.lossPenalty);
                }
            }
            c.pvp[args.village] = (c.pvp[args.village] ?? 0) + points;
            if (o && o.bouts < o.limit) { o.bouts++; o.wins[args.village] = (o.wins[args.village] ?? 0) + 1; }
        }
    }
    c.receipts[args.receipt] = { points, village: args.village, player: args.player, at: args.at, ...(intel ? { intel } : {}) };
    return points;
}
/** Finalize objective bonuses in chronological order before comparing the final score. */
export function advanceCampaign(c: VillageCampaign, now: number): void {
    for (const o of [...c.shrine, ...c.strongholds].sort((a, b) => a.closesAt - b.closesAt)) {
        if (!o.village) {
            // Only verified accumulated time decides this bonus, never the
            // closing roster, combat lead or a client-provided control flag.
            if (now < o.closesAt || o.bonusSettled) continue;
            o.bonusSettled = true;
            const winner = shrineTimeLeader(o);
            if (winner) { c.pvp[winner] = (c.pvp[winner] ?? 0) + shrineRules(c).controlBonus; o.bonusWinner = winner; }
            continue;
        }
        if (!o.bonusSettled && now < o.closesAt && o.bouts < o.limit) continue;
        o.bonusSettled = true;
        const leaders = Object.entries(o.wins).sort((a, b) => b[1] - a[1]);
        const winner = leaders.length && leaders[0][1] !== (leaders[1]?.[1] ?? 0) ? leaders[0][0] : undefined;
        if (winner === o.bonusWinner) continue;
        const bonus = o.village ? 150 : 1000;
        // Completion time is authoritative. A delayed claim can change a closed
        // window's leader while the war is active; transfer or revoke its bonus.
        if (o.bonusWinner) c.pvp[o.bonusWinner] -= bonus;
        if (winner) c.pvp[winner] = (c.pvp[winner] ?? 0) + bonus;
        o.bonusWinner = winner;
    }
}
export function shrineTimeLeader(o: CampaignObjective): string | undefined {
    const leaders = Object.entries(o.controlTimeMs ?? {}).filter(([, ms]) => Number.isFinite(ms) && ms > 0).sort((a, b) => b[1] - a[1]);
    return leaders.length && leaders[0][1] !== leaders[1]?.[1] ? leaders[0][0] : undefined;
}
/** Live control is informational; authoritative presence tracking measures time. */
export function updateShrineControl(c: VillageCampaign, o: CampaignObjective, villages: readonly string[], now: number): void {
    if (o.village || now < o.opensAt || now >= o.closesAt || now >= c.endsAt) return;
    const sole = new Set(villages);
    const village = sole.size === 1 ? villages[0] : undefined;
    if (!village) delete o.controlVillage;
    else o.controlVillage = village;
    o.controlCheckedAt = now;
}
