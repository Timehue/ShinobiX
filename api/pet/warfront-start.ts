import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { runWarfrontMatch } from '../_pet-sim/pet-warfront-sim.js';
import { derivePetRole } from '../_pet-sim/pet-roles.js';
import { buildWarfrontAiTeam } from './_warfront-ai.js';
import type { Pet } from '../_pet-sim/pet-types.js';

/*
 * /api/pet/warfront-start — POST only.
 *
 * Mints the single-use reward token for a Hollow Warfront vs-AI match, the
 * SERVER-AUTHORITATIVE way: the server RE-RUNS the exact deterministic match the
 * browser is about to render (same player pets, canonical AI red team, seed,
 * buy policy, stance) and seals the winner + reward level into a `pet:battle-token`
 * — the SAME token shape battle-result.ts already redeems for 1v1/2v2. A client
 * can't fake a win; the server computed it independently.
 *
 * Determinism: the Warfront sim meets the cross-engine contract (no
 * sin/cos/atan2/hypot — see its header), and warfront-parity.test.ts proves the
 * server re-sim === the client render (streamed) === this full-auto run, so a
 * Firefox player's win reproduces here byte-for-byte. vs-AI reward matches LOCK
 * the buy to a deterministic policy (never interactive "off"), matching the
 * PvP/co-op rule, so the match is a pure function of the sealed inputs.
 */

const TOKEN_TTL_SECONDS = 15 * 60;
type WfBuyPolicy = 'balanced' | 'offense' | 'defense';
type WfStance = 'balanced' | 'siege' | 'jungle' | 'headhunt' | 'turtle';
type ArenaRole = 'defender' | 'tracker' | 'assassin' | 'sage';
interface ArenaSlot { pet: Pet; role: ArenaRole }

const clampLevel = (n: number): number => Math.max(1, Math.min(100, Math.floor(Number.isFinite(n) ? n : 1)));
// Roles the client's way: the pet's own role, else derive it (id/name/element/rarity).
const autoRole = (pets: Pet[]): ArenaSlot[] => pets.map((pet) => ({ pet, role: (pet.role ?? derivePetRole(pet).role) as ArenaRole }));

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const reportKeyRaw = typeof body.reportKey === 'string' ? body.reportKey.slice(0, 64) : '';
        const reportKey = /^[A-Za-z0-9:_-]+$/.test(reportKeyRaw) ? reportKeyRaw : '';
        const playerPetIds: string[] = Array.isArray(body.playerPetIds) ? body.playerPetIds.map((v: unknown) => String(v)).slice(0, 4) : [];
        const seed = Number.isSafeInteger(Number(body.seed)) ? Number(body.seed) : 0;
        const stanceRaw = String(body.stance ?? 'balanced');
        const stance: WfStance = (['balanced', 'siege', 'jungle', 'headhunt', 'turtle'].includes(stanceRaw) ? stanceRaw : 'balanced') as WfStance;
        // "off" (interactive) is clamped to a deterministic policy — the reward path
        // must be reproducible; the player still gets offense/defense/balanced.
        const policyRaw = String(body.buyPolicy ?? 'balanced');
        const buyPolicy: WfBuyPolicy = (policyRaw === 'offense' || policyRaw === 'defense') ? policyRaw : 'balanced';

        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (!reportKey) return res.status(400).json({ error: 'Missing or invalid reportKey.' });
        if (!playerPetIds.length) return res.status(400).json({ error: 'No player pets supplied.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only start your own matches.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'warfront-start', 30, 60_000, identity.name))) return;

        // BLUE = the player's REAL pets (authoritative stats loaded from the save —
        // never client-supplied), in the picked order.
        const mySave = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const myChar = mySave?.character as Record<string, unknown> | undefined;
        const myPets = Array.isArray(myChar?.pets) ? myChar.pets as unknown as Pet[] : [];
        const bluePets = playerPetIds
            .map((id) => myPets.find((p) => String((p as { id?: unknown }).id ?? '') === id))
            .filter(Boolean) as Pet[];
        if (!bluePets.length) return res.status(409).json({ error: 'A stored player pet is required.' });

        // RED = the canonical Warfront vs-AI pool cycled to the player's count.
        const redPets = buildWarfrontAiTeam(bluePets.length);

        // Re-run the exact rendered match and read the authoritative winner.
        const result = runWarfrontMatch(autoRole(bluePets), autoRole(redPets), seed, buyPolicy, 'balanced', undefined, { blue: stance });
        const authoritativeOutcome: 'win' | 'loss' | 'draw' = result.winner === 'blue' ? 'win' : result.winner === 'red' ? 'loss' : 'draw';

        // Reward magnitude sealed from the AI actually fought (avg level).
        const sealedOpponentLevel = clampLevel(redPets.reduce((s, p) => s + Number((p as { level?: unknown }).level ?? 1), 0) / Math.max(1, redPets.length));

        const token = randomUUID().replace(/-/g, '');
        await kv.set(`pet:battle-token:${playerName}:${token}`, {
            playerName,
            opponentLevel: sealedOpponentLevel,
            reportKey,
            mode: 'warfront',
            createdAt: Date.now(),
            playerPetIds,
            authoritativeOutcome,
        }, { ex: TOKEN_TTL_SECONDS });

        return res.status(200).json({ ok: true, token, reportKey, outcome: authoritativeOutcome });
    } catch (err) {
        console.error('[pet/warfront-start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
