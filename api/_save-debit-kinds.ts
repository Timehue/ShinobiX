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

export const SAVE_DEBIT_SAGAS: Readonly<Record<string, SaveDebitDefinition<Record<string, unknown>, unknown>>> = {
    [SHRINE_OFFER_SAGA.kind]: SHRINE_OFFER_SAGA as unknown as SaveDebitDefinition<Record<string, unknown>, unknown>,
    [BOUNTY_PLACE_SAGA.kind]: BOUNTY_PLACE_SAGA as unknown as SaveDebitDefinition<Record<string, unknown>, unknown>,
    [CLAN_DONATION_SAGA.kind]: CLAN_DONATION_SAGA as unknown as SaveDebitDefinition<Record<string, unknown>, unknown>,
    [VILLAGE_DONATION_SAGA.kind]: VILLAGE_DONATION_SAGA as unknown as SaveDebitDefinition<Record<string, unknown>, unknown>,
};
