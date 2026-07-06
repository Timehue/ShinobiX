import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { cors, safeName } from '../_utils.js';
import { gainXp, type XpCharacter } from '../_xp-engine.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import {
    cleanMiraaBet,
    cleanMiraaOutcome,
    FATE_DICE_COST,
    FATE_DICE_DAILY_CAP,
    miraaRyoDelta,
    rollFateDice,
    utcDateKey,
} from './_sunscar.js';

function num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

/*
 * /api/festival/sunscar - POST
 *
 * Server-side Sunscar settlement. Dice are fully rolled and paid here; Miraa
 * wager settlement is locked to fixed bet/outcome deltas so the client no longer
 * edits ryo directly.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        const kind = String(body.kind ?? '');
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'You can only act for your own account.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'sunscar-festival', 40, 60_000, identity.name))) return;

        if (kind === 'dice') {
            const today = utcDateKey();
            const out = await mutatePlayerSave(playerName, ({ character }) => {
                const used = String(character.lastDailyReset ?? '') === today
                    ? Math.max(0, Math.floor(Number(character.dailyFateSpins ?? 0) || 0))
                    : 0;
                if (used >= FATE_DICE_DAILY_CAP) {
                    return {
                        ok: false,
                        status: 429,
                        error: `The dice grow cold. Your fate is spent for today (${FATE_DICE_DAILY_CAP}/${FATE_DICE_DAILY_CAP}).`,
                    };
                }
                if (num(character.ryo) < FATE_DICE_COST) {
                    return { ok: false, status: 400, error: `Not enough ryo. A roll costs ${FATE_DICE_COST}.` };
                }

                const result = rollFateDice(Math.random);
                const paid = { ...character, ryo: num(character.ryo) - FATE_DICE_COST } as XpCharacter;
                const leveled = gainXp(paid, result.reward.xp) as unknown as Record<string, unknown>;
                const nextCharacter = {
                    ...character,
                    ...leveled,
                    ryo: num(leveled.ryo) + result.reward.ryo,
                    stamina: Math.min(num(leveled.maxStamina), num(leveled.stamina) + result.reward.stamina),
                    boneCharms: num(leveled.boneCharms) + result.reward.boneCharms,
                    fateShards: num(leveled.fateShards) + result.reward.fateShards,
                    auraStones: num(leveled.auraStones) + result.reward.auraStones,
                    dailyFateSpins: used + 1,
                    lastDailyReset: today,
                };
                return { ok: true, character: nextCharacter, value: { ...result, dailyUsed: used + 1, dailyCap: FATE_DICE_DAILY_CAP, cost: FATE_DICE_COST } };
            });
            if (!out.ok) return res.status(out.status).json({ error: out.error });
            return res.status(200).json({ ok: true, ...out.value, character: out.character, _saveVersion: out._saveVersion });
        }

        if (kind === 'miraa') {
            const bet = cleanMiraaBet(body.bet);
            const outcome = cleanMiraaOutcome(body.outcome);
            if (!bet || !outcome) return res.status(400).json({ error: 'Invalid Miraa wager.' });
            const out = await mutatePlayerSave(playerName, ({ character }) => {
                if (num(character.ryo) < bet) return { ok: false, status: 400, error: 'Not enough ryo for that wager.' };
                const delta = miraaRyoDelta(bet, outcome);
                const nextCharacter = { ...character, ryo: Math.max(0, num(character.ryo) + delta) };
                return { ok: true, character: nextCharacter, value: { bet, outcome, delta, balanceRyo: num(nextCharacter.ryo) } };
            });
            if (!out.ok) return res.status(out.status).json({ error: out.error });
            return res.status(200).json({ ok: true, ...out.value, character: out.character, _saveVersion: out._saveVersion });
        }

        return res.status(400).json({ error: 'Unknown festival action.' });
    } catch (err) {
        console.error('[festival/sunscar]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
