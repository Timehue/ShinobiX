import { CHALLENGE_DAMAGE, type ClanWar } from '../clan/war/_storage.js';

export const WAR_REWARD_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
export const LEGENDARY_WAR_CRATE_ID = 'legendary-war-crate';

export type VillageWarRewardRecord = {
    id: string;
    declarationGeneration?: number;
    villages: [string, string];
    endedAt?: number;
    winnerVillage?: string;
    warCrateId?: string;
    mvpByVillage?: Record<string, string>;
    loserCrateId?: string;
    contributions?: Record<string, { damage: number; side: string; name: string }>;
};

function villageWarRewardToken(war: VillageWarRewardRecord): string {
    const generation = Math.floor(Number(war.declarationGeneration));
    return Number.isSafeInteger(generation) && generation > 0
        ? `${war.id}-g${generation}`
        : war.id;
}

export type WarRewardCharacter = Record<string, unknown> & {
    name?: string;
    village?: string;
    clan?: string;
    profession?: string;
    inventory?: unknown[];
    claimedWarCrateIds?: unknown[];
};

export type WarRewardResult = {
    character: WarRewardCharacter;
    granted: boolean;
    crates: number;
    mvp: boolean;
    consolation: boolean;
    lifetimeDamage: number;
};

function sameName(a: unknown, b: unknown): boolean {
    return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
}

function numeric(character: WarRewardCharacter, key: string): number {
    const value = Number(character[key] ?? 0);
    return Number.isFinite(value) ? value : 0;
}

function clanDamageFor(war: ClanWar, clan: string, playerName: string): number {
    let damage = 0;
    for (const challenge of war.completedChallenges ?? []) {
        if (challenge.status !== 'completed' || !challenge.result || challenge.result === 'draw') continue;
        const winningClan = challenge.result === 'from-wins'
            ? challenge.fromClan
            : war.clans.find(candidate => candidate !== challenge.fromClan);
        if (winningClan !== clan) continue;
        const winners = challenge.fromClan === clan
            ? [challenge.fromPlayer, challenge.fromPlayer2]
            : [challenge.acceptedPlayer, challenge.acceptedPlayer2];
        if (winners.some(winner => sameName(winner, playerName))) {
            damage += CHALLENGE_DAMAGE[challenge.mode] ?? 0;
        }
    }
    return damage;
}

function applyCurrency(character: WarRewardCharacter, ryo: number, honor: number, shards: number): WarRewardCharacter {
    const normalizedHonor = Math.max(0, Math.floor(honor));
    const bonusCharms = normalizedHonor > 0 ? Math.max(1, Math.floor(normalizedHonor / 8)) : 0;
    const bonusShards = Math.floor(normalizedHonor / 25);
    return {
        ...character,
        ryo: numeric(character, 'ryo') + ryo,
        honorSeals: numeric(character, 'honorSeals') + (character.profession === 'vanguard' ? normalizedHonor : 0),
        boneCharms: numeric(character, 'boneCharms') + bonusCharms,
        fateShards: numeric(character, 'fateShards') + shards + bonusShards,
    };
}

export function settleVillageWarRewards(
    character: WarRewardCharacter,
    war: VillageWarRewardRecord,
    now: number = Date.now(),
): WarRewardResult {
    const village = String(character.village ?? '');
    const playerName = String(character.name ?? '');
    if (!war.endedAt || now - war.endedAt > WAR_REWARD_EXPIRY_MS || !war.villages.includes(village)) {
        return { character, granted: false, crates: 0, mvp: false, consolation: false, lifetimeDamage: 0 };
    }

    const claimed = new Set((character.claimedWarCrateIds ?? []).map(String));
    const markers: string[] = [];
    let crates = 0;
    let ryo = 0;
    let honor = 0;
    let shards = 0;
    let mvp = false;
    let consolation = false;
    let lifetimeDamage = 0;
    let warsWon = 0;
    let mvpCount = 0;

    if (war.winnerVillage === village && war.warCrateId && !claimed.has(war.warCrateId)) {
        markers.push(war.warCrateId);
        crates += 1;
        warsWon += 1;
    }

    const rewardToken = villageWarRewardToken(war);
    const mvpId = `mvp-crate-${rewardToken}`;
    if (sameName(war.mvpByVillage?.[village], playerName) && !claimed.has(mvpId)) {
        markers.push(mvpId);
        crates += 1;
        ryo += 10_000;
        honor += 50;
        shards += 2;
        mvp = true;
        mvpCount += 1;
    }

    const contribution = war.contributions?.[playerName.toLowerCase()];
    if (war.loserCrateId && war.winnerVillage && war.winnerVillage !== village
        && contribution?.side === village && contribution.damage >= 50 && !claimed.has(war.loserCrateId)) {
        markers.push(war.loserCrateId);
        ryo += 5_000;
        honor += 25;
        shards += 1;
        consolation = true;
    }

    const statsId = `stats-${rewardToken}`;
    if (contribution?.side === village && contribution.damage > 0 && !claimed.has(statsId)) {
        markers.push(statsId);
        lifetimeDamage = contribution.damage;
    }

    if (markers.length === 0) {
        return { character, granted: false, crates: 0, mvp: false, consolation: false, lifetimeDamage: 0 };
    }

    let next = applyCurrency(character, ryo, honor, shards);
    next = {
        ...next,
        inventory: [...(character.inventory ?? []), ...Array.from({ length: crates }, () => LEGENDARY_WAR_CRATE_ID)],
        claimedWarCrateIds: [...(character.claimedWarCrateIds ?? []).map(String), ...markers],
        warsWon: numeric(character, 'warsWon') + warsWon,
        warMvpCount: numeric(character, 'warMvpCount') + mvpCount,
        lifetimeWarDamage: numeric(character, 'lifetimeWarDamage') + lifetimeDamage,
    };
    return { character: next, granted: true, crates, mvp, consolation, lifetimeDamage };
}

export function settleClanWarRewards(
    character: WarRewardCharacter,
    war: ClanWar,
    now: number = Date.now(),
): WarRewardResult {
    const clan = String(character.clan ?? '');
    const playerName = String(character.name ?? '');
    if (!war.endedAt || now - war.endedAt > WAR_REWARD_EXPIRY_MS || !war.clans.includes(clan)) {
        return { character, granted: false, crates: 0, mvp: false, consolation: false, lifetimeDamage: 0 };
    }

    const claimed = new Set((character.claimedWarCrateIds ?? []).map(String));
    const markers: string[] = [];
    let crates = 0;
    let ryo = 0;
    let honor = 0;
    let shards = 0;
    let mvp = false;
    let consolation = false;
    let warsWon = 0;
    let mvpCount = 0;

    if (war.winnerClan === clan && war.warCrateId && !claimed.has(war.warCrateId)) {
        markers.push(war.warCrateId);
        crates += 1;
        warsWon += 1;
    }

    const clanSlug = clan.toLowerCase().replace(/[^a-z0-9]/g, '');
    const mvpId = `clan-war-mvp-${war.id}-${clanSlug}`;
    if (sameName(war.mvpByClan?.[clan], playerName) && !claimed.has(mvpId)) {
        markers.push(mvpId);
        ryo += 10_000;
        honor += 50;
        shards += 2;
        mvp = true;
        mvpCount += 1;
    }

    const damage = clanDamageFor(war, clan, playerName);
    const consolationId = `clan-war-consol-${war.id}-${playerName.toLowerCase()}`;
    if (war.winnerClan && war.winnerClan !== clan && damage >= 20 && !claimed.has(consolationId)) {
        markers.push(consolationId);
        ryo += 2_500;
        honor += 10;
        consolation = true;
    }

    const statsId = `clan-war-stats-${war.id}-${playerName.toLowerCase()}`;
    const lifetimeDamage = damage > 0 && !claimed.has(statsId) ? damage : 0;
    if (lifetimeDamage > 0) markers.push(statsId);

    if (markers.length === 0) {
        return { character, granted: false, crates: 0, mvp: false, consolation: false, lifetimeDamage: 0 };
    }

    let next = applyCurrency(character, ryo, honor, shards);
    next = {
        ...next,
        inventory: [...(character.inventory ?? []), ...Array.from({ length: crates }, () => LEGENDARY_WAR_CRATE_ID)],
        claimedWarCrateIds: [...(character.claimedWarCrateIds ?? []).map(String), ...markers],
        warsWon: numeric(character, 'warsWon') + warsWon,
        warMvpCount: numeric(character, 'warMvpCount') + mvpCount,
        lifetimeWarDamage: numeric(character, 'lifetimeWarDamage') + lifetimeDamage,
    };
    return { character: next, granted: true, crates, mvp, consolation, lifetimeDamage };
}
