import { CHALLENGE_DAMAGE, type ClanWar } from '../clan/war/_storage.js';
import { safeName } from '../_utils.js';
import { economyDial } from '../_economy-dials.js';
import { anchorRyoPerMinute } from '../../shared/economy-anchor.js';
import { preparationTier } from '../../shared/war-preparations.js';
import { ACCOUNT_AGE_MIN_MS } from '../pvp/_pvp-anti-alt.js';
import { villageWarAgreementPayFraction, villageWarEndedEarlyByAgreement, warMinDurationMs } from './_early-end.js';
import { stagedRaise, warPurseScale } from './_war-pay-scale.js';

export const WAR_REWARD_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
export const LEGENDARY_WAR_CRATE_ID = 'legendary-war-crate';

// ── Village-war reward values (2026-10 rebalance, framework 2.9 / #28 / #32 / #7) ──

/** Honor on the consolation of a lost war (25 before the rebalance; seals move toward war). */
export const VILLAGE_WAR_CONSOLATION_HONOR = 50;
export const VILLAGE_WAR_CONSOLATION_RYO = 5_000;
/** Honor on a side's MVP bundle (50 before the rebalance). */
export const VILLAGE_WAR_MVP_HONOR = 100;
/** Today's MVP ryo, and the floor of the anchored MVP purse. */
export const VILLAGE_WAR_MVP_RYO_FLOOR = 10_000;
/** The full MVP ryo is max(floor, 50 x A(L)): 15,000 at L70+. */
export const VILLAGE_WAR_MVP_RYO_PER_ANCHOR = 50;
/** Purse points above this pay nothing more (the per-war farm bound). */
export const WAR_PURSE_POINT_CAP = 400;
/** A member needs this many campaign points for a purse. */
export const WAR_PURSE_MIN_POINTS = 40;
/** Purse honor: one per this many capped points (at most 50). */
export const WAR_PURSE_HONOR_POINTS_PER_SEAL = 8;
/** Code defaults of the purse rates: ryo per point per A(L). */
export const WAR_PURSE_WIN_K_DEFAULT = 0.3;
export const WAR_PURSE_LOSE_K_DEFAULT = 0.18;
/** Wars that ended before this pay no purse: the claim window re-posts every
 *  ended war of the last 7 days, so without it the first build would pay
 *  purses on wars that ended before it shipped. WAR_PURSE_EPOCH_MS overrides it. */
export const WAR_PURSE_EPOCH_DEFAULT_MS = Date.UTC(2026, 9, 22);

// WAR_PURSE_SCALE (default 1, range 0-1) stages the raised war pay: the purses
// (ryo and purse honor), the MVP raise above 10,000 and the ANBU raise above 500.
// It lives in a storage-free module so the ANBU core can read it too.
export { warPurseScale, stagedRaise } from './_war-pay-scale.js';
/** WAR_PURSE_WIN_K (default 0.3, range 0-0.6): winners' purse rate. */
export function warPurseWinK(): number {
    return economyDial('WAR_PURSE_WIN_K', WAR_PURSE_WIN_K_DEFAULT, { min: 0, max: 0.6 });
}
/** WAR_PURSE_LOSE_K (default 0.18, range 0-0.36): losers' (and both sides of a draw) purse rate. */
export function warPurseLoseK(): number {
    return economyDial('WAR_PURSE_LOSE_K', WAR_PURSE_LOSE_K_DEFAULT, { min: 0, max: 0.36 });
}
/** WAR_PURSE_EPOCH_MS (default 2026-10-22 UTC): wars that ended earlier pay no purse. */
export function warPurseEpochMs(): number {
    return economyDial('WAR_PURSE_EPOCH_MS', WAR_PURSE_EPOCH_DEFAULT_MS, { min: 0, max: 8.64e15 });
}

export type WarRewardDials = {
    purseScale: number;
    winK: number;
    loseK: number;
    epochMs: number;
    minDurationMs: number;
};

/** Every war-reward dial, read once per claim. Tests pass their own. */
export function warRewardDials(): WarRewardDials {
    return {
        purseScale: warPurseScale(),
        winK: warPurseWinK(),
        loseK: warPurseLoseK(),
        epochMs: warPurseEpochMs(),
        minDurationMs: warMinDurationMs(),
    };
}

/** The MVP's ryo at the claimant's level before staging: max(10,000, 50 x A(L)). */
export function villageWarMvpRyoFull(level: unknown): number {
    return Math.max(VILLAGE_WAR_MVP_RYO_FLOOR, VILLAGE_WAR_MVP_RYO_PER_ANCHOR * anchorRyoPerMinute(Number(level)));
}

type CampaignReceiptRow = { points?: unknown; village?: unknown; player?: unknown };
type CampaignAdmissionRow = { npc?: unknown; supportTiers?: { warAcademy?: unknown } };

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
    // The fields the early-agreement rule and the purse read (api/war/_early-end.ts).
    startedAt?: number;
    pendingUntil?: number;
    surrenderedBy?: string;
    peaceProposals?: Record<string, number>;
    /** Present on five-day campaign wars, whose `contributions.damage` is campaign points. */
    campaign?: {
        receipts?: Record<string, CampaignReceiptRow>;
        admissions?: Record<string, CampaignAdmissionRow>;
    };
};

/**
 * A member's purse points: their campaign points with the War Academy bonus
 * taken back out. The Academy is bought with treasury ryo and multiplies PvE
 * operation points by 1.1-1.3, so paying the purse on boosted points would let
 * a village turn treasury ryo into more private ryo than it spent (framework
 * 2.11: every converter loop stays below 1). Falls back to the contribution
 * total when the row carries no receipts. Pure.
 */
export function villageWarPursePoints(war: VillageWarRewardRecord, contributorKey: string, village: string, fallback: number): number {
    const receipts = war.campaign?.receipts;
    if (!receipts || typeof receipts !== 'object') return Math.max(0, Math.floor(fallback));
    const admissions = war.campaign?.admissions ?? {};
    let total = 0;
    let found = false;
    for (const [receiptId, row] of Object.entries(receipts)) {
        if (!row || row.player !== contributorKey || row.village !== village) continue;
        const points = Math.floor(Number(row.points) || 0);
        if (points <= 0) continue;
        found = true;
        const admission = admissions[receiptId.replace(/^(field|run):/, '')];
        const academy = admission?.npc === true ? preparationTier(admission.supportTiers?.warAcademy) : 0;
        total += academy > 0 ? Math.round(points / (1 + academy / 10)) : points;
    }
    return found ? total : Math.max(0, Math.floor(fallback));
}

/** The 72 h account-age rule the PvP purse uses, at the moment the war ended. */
export function warAccountOldEnough(character: Record<string, unknown>, at: number): boolean {
    const created = Number(character.createdAt);
    // Fail open: a save with no createdAt stamp is not treated as a fresh alt.
    return !(Number.isFinite(created) && created > 0 && at - created < ACCOUNT_AGE_MIN_MS);
}

export function villageWarRewardToken(war: VillageWarRewardRecord): string {
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
    /** Village-war purse ryo paid by this claim (0 for clan wars). */
    purse: number;
    /** Purse honor paid by this claim (before the BC / FS split). */
    purseHonor: number;
    /** All ryo this claim paid (MVP + consolation + purse), for the economy ledger. */
    ryo: number;
};

function nothing(character: WarRewardCharacter): WarRewardResult {
    return { character, granted: false, crates: 0, mvp: false, consolation: false, lifetimeDamage: 0, purse: 0, purseHonor: 0, ryo: 0 };
}

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
    dials: WarRewardDials = warRewardDials(),
): WarRewardResult {
    const village = String(character.village ?? '');
    const playerName = String(character.name ?? '');
    if (!war.endedAt || now - war.endedAt > WAR_REWARD_EXPIRY_MS || !war.villages.includes(village)) {
        return nothing(character);
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
    let purse = 0;
    let purseHonor = 0;

    // The war's contribution ledger is keyed by the player's safeName SLUG (every
    // server writer keys it by the authenticated name). It used to be read by the
    // lowercased DISPLAY name, so a player called "Kira Emberfall" (slug
    // "kiraemberfall") never found their own damage and lost the consolation and the
    // lifetime-damage stat. The display-name key is kept as a fallback for rows
    // written before every writer used the slug.
    const contributorKey = war.contributions?.[safeName(playerName)] ? safeName(playerName) : playerName.toLowerCase();
    const contribution = war.contributions?.[safeName(playerName)]
        ?? war.contributions?.[playerName.toLowerCase()];
    // A surrender or agreed peace before the floor pays no crates, purses or
    // MVP (I-5). world-state strips the crate ids and MVPs from such an ending
    // when it stamps it (api/world-state.ts stampVillageWarEnding), so the
    // crate and MVP branches below find nothing to pay; the purse checks the
    // rule itself as well.
    const earlyAgreement = villageWarEndedEarlyByAgreement(war, dials.minDurationMs);
    // An agreement ending past the floor pays the raised war pay (purse, purse
    // honor, the MVP raise) for the share of the campaign that was fought.
    const payFraction = villageWarAgreementPayFraction(war);
    const level = Number(character.level);
    const mvpName = war.mvpByVillage?.[village];
    // Campaign pet/card/support writers record the authenticated account slug;
    // legacy/combat writers may record its display name. Both name one account.
    const isMvp = sameName(mvpName, playerName)
        || (!!safeName(mvpName ?? '') && safeName(mvpName ?? '') === safeName(playerName));

    // The winner's crate is for members of the winning village who FOUGHT for it
    // (owner ruling 2026-10-08): damage for that side, or its MVP. Winning alone
    // used to be enough, so a member who never fought — or a player who moved
    // villages after the war — could claim a Legendary War Crate.
    const foughtForWinner = isMvp || (!!contribution && contribution.side === village && Number(contribution.damage) > 0);
    if (war.winnerVillage === village && war.warCrateId && !claimed.has(war.warCrateId) && foughtForWinner) {
        markers.push(war.warCrateId);
        crates += 1;
        warsWon += 1;
    }

    const rewardToken = villageWarRewardToken(war);
    const mvpId = `mvp-crate-${rewardToken}`;
    if (isMvp && !claimed.has(mvpId)) {
        markers.push(mvpId);
        crates += 1;
        // The anchored raise above today's 10,000 is staged by WAR_PURSE_SCALE
        // and, on an agreement ending, by the share of the campaign fought.
        ryo += stagedRaise(VILLAGE_WAR_MVP_RYO_FLOOR, villageWarMvpRyoFull(level), dials.purseScale * payFraction);
        honor += VILLAGE_WAR_MVP_HONOR;
        shards += 2;
        mvp = true;
        mvpCount += 1;
    }

    if (war.loserCrateId && war.winnerVillage && war.winnerVillage !== village
        && contribution?.side === village && contribution.damage >= 50 && !claimed.has(war.loserCrateId)) {
        markers.push(war.loserCrateId);
        ryo += VILLAGE_WAR_CONSOLATION_RYO;
        honor += VILLAGE_WAR_CONSOLATION_HONOR;
        shards += 1;
        consolation = true;
    }

    // The war purse (framework #7): ryo per contribution point, paid at the
    // claimant's level, on campaign wars that ended after the purse shipped.
    // Members of both sides earn it; winners at the higher rate, a draw pays
    // both sides the losers' rate. The marker rides the existing
    // claimedWarCrateIds payout stamp, so no save field is added.
    const purseId = `purse-${rewardToken}`;
    if (dials.purseScale > 0 && war.campaign && war.endedAt >= dials.epochMs && !earlyAgreement
        && contribution?.side === village && !claimed.has(purseId) && warAccountOldEnough(character, war.endedAt)) {
        const points = villageWarPursePoints(war, contributorKey, village, Number(contribution.damage) || 0);
        if (points >= WAR_PURSE_MIN_POINTS) {
            const capped = Math.min(points, WAR_PURSE_POINT_CAP);
            const k = war.winnerVillage === village ? dials.winK : dials.loseK;
            const scale = dials.purseScale * payFraction;
            purse = Math.round(capped * k * anchorRyoPerMinute(level) * scale);
            purseHonor = Math.floor(Math.floor(capped / WAR_PURSE_HONOR_POINTS_PER_SEAL) * scale);
            if (purse > 0 || purseHonor > 0) {
                markers.push(purseId);
                ryo += purse;
                honor += purseHonor;
            }
        }
    }

    const statsId = `stats-${rewardToken}`;
    if (contribution?.side === village && contribution.damage > 0 && !claimed.has(statsId)) {
        markers.push(statsId);
        lifetimeDamage = contribution.damage;
    }

    if (markers.length === 0) {
        return nothing(character);
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
    return { character: next, granted: true, crates, mvp, consolation, lifetimeDamage, purse, purseHonor, ryo };
}

export function settleClanWarRewards(
    character: WarRewardCharacter,
    war: ClanWar,
    now: number = Date.now(),
): WarRewardResult {
    const clan = String(character.clan ?? '');
    const playerName = String(character.name ?? '');
    if (!war.endedAt || now - war.endedAt > WAR_REWARD_EXPIRY_MS || !war.clans.includes(clan)) {
        return nothing(character);
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

    // The winner's crate is for members who FOUGHT for the winning clan — the
    // rule /api/village/claim-war-crate already enforces (warCrateClaimDecision)
    // and the village branch above follows. Without it, a member who sat the
    // war out, or anyone who joined the winning clan after it ended, got a
    // Legendary War Crate here. Campaign wars carry a per-player ledger;
    // legacy (admin-made) wars fall back to dealt damage or the clan's MVP.
    const clanSlug = clan.toLowerCase().replace(/[^a-z0-9]/g, '');
    const campaignEntry = war.campaign?.contributions?.[safeName(playerName)];
    const foughtForWinningClan = war.campaign
        ? !!campaignEntry && campaignEntry.clan === clan && Number(campaignEntry.played) > 0
        : clanDamageFor(war, clan, playerName) > 0 || sameName(war.mvpByClan?.[clan], playerName);
    if (war.winnerClan === clan && war.warCrateId && !claimed.has(war.warCrateId) && foughtForWinningClan) {
        markers.push(war.warCrateId);
        crates += 1;
        warsWon += 1;
    }

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
        return nothing(character);
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
    return { character: next, granted: true, crates, mvp, consolation, lifetimeDamage, purse: 0, purseHonor: 0, ryo };
}
