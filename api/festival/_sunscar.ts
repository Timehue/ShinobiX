// Sunscar is a PERMANENT fixture, not a seasonal event, so its table is
// standing economy rather than event flavour and is priced that way.
//
// HISTORY — two wagers used to live here, and both are gone (owner decision
// 2026-09-03, taken for the Play content rating: a staked outcome is
// "gambling" on the IARC questionnaire no matter how it is dressed).
//
//   1. The dice cost 250 ryo and returned ~163 on average — a ~-35% gamble
//      with a losing branch. They are now a FREE daily draw that always pays.
//   2. Miraa took an even-money bet (50/100/250/500 ryo) on a Card Clash
//      match at a 40% server-rolled win chance — a 20% house edge. Removed
//      outright; `resolveMiraaWager` and MIRAA_WIN_CHANCE no longer exist.
//      MIRAA_ALLOWED_BETS survives ONLY to validate the sealed stake on an
//      in-flight wager so `miraa-report` can refund it (see sunscar.ts).
//
// The dice are now a small, bounded ryo FAUCET rather than a sink: ~56 ryo per
// draw at 5 draws/day is ~283 ryo/day. That is deliberate — a free daily that
// always pays something is the point — but it is the dial to watch if ryo
// inflates. `statPoints` stays 0 on every branch: the dice used to grant ~1.48
// per roll, which put ~16% of the authored daily growth budget
// (DAILY_PVE_GROWTH_TARGET = 45 in api/missions/_mission-catalog.ts) outside
// the invariant that guards it. Progression is not for sale and not for luck.
export const FATE_DICE_COST = 0;
export const FATE_DICE_DAILY_CAP = 5;
export const FATE_DICE_COUNT_TTL_SECONDS = 2 * 24 * 60 * 60;

export const FATE_DICE_SYMBOLS = ['scorpion', 'coin', 'eye', 'blade', 'moon', 'star'] as const;
export type FateDiceSymbol = typeof FATE_DICE_SYMBOLS[number];

export type FateDiceReward = {
    ryo: number;
    xp: number; // retired (character XP removed) — always 0, kept for old-client shape
    statPoints: number; // retired — ALWAYS 0; progression is not purchasable with ryo
    stamina: number; // retired with the wager rewrite — always 0, kept for old-client shape
    boneCharms: number;
    fateShards: number;
    auraStones: number; // retired with the wager rewrite — always 0, kept for old-client shape
};

export type FateDiceRoll = {
    roll: FateDiceSymbol[];
    reward: FateDiceReward;
    message: string;
};

// Retained ONLY so an in-flight wager's sealed stake can be validated and
// refunded. Nothing mints a new wager against this list any more.
export const MIRAA_ALLOWED_BETS = [50, 100, 250, 500] as const;
export type MiraaOutcome = 'refund';

// Single-use token lifetime for a wager opened before the removal shipped.
export const MIRAA_TOKEN_TTL_SECONDS = 15 * 60;

function randInt(rand: () => number, min: number, max: number): number {
    return min + Math.floor(rand() * (max - min + 1));
}

function emptyReward(): FateDiceReward {
    return { ryo: 0, xp: 0, statPoints: 0, stamina: 0, boneCharms: 0, fateShards: 0, auraStones: 0 };
}

export function utcDateKey(now = Date.now()): string {
    return new Date(now).toISOString().slice(0, 10);
}

export function rollFateDice(rand: () => number = Math.random): FateDiceRoll {
    const roll = Array.from({ length: 3 }, () => FATE_DICE_SYMBOLS[Math.floor(rand() * FATE_DICE_SYMBOLS.length)]);
    const reward = emptyReward();
    const same = roll[0] === roll[1] && roll[1] === roll[2];
    let message: string;

    // EVERY branch pays ryo — there is no losing face any more, which is what
    // takes the draw out of "gambling" on the rating questionnaire. Bone charms
    // ride on a triple (6/216 = 2.8%) and Fate Shards on the triple eye alone
    // (1/216 = 0.46%), so the premium output is ~8.5 shards a year at the daily
    // cap, down from ~25 when the dice were staked.
    if (same && roll[0] === 'eye') {
        reward.ryo = 100;
        reward.boneCharms = 3;
        reward.fateShards = 1;
        message = 'Three eyes. Kael stops smiling and counts the sealed prize tokens twice.';
    } else if (same) {
        reward.ryo = 80;
        reward.boneCharms = randInt(rand, 1, 3);
        message = `Three ${roll[0]} faces. Kael slides a lacquered prize box across the table.`;
    } else if (roll.includes('coin')) {
        reward.ryo = 70;
        message = 'A coin lands upright between the other dice. Kael counts out the best share of the day.';
    } else if (roll.includes('moon')) {
        reward.ryo = 55;
        message = 'The moon face turns up. Kael adds a modest stack of ryo and resets the dice.';
    } else if (roll.includes('star')) {
        reward.ryo = 45;
        message = 'A star face catches the lamplight. Kael pays the standing rate without comment.';
    } else if (roll.includes('blade')) {
        reward.ryo = 40;
        message = 'The blade face lands flat. Kael pays a little and tells you to spend it somewhere useful.';
    } else {
        reward.ryo = 30;
        message = 'No set. Kael pays the floor rate and gathers the dice for the next turn.';
    }

    return { roll, reward, message };
}

export function cleanMiraaBet(raw: unknown): number {
    const bet = Math.floor(Number(raw ?? 0));
    return MIRAA_ALLOWED_BETS.includes(bet as typeof MIRAA_ALLOWED_BETS[number]) ? bet : 0;
}

/*
 * Settlement for a wager that was already open when the removal shipped.
 *
 * The stake was debited by `miraa-start` before the outcome was known, so the
 * only honest way to retire the feature mid-flight is to hand it back: this
 * always refunds the sealed stake in full. There is no roll, no house edge and
 * no losing branch — `MIRAA_WIN_CHANCE` and the 2x payout are gone.
 *
 * Returns the amount to CREDIT on top of the escrow, i.e. the whole stake, so
 * the player ends net zero against their pre-wager balance.
 */
export function resolveMiraaRefund(bet: number): { outcome: MiraaOutcome; credit: number } {
    return { outcome: 'refund', credit: cleanMiraaBet(bet) };
}
