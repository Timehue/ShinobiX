import { safeLogValue } from '../_safe-log.js';
import { randomInt, randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { runWarfrontMatch, WARFRONT_TPS } from '../_pet-sim/pet-warfront-sim.js';
import { derivePetRole } from '../_pet-sim/pet-roles.js';
import { buildWarfrontAiTeam } from './_warfront-ai.js';
import type { Pet } from '../_pet-sim/pet-types.js';
import { petCombatBusyReason } from './_pet-busy.js';
import { activeCarriedPets } from '../_entitlements.js';
import { petArenaRyoRewardForTeam } from './_arena-reward.js';
import { coordinateWarfrontStart } from './_warfront-start-coordinator.js';

/*
 * /api/pet/warfront-start — POST only.
 *
 * Mints the single-use reward token for a Hollow Warfront vs-AI match, the
 * SERVER-AUTHORITATIVE way: the server RE-RUNS the exact deterministic match the
 * browser is about to render (same player pets, canonical AI red team, server
 * seed, buy policy, stance) and seals the winner + reward into a `pet:battle-token`
 * — the SAME token shape battle-result.ts already redeems for 1v1/2v2. A client
 * can't fake a win; the server computed it independently.
 *
 * Determinism: the Warfront sim meets the cross-engine contract (no
 * sin/cos/atan2/hypot — see its header), and warfront-parity.test.ts proves the
 * server re-sim === the client render (streamed) === this full-auto run, so a
 * Firefox player's win reproduces here byte-for-byte. The minted seed is returned
 * to the renderer; one outstanding receipt plus a server settlement clock
 * prevents seed shopping. vs-AI reward matches LOCK the buy to a deterministic policy (never interactive
 * "off"), matching the PvP/co-op rule, so the match is a pure function of the
 * sealed inputs.
 */

// A full replay can run for ten minutes and background tabs are routinely
// suspended on mobile. Keep the single active proof for thirty minutes so a
// player retains at least a ten-minute post-play settlement margin.
const TOKEN_TTL_SECONDS = 30 * 60;
type WfBuyPolicy = 'balanced' | 'offense' | 'defense';
type WfStance = 'balanced' | 'siege' | 'jungle' | 'headhunt' | 'turtle';
type WfDoctrine = 'none' | 'vanguard' | 'bulwark' | 'zealot' | 'warden-pact';
type ArenaRole = 'defender' | 'tracker' | 'assassin' | 'sage';
interface ArenaSlot { pet: Pet; role: ArenaRole }
type StoredWarfrontSeal = {
    mode?: string;
    settlementPolicy?: 'warfront-reward';
    createdAt?: number;
    playerPetIds?: string[];
    seed?: number;
    reportKey?: string;
    authoritativeOutcome?: 'win' | 'loss' | 'draw';
    stance?: WfStance;
    doctrine?: WfDoctrine;
    buyPolicy?: WfBuyPolicy;
    opponentStance?: WfStance;
    opponentDoctrine?: WfDoctrine;
    bluePets?: Pet[];
    redPets?: Pet[];
    expiresAt?: number;
    matchDurationMs?: number;
    settleAfter?: number;
};
type ActiveWarfront = { token: string; seal: StoredWarfrontSeal };

const WF_STANCES: readonly WfStance[] = ['balanced', 'siege', 'jungle', 'headhunt', 'turtle'];
const WF_DOCTRINES: readonly WfDoctrine[] = ['none', 'vanguard', 'bulwark', 'zealot', 'warden-pact'];
const WF_BUY_POLICIES: readonly WfBuyPolicy[] = ['balanced', 'offense', 'defense'];

const WARFRONT_TEAM_SIZE = 4;
const AI_STANCE: WfStance = 'balanced';
const AI_DOCTRINE: WfDoctrine = 'vanguard';
// A scored Warfront lasts up to ten minutes. Do not let the result endpoint
// become an instant seed oracle: even a surrender/loss must spend a meaningful
// opening engagement before its receipt can be retired.
const WARFRONT_MIN_SETTLE_MS = 60_000;
const WARFRONT_SETTLE_CLOCK_SKEW_MS = 5_000;
// The route has a 30-second CPU ceiling. A two-minute lease leaves ample margin
// while allowing a crashed initializer to recover promptly. The provisional
// proof is CAS-retired at the same age; a late owner cannot publish because it
// verifies the active pointer immediately before sealing.
const WARFRONT_INIT_LEASE_SECONDS = 2 * 60;
const WARFRONT_INIT_PUBLISH_WAIT_MS = 12_000;
const WARFRONT_SETTLEMENT_RETRY_WINDOW_MS = 10 * 60_000;

class WarfrontStartBusyError extends Error {}

const clampLevel = (n: number): number => Math.max(1, Math.min(100, Math.floor(Number.isFinite(n) ? n : 1)));
// Roles the client's way: the pet's own role, else derive it (id/name/element/rarity).
const autoRole = (pets: Pet[]): ArenaSlot[] => pets.map((pet) => ({ pet, role: (pet.role ?? derivePetRole(pet).role) as ArenaRole }));

/** A bounded combat/presentation snapshot. Save-owned inline art and unrelated
 * care/breeding state can be multi-megabyte and never influence Warfront math. */
const warfrontPetSnapshot = (pet: Pet): Pet => ({
    id: String(pet.id).slice(0, 64),
    name: String(pet.name).slice(0, 80),
    rarity: pet.rarity,
    level: pet.level,
    xp: pet.xp,
    maxLevel: pet.maxLevel,
    hp: pet.hp,
    attack: pet.attack,
    defense: pet.defense,
    speed: pet.speed,
    jutsus: (Array.isArray(pet.jutsus) ? pet.jutsus : []).slice(0, 8)
        .map((jutsu) => ({ ...jutsu, name: String(jutsu.name).slice(0, 80) })),
    unlockedForPve: pet.unlockedForPve,
    ...(pet.nickname ? { nickname: String(pet.nickname).slice(0, 80) } : {}),
    ...(pet.element ? { element: pet.element } : {}),
    ...(pet.trait ? { trait: pet.trait } : {}),
    ...(pet.happiness !== undefined ? { happiness: pet.happiness } : {}),
    ...(pet.moveRange !== undefined ? { moveRange: pet.moveRange } : {}),
    ...(pet.loadout ? { loadout: { ...pet.loadout } } : {}),
    ...(pet.evolutionStage !== undefined ? { evolutionStage: pet.evolutionStage } : {}),
    ...(pet.role ? { role: pet.role } : {}),
    ...(pet.subRole ? { subRole: pet.subRole } : {}),
    ...(pet.templateId ? { templateId: String(pet.templateId).slice(0, 64) } : {}),
    ...(pet.origin ? { origin: pet.origin } : {}),
    ...(pet.paletteVariantId ? { paletteVariantId: String(pet.paletteVariantId).slice(0, 64) } : {}),
});

function isRecoverableWarfront(seal: StoredWarfrontSeal): boolean {
    const playerPetIds = seal.playerPetIds ?? [];
    return seal.mode === 'warfront'
        && playerPetIds.length === WARFRONT_TEAM_SIZE
        && new Set(playerPetIds).size === WARFRONT_TEAM_SIZE
        && WF_STANCES.includes(seal.stance as WfStance)
        && WF_DOCTRINES.includes(seal.doctrine as WfDoctrine)
        && WF_BUY_POLICIES.includes(seal.buyPolicy as WfBuyPolicy)
        && seal.opponentStance === AI_STANCE
        && seal.opponentDoctrine === AI_DOCTRINE
        && Array.isArray(seal.bluePets)
        && seal.bluePets.length === WARFRONT_TEAM_SIZE
        && seal.bluePets.every((pet) => Boolean(pet?.id) && Array.isArray(pet.jutsus))
        && JSON.stringify(seal.bluePets.map((pet) => String(pet.id))) === JSON.stringify(playerPetIds)
        && Array.isArray(seal.redPets)
        && seal.redPets.length === WARFRONT_TEAM_SIZE
        && seal.redPets.every((pet) => Boolean(pet?.id) && Array.isArray(pet.jutsus))
        && Number.isSafeInteger(seal.seed)
        && Number(seal.seed) > 0
        && seal.reportKey === `${seal.seed}:tactical`
        && (seal.authoritativeOutcome === 'win' || seal.authoritativeOutcome === 'loss' || seal.authoritativeOutcome === 'draw')
        && Number.isSafeInteger(seal.expiresAt)
        && Number.isSafeInteger(seal.matchDurationMs)
        && Number(seal.matchDurationMs) > 0
        && Number.isSafeInteger(seal.settleAfter)
        && Number(seal.settleAfter) < Number(seal.expiresAt);
}

function hasSafePlaybackWindow(seal: StoredWarfrontSeal, now = Date.now()): boolean {
    return Number(seal.expiresAt) - now
        >= Number(seal.matchDurationMs) + WARFRONT_SETTLEMENT_RETRY_WINDOW_MS;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const playerPetIds: string[] = Array.isArray(body.playerPetIds)
            ? [...new Set<string>(body.playerPetIds.map((v: unknown) => String(v).slice(0, 64)).filter(Boolean))].slice(0, WARFRONT_TEAM_SIZE)
            : [];
        const stanceRaw = String(body.stance ?? 'balanced');
        const stance: WfStance = (['balanced', 'siege', 'jungle', 'headhunt', 'turtle'].includes(stanceRaw) ? stanceRaw : 'balanced') as WfStance;
        const doctrineRaw = String(body.doctrine ?? 'none');
        const doctrine: WfDoctrine = (['vanguard', 'bulwark', 'zealot', 'warden-pact'].includes(doctrineRaw) ? doctrineRaw : 'none') as WfDoctrine;
        // "off" (interactive) is clamped to a deterministic policy — the reward path
        // must be reproducible; the player still gets offense/defense/balanced.
        const policyRaw = String(body.buyPolicy ?? 'balanced');
        const buyPolicy: WfBuyPolicy = (policyRaw === 'offense' || policyRaw === 'defense') ? policyRaw : 'balanced';
        const resumeOnly = body.resumeOnly === true;

        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only start your own matches.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'warfront-start', 30, 60_000, identity.name))) return;

        const activeKey = `pet:battle-active:${playerName}`;
        const readActiveWarfront = async (retryChangedPointer = true): Promise<ActiveWarfront | null> => {
            const activeToken = await kv.get<string>(activeKey);
            if (!activeToken) return null;
            const tokenKey = `pet:battle-token:${playerName}:${activeToken}`;
            const active = await kv.get<StoredWarfrontSeal>(tokenKey);
            if (!active) {
                // A pointer without a proof can never settle. Clear only the
                // observed value so a concurrently published replacement wins.
                if (await kv.delIfEqual(activeKey, activeToken)) return null;
                if (retryChangedPointer) return readActiveWarfront(false);
                throw new WarfrontStartBusyError('Another Pet Coliseum battle is being published.');
            }
            // The initialization coordinator owns waiting for a live provisional
            // seal. A crashed provisional is retired with CAS so it cannot block
            // this player for the ordinary battle-token lifetime.
            if (active.mode === 'warfront-initializing') {
                const staleAfter = Number(active.createdAt) + WARFRONT_INIT_LEASE_SECONDS * 1_000;
                if (Number.isSafeInteger(active.createdAt) && Date.now() < staleAfter) return null;
                if (await kv.delIfEqual(activeKey, activeToken)) {
                    await kv.del(tokenKey).catch(() => undefined);
                    return null;
                }
                if (retryChangedPointer) return readActiveWarfront(false);
                throw new WarfrontStartBusyError('Another Pet Coliseum battle is being published.');
            }
            return { token: activeToken, seal: active };
        };
        const rejectUnsafeReplay = (active: ActiveWarfront) => {
            const retryAfterSeconds = Math.max(1, Math.ceil((Number(active.seal.expiresAt) - Date.now()) / 1_000));
            res.setHeader('Retry-After', String(retryAfterSeconds));
            return res.status(409).json({
                error: 'The existing Warfront proof is too close to expiry for a safe full replay. Retry after it expires.',
                expiresAt: active.seal.expiresAt,
            });
        };
        const sendWarfront = (active: ActiveWarfront, resumed: boolean) => res.status(200).json({
            ok: true,
            token: active.token,
            reportKey: active.seal.reportKey,
            seed: active.seal.seed,
            stance: active.seal.stance,
            doctrine: active.seal.doctrine,
            buyPolicy: active.seal.buyPolicy,
            opponentStance: active.seal.opponentStance,
            opponentDoctrine: active.seal.opponentDoctrine,
            bluePets: active.seal.bluePets,
            redPets: active.seal.redPets,
            expiresAt: active.seal.expiresAt,
            matchDurationMs: active.seal.matchDurationMs,
            settleAfter: active.seal.settleAfter,
            safePlaybackForMs: Math.max(0, Number(active.seal.expiresAt) - Date.now()),
            ...(resumed ? { resumed: true } : {}),
        });

        // Recover an owned receipt before consulting today's save or request.
        // Reload defaults and later expedition/evolution state cannot strand an
        // already authoritative replay.
        const existing = await readActiveWarfront();
        if (existing) {
            if (!isRecoverableWarfront(existing.seal)) {
                return res.status(409).json({ error: 'Finish or settle your active Pet Coliseum battle first.' });
            }
            if (!hasSafePlaybackWindow(existing.seal)) return rejectUnsafeReplay(existing);
            return sendWarfront(existing, true);
        }

        // A read-only recovery probe must never mint a new seed. It lets the
        // client recover an existing receipt even when today's live roster no
        // longer satisfies the four-pet entry rule.
        if (resumeOnly) return res.status(204).end();

        if (playerPetIds.length !== WARFRONT_TEAM_SIZE) {
            return res.status(400).json({ error: `Hollow Warfront requires exactly ${WARFRONT_TEAM_SIZE} distinct pets.` });
        }

        // BLUE = the player's REAL pets (authoritative stats loaded from the save —
        // never client-supplied), in the picked order.
        const mySave = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const myChar = mySave?.character as Record<string, unknown> | undefined;
        const myPets = activeCarriedPets<Pet>(myChar ?? {});
        const bluePets = playerPetIds
            .map((id) => myPets.find((p) => String((p as { id?: unknown }).id ?? '') === id))
            .filter(Boolean) as Pet[];
        if (!bluePets.length || bluePets.length !== playerPetIds.length) {
            return res.status(409).json({ error: 'Every Warfront slot must name a distinct stored player pet.' });
        }
        if (bluePets.some((pet) => petCombatBusyReason(myChar ?? {}, pet as unknown as Record<string, unknown>))) {
            return res.status(409).json({ error: 'A selected pet is busy with breeding, training, or an expedition.' });
        }

        const coordinated = await coordinateWarfrontStart(
            kv,
            playerName,
            readActiveWarfront,
            async () => {
                // Reserve the ordinary active-battle authority BEFORE spending
                // CPU. This atomic NX gate is the cache-independent backstop:
                // even if a process cached an optimistic null read, it cannot
                // run a second full simulation for this player.
                const seed = randomInt(1, 2 ** 31);
                const reportKey = `${seed}:tactical`;
                const token = randomUUID().replace(/-/g, '');
                const tokenKey = `pet:battle-token:${playerName}:${token}`;
                const createdAt = Date.now();
                const expiresAt = createdAt + TOKEN_TTL_SECONDS * 1_000;
                const sealedBluePets = bluePets.map(warfrontPetSnapshot);
                const sealedRedPets = buildWarfrontAiTeam(WARFRONT_TEAM_SIZE).map(warfrontPetSnapshot);
                const provisionalSeal = {
                    playerName,
                    mode: 'warfront-initializing',
                    stance,
                    doctrine,
                    buyPolicy,
                    opponentStance: AI_STANCE,
                    opponentDoctrine: AI_DOCTRINE,
                    createdAt,
                    expiresAt,
                    playerPetIds,
                    bluePets: sealedBluePets,
                    redPets: sealedRedPets,
                } satisfies StoredWarfrontSeal & Record<string, unknown>;

                let activeClaimed = false;
                try {
                    // The provisional proof distinguishes a live initializer
                    // from a missing proof; readActiveWarfront CAS-retires it
                    // once the bounded initialization lease has elapsed.
                    await kv.set(tokenKey, provisionalSeal, { ex: TOKEN_TTL_SECONDS });
                    activeClaimed = (await kv.set(activeKey, token, {
                        nx: true,
                        ex: TOKEN_TTL_SECONDS,
                    })) === 'OK';
                    if (!activeClaimed) {
                        await kv.del(tokenKey).catch(() => undefined);
                        const raced = await readActiveWarfront();
                        if (raced) return raced;
                        throw new WarfrontStartBusyError('Another Pet Coliseum battle is being published.');
                    }

                    const result = runWarfrontMatch(
                        autoRole(JSON.parse(JSON.stringify(sealedBluePets)) as Pet[]),
                        autoRole(JSON.parse(JSON.stringify(sealedRedPets)) as Pet[]),
                        seed,
                        buyPolicy,
                        'balanced',
                        undefined,
                        { blue: stance, red: AI_STANCE },
                        { blue: doctrine, red: AI_DOCTRINE },
                    );
                    const authoritativeOutcome: 'win' | 'loss' | 'draw' = result.winner === 'blue' ? 'win' : result.winner === 'red' ? 'loss' : 'draw';
                    const matchDurationMs = Math.ceil((result.ticks / WARFRONT_TPS) * 1_000);
                    const settledAtBase = Date.now();
                    const settleAfter = settledAtBase + Math.max(
                        WARFRONT_MIN_SETTLE_MS,
                        matchDurationMs - WARFRONT_SETTLE_CLOCK_SKEW_MS,
                    );
                    const sealedOpponentLevel = clampLevel(sealedRedPets.reduce((sum, pet) => sum + Number((pet as { level?: unknown }).level ?? 1), 0) / Math.max(1, sealedRedPets.length));
                    const seal = {
                        playerName,
                        opponentLevel: sealedOpponentLevel,
                        rewardRyo: petArenaRyoRewardForTeam(sealedRedPets),
                        reportKey,
                        seed,
                        mode: 'warfront',
                        settlementPolicy: 'warfront-reward',
                        stance,
                        doctrine,
                        buyPolicy,
                        opponentStance: AI_STANCE,
                        opponentDoctrine: AI_DOCTRINE,
                        createdAt,
                        expiresAt,
                        matchDurationMs,
                        settleAfter,
                        playerPetIds,
                        bluePets: sealedBluePets,
                        redPets: sealedRedPets,
                        authoritativeOutcome,
                    } satisfies StoredWarfrontSeal & Record<string, unknown>;

                    // A lease should make this invariant routine; checking it
                    // before final publication also prevents a process stalled
                    // beyond the TTL from returning an orphaned proof.
                    if (await kv.get<string>(activeKey) !== token) {
                        throw new WarfrontStartBusyError('Warfront initialization authority expired before publication.');
                    }
                    const remainingTtlSeconds = Math.max(1, Math.floor((expiresAt - Date.now()) / 1_000));
                    await kv.set(tokenKey, seal, { ex: remainingTtlSeconds });
                    return { token, seal };
                } catch (error) {
                    if (activeClaimed) {
                        await kv.delIfEqual(activeKey, token).catch(() => undefined);
                    }
                    await kv.del(tokenKey).catch(() => undefined);
                    throw error;
                }
            },
            {
                leaseTtlSeconds: WARFRONT_INIT_LEASE_SECONDS,
                waitForPublishedMs: WARFRONT_INIT_PUBLISH_WAIT_MS,
            },
        );

        if (coordinated.status === 'busy') {
            res.setHeader('Retry-After', '1');
            return res.status(409).json({ error: 'This Warfront seal is still being initialized. Retry in a moment.' });
        }
        if (!isRecoverableWarfront(coordinated.value.seal)) {
            return res.status(409).json({ error: 'Finish or settle your active Pet Coliseum battle first.' });
        }
        if (!hasSafePlaybackWindow(coordinated.value.seal)) {
            return rejectUnsafeReplay(coordinated.value);
        }
        return sendWarfront(coordinated.value, coordinated.status === 'resumed');
    } catch (err) {
        if (err instanceof WarfrontStartBusyError) {
            res.setHeader('Retry-After', '1');
            return res.status(409).json({ error: err.message });
        }
        console.error('[pet/warfront-start]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
