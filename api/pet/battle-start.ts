import { safeLogValue } from '../_safe-log.js';
import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { runPetDuel, runPetPartyDuel } from '../_pet-sim/pet-duel-sim.js';
import type { Pet } from '../_pet-sim/pet-types.js';
import { SERVER_ARENA_PETS } from './_arena-ai.js';
import { masteryBonus, masteryHasCapstone } from '../_profession-mastery.js';

/*
 * /api/pet/battle-start - POST only
 *
 * Mints a short-lived single-use token for non-ranked Pet Coliseum rewards.
 * Casual pet combat is still client-resolved, but rewardful battle-result calls
 * must now prove a battle was intentionally started by the authenticated player
 * with the same reportKey they later redeem.
 */

const TOKEN_TTL_SECONDS = 15 * 60;

const clampLevel = (n: number): number => Math.max(1, Math.min(100, Math.floor(Number.isFinite(n) ? n : 1)));

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const opponentName = typeof body.opponentName === 'string' ? safeName(body.opponentName) : '';
        const reportKeyRaw = typeof body.reportKey === 'string' ? body.reportKey.slice(0, 64) : '';
        const reportKey = /^[A-Za-z0-9:_-]+$/.test(reportKeyRaw) ? reportKeyRaw : '';
        const mode = body.mode === '2v2' ? '2v2' : '1v1';
        const playerPetIds: string[] = Array.isArray(body.playerPetIds) ? body.playerPetIds.map((value: unknown) => String(value)).slice(0, 2) : [];
        const opponentPetIds: string[] = Array.isArray(body.opponentPetIds) ? body.opponentPetIds.map((value: unknown) => String(value)).slice(0, 2) : [];
        const seed = Number.isSafeInteger(Number(body.seed)) ? Number(body.seed) : Date.now();

        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (!reportKey) return res.status(400).json({ error: 'Missing or invalid reportKey.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only start your own pet battles.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'pet-battle-start', 30, 60_000, identity.name))) return;

        const mySave = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const myChar = mySave?.character as Record<string, unknown> | undefined;
        const myPets = Array.isArray(myChar?.pets) ? myChar.pets as Array<Record<string, unknown>> : [];
        const playerPets = playerPetIds.map((id) => myPets.find((pet) => String(pet?.id ?? '') === id)).filter(Boolean) as unknown as Pet[];
        if (!playerPets.length) return res.status(409).json({ error: 'A stored player pet is required.' });
        let opponentPets: Pet[] = [];
        let isAiOpponent = false;
        let realOpponentLevel: number | null = null;
        if (opponentName) {
            const oppSave = await kv.get<Record<string, unknown>>(`save:${opponentName}`);
            const oppChar = oppSave?.character as Record<string, unknown> | undefined;
            const stored = Array.isArray(oppChar?.pets) ? oppChar.pets as Array<Record<string, unknown>> : [];
            opponentPets = opponentPetIds.map((id) => stored.find((pet) => String(pet?.id ?? '') === id)).filter(Boolean) as unknown as Pet[];
            if (opponentPets.length && oppChar) realOpponentLevel = clampLevel(Number(oppChar.level ?? 1));
        }
        if (!opponentPets.length) { opponentPets = opponentPetIds.map((id) => SERVER_ARENA_PETS[id]).filter(Boolean); isAiOpponent = opponentPets.length > 0; }
        if (!opponentPets.length) return res.status(409).json({ error: 'A server-known opponent pet is required.' });

        // Reward magnitude is SEALED here from the opponent actually fought — a
        // real opponent's live save level, or the AI pet's own level — never
        // body.opponentLevel. battle-result pays `level*2` ryo from this sealed
        // value, so a client can't beat a trivial level-8 AI and then report a
        // real level-100 name to be paid as though it beat the level-100 player.
        const sealedOpponentLevel = realOpponentLevel != null
            ? realOpponentLevel
            : clampLevel(Math.max(1, ...opponentPets.map((p) => Number((p as { level?: unknown }).level ?? 1))));
        const rank = Math.max(0, Math.min(10, Number(myChar?.professionRank) || 0));
        const damageMult = isAiOpponent && myChar?.profession === 'petTamer' ? 1 + (5 + rank * 1.5 + masteryBonus(myChar.profession, myChar.masterySpec, 'petPveDamagePct')) / 100 : 1;
        const hpMult = isAiOpponent ? 1 + masteryBonus(myChar?.profession, myChar?.masterySpec, 'petPveHpPct') / 100 : 1;
        const revive = isAiOpponent && masteryHasCapstone(myChar?.profession, myChar?.masterySpec, 'alpha-bond');
        const result = mode === '2v2'
            ? runPetPartyDuel(playerPets[0], playerPets[1] ?? null, opponentPets[0], opponentPets[1] ?? null, seed, damageMult, hpMult, revive, false, false, true).result
            : runPetDuel(playerPets[0], opponentPets[0], seed, damageMult, hpMult, revive, false, false, null, true).result;

        const token = randomUUID().replace(/-/g, '');
        await kv.set(`pet:battle-token:${playerName}:${token}`, {
            playerName,
            opponentName: opponentName || undefined,
            opponentLevel: sealedOpponentLevel,
            reportKey,
            mode,
            createdAt: Date.now(),
            playerPetIds,
            authoritativeOutcome: result,
        }, { ex: TOKEN_TTL_SECONDS });

        return res.status(200).json({ ok: true, token, reportKey });
    } catch (err) {
        console.error('[pet/battle-start]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
