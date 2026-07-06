export const FATE_DICE_COST = 25;
export const FATE_DICE_DAILY_CAP = 5;
export const FATE_DICE_COUNT_TTL_SECONDS = 2 * 24 * 60 * 60;

export const FATE_DICE_SYMBOLS = ['scorpion', 'coin', 'eye', 'blade', 'moon', 'star'] as const;
export type FateDiceSymbol = typeof FATE_DICE_SYMBOLS[number];

export type FateDiceReward = {
    ryo: number;
    xp: number;
    stamina: number;
    boneCharms: number;
    fateShards: number;
    auraStones: number;
};

export type FateDiceRoll = {
    roll: FateDiceSymbol[];
    reward: FateDiceReward;
    message: string;
};

export const MIRAA_ALLOWED_BETS = [50, 100, 250, 500] as const;
export type MiraaOutcome = 'win' | 'loss' | 'draw' | 'forfeit';

function randInt(rand: () => number, min: number, max: number): number {
    return min + Math.floor(rand() * (max - min + 1));
}

function emptyReward(): FateDiceReward {
    return { ryo: 0, xp: 0, stamina: 0, boneCharms: 0, fateShards: 0, auraStones: 0 };
}

export function utcDateKey(now = Date.now()): string {
    return new Date(now).toISOString().slice(0, 10);
}

export function rollFateDice(rand: () => number = Math.random): FateDiceRoll {
    const roll = Array.from({ length: 3 }, () => FATE_DICE_SYMBOLS[Math.floor(rand() * FATE_DICE_SYMBOLS.length)]);
    const reward = emptyReward();
    const same = roll[0] === roll[1] && roll[1] === roll[2];
    let message: string;

    if (same && roll[0] === 'eye') {
        reward.boneCharms = 10;
        reward.fateShards = 5;
        reward.auraStones = 5;
        message = 'LEGENDARY FATE! The Eye of the Dunes opens and rare currencies pour from the heavens.';
    } else if (same) {
        reward.boneCharms = randInt(rand, 1, 5);
        reward.fateShards = randInt(rand, 1, 3);
        message = `Triple ${roll[0]}! The dice bless you with rare spoils.`;
    } else if (roll.includes('scorpion')) {
        reward.ryo = 10;
        reward.xp = 15;
        message = 'The scorpion strikes. A harsh lesson leaves you with scraps.';
    } else if (roll.includes('coin')) {
        reward.ryo = 100;
        reward.xp = 20;
        message = 'Coins flash beneath the desert sun. Fortune smiles on you.';
    } else if (roll.includes('blade')) {
        reward.stamina = 30;
        reward.xp = 25;
        message = 'Blade omen. Your body surges with fighting spirit.';
    } else if (roll.includes('moon')) {
        reward.xp = 75;
        reward.ryo = 25;
        message = 'Moon omen. A strange luck follows you through the night.';
    } else {
        reward.ryo = 40;
        reward.xp = 10;
        message = 'Small fortune. The sands give a little back.';
    }

    return { roll, reward, message };
}

export function cleanMiraaOutcome(raw: unknown): MiraaOutcome | null {
    return raw === 'win' || raw === 'loss' || raw === 'draw' || raw === 'forfeit' ? raw : null;
}

export function cleanMiraaBet(raw: unknown): number {
    const bet = Math.floor(Number(raw ?? 0));
    return MIRAA_ALLOWED_BETS.includes(bet as typeof MIRAA_ALLOWED_BETS[number]) ? bet : 0;
}

export function miraaRyoDelta(bet: number, outcome: MiraaOutcome): number {
    if (!cleanMiraaBet(bet)) return 0;
    if (outcome === 'win') return bet * 2;
    if (outcome === 'loss' || outcome === 'forfeit') return -bet;
    return 0;
}
