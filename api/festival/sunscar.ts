import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { randomUUID } from 'node:crypto';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { cors, safeName } from '../_utils.js';
import { gainXp, type XpCharacter } from '../_xp-engine.js';
import { kv } from '../_storage.js';
import { consumeSingleUseToken } from '../_single-use-token.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import {
    cleanMiraaBet,
    FATE_DICE_COST,
    FATE_DICE_DAILY_CAP,
    MIRAA_DAILY_WAGER_CAP,
    MIRAA_TOKEN_TTL_SECONDS,
    resolveMiraaWager,
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
 * Server-side Sunscar settlement. Every payout is decided here — the client is
 * never trusted for a ryo outcome:
 *   - `dice`  — fully rolled + paid server-side (fixed cost, daily cap).
 *   - `miraa` — a wager on server-authoritative Shinobi Chronicle Showdown whose outcome the
 *     client owns and cannot be verified cheaply. Settled via the mint-token
 *     escrow pattern: `miraa-start` debits the stake and seals `bet` into a
 *     single-use token; `miraa-report` consumes the token and SERVER-ROLLS the
 *     result (see resolveMiraaWager), ignoring any client-reported outcome. The
 *     legacy client-attested `kind:'miraa'` path (a ryo mint) is retired below.
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

        // Miraa wager — open (escrow the stake + mint a single-use token). The
        // stake is committed here BEFORE the (server-rolled) result is known, so a
        // client can't cherry-pick which wagers to settle.
        if (kind === 'miraa-start') {
            const bet = cleanMiraaBet(body.bet);
            if (!bet) return res.status(400).json({ error: 'Invalid Miraa wager.' });

            // Daily wager cap on top of the 40/min rate limit. incr is atomic so
            // concurrent starts can't both slip under the cap. Admins are exempt
            // (test/tooling path).
            if (!identity.admin) {
                const startedToday = await kv.incr(`miraa-wager-count:${playerName}:${utcDateKey()}`, { ex: 25 * 60 * 60 });
                if (startedToday > MIRAA_DAILY_WAGER_CAP) {
                    return res.status(429).json({ error: `Miraa waves you off — you've wagered enough for one day (${MIRAA_DAILY_WAGER_CAP}/${MIRAA_DAILY_WAGER_CAP}).` });
                }
            }

            const out = await mutatePlayerSave(playerName, ({ character }) => {
                if (num(character.ryo) < bet) return { ok: false, status: 400, error: 'Not enough ryo for that wager.' };
                const nextCharacter = { ...character, ryo: num(character.ryo) - bet };
                return { ok: true, character: nextCharacter, value: { balanceRyo: num(nextCharacter.ryo) } };
            });
            if (!out.ok) return res.status(out.status).json({ error: out.error });

            // Seal the escrowed bet into a single-use token. The report endpoint
            // pays out from THIS bet, never the client body.
            const tokenId = randomUUID().replace(/-/g, '');
            await kv.set(`miraa-token:${playerName}:${tokenId}`, { playerName, bet, mintedAt: Date.now() }, { ex: MIRAA_TOKEN_TTL_SECONDS });

            return res.status(200).json({ ok: true, token: tokenId, bet, balanceRyo: out.value.balanceRyo, character: out.character, _saveVersion: out._saveVersion });
        }

        // Miraa wager — settle. Consume the single-use token, then SERVER-ROLL the
        // outcome from the sealed bet. The client's card result / any body.outcome
        // is ignored; the stake was already escrowed at start, so we only credit
        // winnings on a server-rolled win.
        if (kind === 'miraa-report') {
            const tokenRaw = typeof body.token === 'string' ? body.token.trim() : '';
            const token = /^[A-Za-z0-9]+$/.test(tokenRaw) ? tokenRaw : '';
            if (!token) return res.status(400).json({ error: 'Missing or invalid Miraa wager token.' });
            const forfeit = body.forfeit === true;

            // Atomic single-use consume — the delete rowcount is the real gate, so
            // two racing reports can't both settle (and double-pay) one wager.
            const sealed = await consumeSingleUseToken<{ playerName?: string; bet?: number }>(kv, `miraa-token:${playerName}:${token}`);
            if (!sealed) return res.status(409).json({ error: 'That wager has already settled or expired.' });
            if (String(sealed.playerName ?? '').toLowerCase() !== playerName.toLowerCase()) {
                return res.status(403).json({ error: 'That wager does not belong to you.' });
            }
            const bet = cleanMiraaBet(sealed.bet);
            if (!bet) return res.status(400).json({ error: 'Corrupt Miraa wager.' });

            const { outcome, credit } = resolveMiraaWager(bet, forfeit);
            const out = await mutatePlayerSave(playerName, ({ character }) => {
                const nextCharacter = { ...character, ryo: num(character.ryo) + credit };
                return { ok: true, character: nextCharacter, value: { outcome, bet, credit, balanceRyo: num(nextCharacter.ryo) } };
            });
            if (!out.ok) {
                // Token is already consumed (single-use). A credit-write failure
                // here LOSES the winnings rather than minting — the safe direction
                // ("debit before credit; never re-credit") — but log it so a rare
                // stuck payout is auditable.
                console.error('[festival/sunscar] miraa-report credit failed after token consume', { playerName, bet, outcome });
                return res.status(out.status).json({ error: out.error });
            }
            return res.status(200).json({ ok: true, ...out.value, character: out.character, _saveVersion: out._saveVersion });
        }

        // Retired: the old client-attested Miraa settlement trusted body.outcome
        // and paid bet×2 on a claimed 'win' with no stake deduction — a straight
        // ryo mint. Stale clients get a clear refresh signal, never a payout.
        if (kind === 'miraa') {
            return res.status(410).json({ error: 'Refresh the festival — the Miraa wager moved to a new, secure flow.' });
        }

        return res.status(400).json({ error: 'Unknown festival action.' });
    } catch (err) {
        console.error('[festival/sunscar]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
