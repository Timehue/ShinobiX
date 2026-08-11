import { safeLogValue } from '../_safe-log.js';
import { randomInt, randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { runWarfrontMatch } from '../_pet-sim/pet-warfront-sim.js';
import { derivePetRole } from '../_pet-sim/pet-roles.js';
import { buildWarfrontAiTeam } from './_warfront-ai.js';
import type { Pet } from '../_pet-sim/pet-types.js';
import { petCombatBusyReason } from './_pet-busy.js';
import { activeCarriedPets } from '../_entitlements.js';
import { petArenaRyoRewardForTeam } from './_arena-reward.js';

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
type WfDoctrine = 'none' | 'vanguard' | 'bulwark' | 'zealot' | 'warden-pact';
type ArenaRole = 'defender' | 'tracker' | 'assassin' | 'sage';
interface ArenaSlot { pet: Pet; role: ArenaRole }
type WarfrontReceipt = {
    playerName?: string;
    reportKey?: string;
    seed?: number;
    mode?: string;
    playerPetIds?: string[];
    buyPolicy?: string;
    stance?: string;
    doctrine?: string;
};

const clampLevel = (n: number): number => Math.max(1, Math.min(100, Math.floor(Number.isFinite(n) ? n : 1)));
// Roles the client's way: the pet's own role, else derive it (id/name/element/rarity).
const autoRole = (pets: Pet[]): ArenaSlot[] => pets.map((pet) => ({ pet, role: (pet.role ?? derivePetRole(pet).role) as ArenaRole }));

export function chooseEligibleWarfrontPets(character: Record<string, unknown>, requestedIds: readonly string[]): Pet[] | null {
    const ids = [...new Set(requestedIds.filter(Boolean))];
    if (ids.length !== 4) return null;
    const eligible = activeCarriedPets<Pet>(character);
    const chosen = ids
        .map((id) => eligible.find((pet) => String(pet.id) === id))
        .filter((pet): pet is Pet => Boolean(pet));
    return chosen.length === 4 ? chosen : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const playerPetIds: string[] = Array.isArray(body.playerPetIds) ? body.playerPetIds.map((v: unknown) => String(v)).slice(0, 4) : [];
        const stanceRaw = String(body.stance ?? 'balanced');
        const stance: WfStance = (['balanced', 'siege', 'jungle', 'headhunt', 'turtle'].includes(stanceRaw) ? stanceRaw : 'balanced') as WfStance;
        const doctrineRaw = String(body.doctrine ?? 'none');
        const doctrine: WfDoctrine = (['vanguard', 'bulwark', 'zealot', 'warden-pact'].includes(doctrineRaw) ? doctrineRaw : 'none') as WfDoctrine;
        // "off" (interactive) is clamped to a deterministic policy — the reward path
        // must be reproducible; the player still gets offense/defense/balanced.
        const policyRaw = String(body.buyPolicy ?? 'balanced');
        const buyPolicy: WfBuyPolicy = (policyRaw === 'offense' || policyRaw === 'defense') ? policyRaw : 'balanced';

        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (!playerPetIds.length) return res.status(400).json({ error: 'No player pets supplied.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only start your own matches.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'warfront-start', 30, 60_000, identity.name))) return;

        const activeKey = `pet:battle-active:${playerName}`;
        const sameIds = (a: string[] | undefined, b: string[]) => JSON.stringify(a ?? []) === JSON.stringify(b);
        const matchesRequest = (active: WarfrontReceipt | null): boolean => Boolean(active
            && active.playerName === playerName
            && active.mode === 'warfront'
            && sameIds(active.playerPetIds, playerPetIds)
            && active.buyPolicy === buyPolicy
            && active.stance === stance
            && active.doctrine === doctrine);
        const readActive = async () => {
            const activeToken = await kv.get<string>(activeKey);
            const active = activeToken
                ? await kv.get<WarfrontReceipt>(`pet:battle-token:${playerName}:${activeToken}`)
                : null;
            return { activeToken, active };
        };

        // A lost start response replays the exact receipt instead of minting a
        // second random seed. battle-result releases this shared active key on
        // win, loss, or draw; both keys also expire after fifteen minutes.
        const outstanding = await readActive();
        if (outstanding.activeToken) {
            if (matchesRequest(outstanding.active) && outstanding.active?.reportKey && Number.isSafeInteger(outstanding.active.seed)) {
                return res.status(200).json({
                    ok: true,
                    token: outstanding.activeToken,
                    reportKey: outstanding.active.reportKey,
                    seed: outstanding.active.seed,
                    resumed: true,
                });
            }
            return res.status(409).json({ error: 'Finish or settle your active pet battle first.' });
        }

        // Server-owned identifiers are created before the lease claim; legacy
        // body.seed/reportKey values are deliberately ignored.
        const seed = randomInt(1, 0x7fffffff);
        const token = randomUUID().replace(/-/g, '');
        const reportKey = `pet:${token}`;

        let ownsActiveLease = false;
        try {
            try {
                ownsActiveLease = await kv.set(activeKey, token, { nx: true, ex: TOKEN_TTL_SECONDS }) === 'OK';
            } catch (claimError) {
                // A lost claim acknowledgement is success only when readback
                // proves this exact token owns the lifecycle boundary.
                if (await kv.get<string>(activeKey).catch(() => null) !== token) throw claimError;
                ownsActiveLease = true;
            }
            if (!ownsActiveLease) {
                const raced = await readActive();
                if (raced.activeToken && matchesRequest(raced.active) && raced.active?.reportKey && Number.isSafeInteger(raced.active.seed)) {
                    return res.status(200).json({
                        ok: true,
                        token: raced.activeToken,
                        reportKey: raced.active.reportKey,
                        seed: raced.active.seed,
                        resumed: true,
                    });
                }
                return res.status(409).json({ error: 'Finish or settle your active pet battle first.' });
            }

            // Read and freeze the real roster only after winning the same lease
            // used by lifecycle mutations. No training/equip/release write can
            // slip between this snapshot and its reward receipt.
            const mySave = await kv.get<Record<string, unknown>>(`save:${playerName}`);
            const myChar = mySave?.character as Record<string, unknown> | undefined;
            const bluePets = myChar ? chooseEligibleWarfrontPets(myChar, playerPetIds) : null;
            if (!bluePets) {
                return res.status(409).json({ error: 'Warfront needs 4 eligible pets. Base account: 3 carried. Shinobi Supporter: 5 carried.' });
            }
            if (bluePets.some((pet) => petCombatBusyReason(myChar ?? {}, pet as unknown as Record<string, unknown>))) {
                return res.status(409).json({ error: 'A selected pet is busy with breeding, training, or an expedition.' });
            }

            const redPets = buildWarfrontAiTeam(bluePets.length);
            const result = runWarfrontMatch(autoRole(bluePets), autoRole(redPets), seed, buyPolicy, 'balanced', undefined, { blue: stance }, { blue: doctrine });
            const authoritativeOutcome: 'win' | 'loss' | 'draw' = result.winner === 'blue' ? 'win' : result.winner === 'red' ? 'loss' : 'draw';
            const sealedOpponentLevel = clampLevel(redPets.reduce((s, p) => s + Number((p as { level?: unknown }).level ?? 1), 0) / Math.max(1, redPets.length));
            const sealedRewardRyo = petArenaRyoRewardForTeam(redPets);
            const receipt = {
                playerName,
                opponentLevel: sealedOpponentLevel,
                rewardRyo: sealedRewardRyo,
                reportKey,
                seed,
                mode: 'warfront',
                createdAt: Date.now(),
                playerPetIds: bluePets.map((pet) => String(pet.id)),
                buyPolicy,
                stance,
                doctrine,
                authoritativeOutcome,
            };
            const tokenKey = `pet:battle-token:${playerName}:${token}`;
            try {
                const written = await kv.set(tokenKey, receipt, { ex: TOKEN_TTL_SECONDS, nx: true });
                if (written !== 'OK') throw new Error('pet-warfront-receipt-write-rejected');
            } catch (writeError) {
                const stored = await kv.get<WarfrontReceipt>(tokenKey).catch(() => null);
                if (!stored || stored.reportKey !== reportKey || stored.seed !== seed || !matchesRequest(stored)) {
                    throw writeError;
                }
            }

            ownsActiveLease = false;
            return res.status(200).json({ ok: true, token, reportKey, seed });
        } finally {
            if (ownsActiveLease) await kv.delIfEqual(activeKey, token).catch(() => false);
        }
    } catch (err) {
        console.error('[pet/warfront-start]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
