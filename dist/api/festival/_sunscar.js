"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIRAA_DAILY_WAGER_CAP = exports.MIRAA_TOKEN_TTL_SECONDS = exports.MIRAA_WIN_CHANCE = exports.MIRAA_ALLOWED_BETS = exports.FATE_DICE_SYMBOLS = exports.FATE_DICE_COUNT_TTL_SECONDS = exports.FATE_DICE_DAILY_CAP = exports.FATE_DICE_COST = void 0;
exports.utcDateKey = utcDateKey;
exports.rollFateDice = rollFateDice;
exports.cleanMiraaBet = cleanMiraaBet;
exports.resolveMiraaWager = resolveMiraaWager;
exports.FATE_DICE_COST = 25;
exports.FATE_DICE_DAILY_CAP = 5;
exports.FATE_DICE_COUNT_TTL_SECONDS = 2 * 24 * 60 * 60;
exports.FATE_DICE_SYMBOLS = ['scorpion', 'coin', 'eye', 'blade', 'moon', 'star'];
exports.MIRAA_ALLOWED_BETS = [50, 100, 250, 500];
// Server-rolled Miraa win chance. Owner-approved 2026-07-16. With an even-money
// payout (win pays 2×stake back, loss keeps the stake) the expected value is
// 0.40·(+bet) + 0.60·(−bet) = −0.20·bet — a ~20% house edge, so Miraa is a
// deliberate ryo SINK, not a faucet. Do NOT change without fresh owner sign-off.
exports.MIRAA_WIN_CHANCE = 0.40;
// Single-use wager token lifetime. Long enough to play out a full Shinobi Card
// Clash match (6 turns × 3 lanes) before the escrowed stake's token expires.
exports.MIRAA_TOKEN_TTL_SECONDS = 15 * 60;
// Daily cap on opened wagers per player (checklist: daily cap AND rate limit).
// Generous — a legit player rarely plays 50 full card matches a day — but bounds
// griefing/automation. Each opened wager escrows real ryo, so the sink itself
// already discourages spam.
exports.MIRAA_DAILY_WAGER_CAP = 50;
function randInt(rand, min, max) {
    return min + Math.floor(rand() * (max - min + 1));
}
function emptyReward() {
    return { ryo: 0, xp: 0, stamina: 0, boneCharms: 0, fateShards: 0, auraStones: 0 };
}
function utcDateKey(now = Date.now()) {
    return new Date(now).toISOString().slice(0, 10);
}
function rollFateDice(rand = Math.random) {
    const roll = Array.from({ length: 3 }, () => exports.FATE_DICE_SYMBOLS[Math.floor(rand() * exports.FATE_DICE_SYMBOLS.length)]);
    const reward = emptyReward();
    const same = roll[0] === roll[1] && roll[1] === roll[2];
    let message;
    if (same && roll[0] === 'eye') {
        reward.boneCharms = 10;
        reward.fateShards = 5;
        reward.auraStones = 5;
        message = 'LEGENDARY FATE! The Eye of the Dunes opens and rare currencies pour from the heavens.';
    }
    else if (same) {
        reward.boneCharms = randInt(rand, 1, 5);
        reward.fateShards = randInt(rand, 1, 3);
        message = `Triple ${roll[0]}! The dice bless you with rare spoils.`;
    }
    else if (roll.includes('scorpion')) {
        reward.ryo = 10;
        reward.xp = 15;
        message = 'The scorpion strikes. A harsh lesson leaves you with scraps.';
    }
    else if (roll.includes('coin')) {
        reward.ryo = 100;
        reward.xp = 20;
        message = 'Coins flash beneath the desert sun. Fortune smiles on you.';
    }
    else if (roll.includes('blade')) {
        reward.stamina = 30;
        reward.xp = 25;
        message = 'Blade omen. Your body surges with fighting spirit.';
    }
    else if (roll.includes('moon')) {
        reward.xp = 75;
        reward.ryo = 25;
        message = 'Moon omen. A strange luck follows you through the night.';
    }
    else {
        reward.ryo = 40;
        reward.xp = 10;
        message = 'Small fortune. The sands give a little back.';
    }
    return { roll, reward, message };
}
function cleanMiraaBet(raw) {
    const bet = Math.floor(Number(raw ?? 0));
    return exports.MIRAA_ALLOWED_BETS.includes(bet) ? bet : 0;
}
/*
 * Server-authoritative Miraa settlement.
 *
 * Miraa plays skill-based Shinobi Card Clash, whose win/loss is produced entirely
 * on the (untrusted) client with no determinism contract — so the ryo result
 * CANNOT be read from a client-reported outcome without reopening a mint (a
 * hostile client would simply always report 'win'). Instead the wager resolves as
 * a server-rolled fate draw: `miraa-start` escrows the stake and seals `bet` into
 * a single-use token, and `miraa-report` calls this to roll the outcome here from
 * the sealed bet — never from the client body.
 *
 * The stake was already debited at start, so this returns only the amount to
 * CREDIT back on top of the escrow:
 *   win     → 2×bet  (net +bet vs. the pre-wager balance — matches the "win 2×" UI)
 *   loss    → 0       (net −bet — the escrowed stake is kept by the house)
 *   forfeit → 0       (net −bet — bailing mid-match keeps the stake with Miraa)
 *
 * `forfeit` (the player left the match) is an automatic loss with no roll; a
 * played-out match rolls at MIRAA_WIN_CHANCE regardless of the client card result.
 */
function resolveMiraaWager(bet, forfeit = false, rand = Math.random) {
    const stake = cleanMiraaBet(bet);
    if (!stake)
        return { outcome: 'loss', credit: 0 };
    if (forfeit)
        return { outcome: 'forfeit', credit: 0 };
    return rand() < exports.MIRAA_WIN_CHANCE
        ? { outcome: 'win', credit: stake * 2 }
        : { outcome: 'loss', credit: 0 };
}
