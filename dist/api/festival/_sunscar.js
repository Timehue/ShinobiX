"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIRAA_ALLOWED_BETS = exports.FATE_DICE_SYMBOLS = exports.FATE_DICE_COUNT_TTL_SECONDS = exports.FATE_DICE_DAILY_CAP = exports.FATE_DICE_COST = void 0;
exports.utcDateKey = utcDateKey;
exports.rollFateDice = rollFateDice;
exports.cleanMiraaOutcome = cleanMiraaOutcome;
exports.cleanMiraaBet = cleanMiraaBet;
exports.miraaRyoDelta = miraaRyoDelta;
exports.FATE_DICE_COST = 25;
exports.FATE_DICE_DAILY_CAP = 5;
exports.FATE_DICE_COUNT_TTL_SECONDS = 2 * 24 * 60 * 60;
exports.FATE_DICE_SYMBOLS = ['scorpion', 'coin', 'eye', 'blade', 'moon', 'star'];
exports.MIRAA_ALLOWED_BETS = [50, 100, 250, 500];
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
function cleanMiraaOutcome(raw) {
    return raw === 'win' || raw === 'loss' || raw === 'draw' || raw === 'forfeit' ? raw : null;
}
function cleanMiraaBet(raw) {
    const bet = Math.floor(Number(raw ?? 0));
    return exports.MIRAA_ALLOWED_BETS.includes(bet) ? bet : 0;
}
function miraaRyoDelta(bet, outcome) {
    if (!cleanMiraaBet(bet))
        return 0;
    if (outcome === 'win')
        return bet * 2;
    if (outcome === 'loss' || outcome === 'forfeit')
        return -bet;
    return 0;
}
