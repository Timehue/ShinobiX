import { kv } from './_storage.js';
import { invalidateProcCache } from './_proc-cache.js';
import { SaveDebitNeedsReconcile, type SaveDebitDefinition } from './_save-debit-saga.js';
import { applyOffering, parseShrineState, type ShrineState } from './sector/_traces.js';
import { BOUNTY_KEY, creditBountyPlacement, normalizeBoard, type BountyBoard, type BountyPlacementPlan } from './pvp/_bounty.js';
import { applyTreasuryCredit, type TreasuryCreditPlan } from './_treasury-donate.js';
import { addClanXpServer } from './clan/_mission-catalog.js';

/*
 * The credit side of every retry-safe "player save -> shared record" debit
 * (api/_save-debit-saga.ts), in one place so the endpoints that start a
 * settlement and /api/admin/economy-reconcile, which finishes one, apply the
 * exact same credit. Each `kind` is stored in economy-tx journals; never
 * rename one.
 */

function ryoOf(character: Record<string, unknown>): number {
    const n = Math.floor(Number(character.ryo) || 0);
    return Number.isFinite(n) ? n : 0;
}

export type ShrineOfferPlan = { name: string; amount: number };

/** /api/sector/shrine-offer: a pure ryo sink into a shrine ledger. */
export const SHRINE_OFFER_SAGA: SaveDebitDefinition<ShrineState, ShrineOfferPlan> = {
    kind: 'shrine-offer',
    load: async (key) => parseShrineState(await kv.get(key)),
    save: async (key, next) => { await kv.set(key, next); },
    applyCredit: (state, plan, now) => applyOffering(state, plan.name, plan.amount, now),
    // Currency only, so a failed ledger write can simply give the ryo back
    // (issue #179: "a failed board write does not keep the debit").
    refund: (character, plan) => ({ ...character, ryo: ryoOf(character) + plan.amount }),
};

/** /api/pvp/bounty action 'place': escrow ryo onto a head. */
export const BOUNTY_PLACE_SAGA: SaveDebitDefinition<BountyBoard, BountyPlacementPlan> = {
    kind: 'pvp-bounty-place',
    load: async () => normalizeBoard(await kv.get<BountyBoard>(BOUNTY_KEY)),
    save: async (_key, next) => { await kv.set(BOUNTY_KEY, next); },
    applyCredit: (board, plan, now) => {
        const credited = creditBountyPlacement(board, plan, now);
        // Only reachable when a retry finishes an interrupted placement after
        // the board filled up: a fresh placement is refused before any charge.
        if (!credited) throw new SaveDebitNeedsReconcile('The bounty board is full, so the escrow cannot be added.');
        return credited;
    },
    // The placement it replaces refunded a failed board write too.
    refund: (character, plan) => ({ ...character, ryo: ryoOf(character) + plan.amount }),
};

export type ClanDonationPlan = { treasury: TreasuryCreditPlan; clanXp: number };

/**
 * /api/clan/treasury/donate. No refund: the debit also moves items and the
 * donor's monthly contribution, so an interrupted donation is finished (by the
 * donor's retry or an admin), never unwound.
 */
export const CLAN_DONATION_SAGA: SaveDebitDefinition<Record<string, unknown>, ClanDonationPlan> = {
    kind: 'clan-treasury-donate',
    load: (key) => kv.get<Record<string, unknown>>(key),
    save: async (key, next) => { await kv.set(key, next); },
    applyCredit: (clan, plan) => ({
        ...clan,
        treasury: applyTreasuryCredit(clan.treasury as Record<string, unknown> | undefined, plan.treasury),
        ...addClanXpServer(Number(clan.xp) || 0, Number(clan.level) || 1, plan.clanXp),
    }),
};

export type VillageDonationPlan = { treasury: TreasuryCreditPlan };

/** /api/village/treasury/donate. No refund, for the same reason as the clan twin. */
export const VILLAGE_DONATION_SAGA: SaveDebitDefinition<Record<string, unknown>, VillageDonationPlan> = {
    kind: 'village-treasury-donate',
    load: async (key) => (await kv.get<Record<string, unknown>>(key)) ?? {},
    save: async (key, next) => {
        await kv.set(key, next);
        // Every villager's next /api/game-state poll reads the new treasury
        // rather than a frame built before this donation.
        invalidateProcCache('game-state:frame');
    },
    applyCredit: (state, plan) => ({
        ...state,
        treasury: applyTreasuryCredit(state.treasury as Record<string, unknown> | undefined, plan.treasury),
    }),
};

export type VillageTaxPlan = { toTreasury: number };

/**
 * api/_war-tax-apply.ts: the treasury share of the daily occupation tax. No
 * refund: the debit also stamps the day as taxed and burns a share by design,
 * so an interrupted tax is finished (by the next assessment or an admin),
 * never unwound.
 */
export const VILLAGE_TAX_SAGA: SaveDebitDefinition<Record<string, unknown>, VillageTaxPlan> = {
    kind: 'village-tax',
    load: async (key) => (await kv.get<Record<string, unknown>>(key)) ?? {},
    save: async (key, next) => {
        await kv.set(key, next);
        invalidateProcCache('game-state:frame');
    },
    applyCredit: (state, plan) => {
        const treasury = (state.treasury ?? {}) as Record<string, unknown>;
        return { ...state, treasury: { ...treasury, ryo: (Number(treasury.ryo) || 0) + plan.toTreasury } };
    },
};

function sealsOf(character: Record<string, unknown>): number {
    return Math.max(0, Math.floor(Number(character.honorSeals) || 0));
}

export type HollowGateUnlockPlan = { windowMs: number; cost: number };

/**
 * /api/village/hollow-gate-unlock: the seated Kage spends Honor Seals to open
 * (or extend) the Hollow Gate window on the village row. The window is
 * computed when the credit lands, so a late roll-forward extends from then
 * and can never shorten a newer extension. (Its pre-saga journals use the
 * kind 'hollow-gate-unlock'; admin reconciliation still refunds those.)
 */
export const HOLLOW_GATE_UNLOCK_SAGA: SaveDebitDefinition<Record<string, unknown>, HollowGateUnlockPlan> = {
    kind: 'village-hollow-gate-unlock',
    load: async (key) => (await kv.get<Record<string, unknown>>(key)) ?? {},
    save: async (key, next) => {
        await kv.set(key, next);
        invalidateProcCache('game-state:frame');
    },
    applyCredit: (state, plan, now) => ({
        ...state,
        hollowGateUnlockedUntil: Math.max(now, Math.max(0, Number(state.hollowGateUnlockedUntil) || 0)) + plan.windowMs,
    }),
    refund: (character, plan) => ({ ...character, honorSeals: sealsOf(character) + plan.cost }),
};

export type ClanWarDeclarePlan = { war: Record<string, unknown>; cost: number };

/**
 * /api/clan/war/declare: the declaring officer's Honor Seals open a war
 * record for the clan pair. The credit never replaces a war that stands:
 * only a retry can reach it after the pair lock was released, and by then
 * another officer may have declared.
 */
export const CLAN_WAR_DECLARE_SAGA: SaveDebitDefinition<Record<string, unknown>, ClanWarDeclarePlan> = {
    kind: 'clan-war-declare',
    load: async (key) => (await kv.get<Record<string, unknown>>(key)) ?? {},
    save: async (key, next) => { await kv.set(key, next); },
    applyCredit: (current, plan, now) => {
        if (current.startedAt && !current.endedAt) {
            throw new SaveDebitNeedsReconcile('A war already stands between these clans, so this declaration cannot open another.');
        }
        return { ...plan.war, startedAt: now, updatedAt: now, settlementReceipts: current.settlementReceipts };
    },
    refund: (character, plan) => ({ ...character, honorSeals: sealsOf(character) + plan.cost }),
};

export type KageChallengeDeclarePlan = { challenge: Record<string, unknown>; cost: number };

/**
 * /api/village/kage-challenge action 'declare': the challenger's ryo stake
 * opens a challenge on the village's Kage record. (Its pre-saga journals use
 * the kind 'kage-challenge-declare'; admin reconciliation still refunds those.)
 */
export const KAGE_CHALLENGE_DECLARE_SAGA: SaveDebitDefinition<Record<string, unknown>, KageChallengeDeclarePlan> = {
    kind: 'kage-challenge-stake',
    load: async (key) => (await kv.get<Record<string, unknown>>(key)) ?? {},
    save: async (key, next) => { await kv.set(key, next); },
    applyCredit: (state, plan) => {
        if (!state.seatedKage || state.challenge) {
            throw new SaveDebitNeedsReconcile('The seat changed or another challenge is open, so this stake cannot open its challenge.');
        }
        return { ...state, challenge: plan.challenge };
    },
    refund: (character, plan) => ({ ...character, ryo: ryoOf(character) + plan.cost }),
};

export const SAVE_DEBIT_SAGAS: Readonly<Record<string, SaveDebitDefinition<Record<string, unknown>, unknown>>> = {
    [SHRINE_OFFER_SAGA.kind]: SHRINE_OFFER_SAGA as unknown as SaveDebitDefinition<Record<string, unknown>, unknown>,
    [BOUNTY_PLACE_SAGA.kind]: BOUNTY_PLACE_SAGA as unknown as SaveDebitDefinition<Record<string, unknown>, unknown>,
    [CLAN_DONATION_SAGA.kind]: CLAN_DONATION_SAGA as unknown as SaveDebitDefinition<Record<string, unknown>, unknown>,
    [VILLAGE_DONATION_SAGA.kind]: VILLAGE_DONATION_SAGA as unknown as SaveDebitDefinition<Record<string, unknown>, unknown>,
    [VILLAGE_TAX_SAGA.kind]: VILLAGE_TAX_SAGA as unknown as SaveDebitDefinition<Record<string, unknown>, unknown>,
    [HOLLOW_GATE_UNLOCK_SAGA.kind]: HOLLOW_GATE_UNLOCK_SAGA as unknown as SaveDebitDefinition<Record<string, unknown>, unknown>,
    [CLAN_WAR_DECLARE_SAGA.kind]: CLAN_WAR_DECLARE_SAGA as unknown as SaveDebitDefinition<Record<string, unknown>, unknown>,
    [KAGE_CHALLENGE_DECLARE_SAGA.kind]: KAGE_CHALLENGE_DECLARE_SAGA as unknown as SaveDebitDefinition<Record<string, unknown>, unknown>,
};
