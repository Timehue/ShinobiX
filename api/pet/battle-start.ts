import { safeLogValue } from '../_safe-log.js';
import { randomInt, randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { runPetDuel, runPetPartyDuel } from '../_pet-sim/pet-duel-sim.js';
import { replayCasualPetDuel } from './_duel-replay.js';
import type { SealedDuelParams } from './_duel-replay.js';
import type { Pet } from '../_pet-sim/pet-types.js';
import { SERVER_ARENA_PETS } from './_arena-ai.js';
import { petArenaRyoRewardForTeam } from './_arena-reward.js';
import { masteryBonus, masteryHasCapstone } from '../_profession-mastery.js';
import { petCombatBusyReason } from './_pet-busy.js';
import { activeCarriedPets } from '../_entitlements.js';
import { hollowGateRunKey, type HollowGateRunToken } from '../hollow-gate/_run-token.js';
import {
    hollowGateCombatBindingKey,
    validateHollowGatePetClaim,
    type HollowGateCombatBinding,
} from '../hollow-gate/_combat-session.js';
import {
    hollowGateHoundName,
    isHollowHoundEncounterId,
    type HollowGateHoundKind,
} from '../../shared/hollow-gate-contract.js';
import { createCasualPveBattleSeal, type CasualPveBattleSeal } from './_casual-pve-seal.js';
import { resolveDungeonPetAuthority } from '../dungeon/_encounter-proof.js';
import {
    DUNGEON_PET_BATTLE_AUTHORITY_VERSION,
    buildDungeonRareBeast,
    dungeonPetResultKey,
    parseDungeonPetBattleBinding,
    parseDungeonPetResultReceipt,
    type DungeonPetBattleBinding,
} from './_dungeon-battle.js';

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

/** The Hollow Hound the SERVER builds for a Hollow Gate pet encounter, scaled
 *  off the player's own pet. Exported so the Showdown arena entry fields the
 *  identical opponent — one definition, so the two paths cannot drift. */
export function buildServerHollowHound(activePet: Pet, floorRaw: unknown, requestedId: string, kind: HollowGateHoundKind): Pet {
    const floor = Math.max(1, Math.min(5, Math.floor(Number(floorRaw) || 1)));
    const difficulty = Math.min(1.06, 0.90 + Math.max(0, floor - 1) * 0.04);
    return {
        id: requestedId,
        name: hollowGateHoundName(floor, kind),
        rarity: activePet.rarity,
        element: 'Earth',
        level: Math.max(1, Math.floor(Number(activePet.level) || 1)),
        xp: 0,
        maxLevel: 100,
        hp: Math.max(1, Math.floor(Number(activePet.hp) * difficulty)),
        attack: Math.max(1, Math.floor(Number(activePet.attack) * difficulty)),
        defense: Math.max(1, Math.floor(Number(activePet.defense) * difficulty)),
        speed: Math.max(1, Math.floor(Number(activePet.speed) * difficulty)),
        unlockedForPve: false,
        jutsus: [
            { name: 'Oni Rage Howl', power: 28, cooldown: 3, currentCooldown: 0, kind: 'buff' },
            { name: 'Abyss Bite', power: 210, cooldown: 2, currentCooldown: 0, kind: 'damage' },
            { name: 'Hellhound Execution', power: 310, cooldown: 4, currentCooldown: 0, kind: 'damage' },
            { name: 'Hellfire Corruption', power: 120, cooldown: 5, currentCooldown: 0, kind: 'dot' },
            { name: 'Demon Surge', power: 0, cooldown: 3, currentCooldown: 0, kind: 'move' },
        ],
    } as Pet;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const opponentName = typeof body.opponentName === 'string' ? safeName(body.opponentName) : '';
        const mode = body.mode === '2v2' ? '2v2' : '1v1';
        const playerPetIds: string[] = Array.isArray(body.playerPetIds) ? body.playerPetIds.map((value: unknown) => String(value)).slice(0, 2) : [];
        let opponentPetIds: string[] = Array.isArray(body.opponentPetIds) ? body.opponentPetIds.map((value: unknown) => String(value)).slice(0, 2) : [];
        // The battle receipt owns both identifiers. A caller cannot search for a
        // favourable deterministic seed and then ask the server to certify it.
        const token = randomUUID().replace(/-/g, '');
        const reportKey = `pet:${token}`;

        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only start your own pet battles.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'pet-battle-start', 30, 60_000, identity.name))) return;
        const seed = identity.admin && Number.isSafeInteger(Number(body.seed))
            ? Number(body.seed)
            : randomInt(1, 0x7fffffff);

        const mySave = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const myChar = mySave?.character as Record<string, unknown> | undefined;
        const myPets = activeCarriedPets<Record<string, unknown>>(myChar ?? {});
        const playerPets = playerPetIds.map((id) => myPets.find((pet) => String(pet?.id ?? '') === id)).filter(Boolean) as unknown as Pet[];
        const expectedTeamSize = mode === '2v2' ? 2 : 1;
        if (playerPets.length !== expectedTeamSize || new Set(playerPets.map((pet) => String(pet.id))).size !== expectedTeamSize) {
            return res.status(409).json({ error: `A complete stored ${mode} player team is required.` });
        }
        if (playerPets.some((pet) => petCombatBusyReason(myChar ?? {}, pet as unknown as Record<string, unknown>))) {
            return res.status(409).json({ error: 'A selected pet is busy with breeding, training, or an expedition.' });
        }
        let opponentPets: Pet[] = [];
        let isAiOpponent = false;
        let hollowGate: { runId: string } | null = null;
        let dungeon: DungeonPetBattleBinding | null = null;
        let realOpponentLevel: number | null = null;
        const hollowGateBody = body.hollowGate && typeof body.hollowGate === 'object'
            ? body.hollowGate as Record<string, unknown>
            : null;
        const dungeonBody = body.dungeon && typeof body.dungeon === 'object'
            ? body.dungeon as Record<string, unknown>
            : null;
        if (hollowGateBody && dungeonBody) {
            return res.status(400).json({ error: 'A pet battle cannot carry both Dungeon and Hollow Gate authority.' });
        }
        if (dungeonBody) {
            if (mode !== '1v1' || playerPets.length !== 1) {
                return res.status(400).json({ error: 'The Dungeon Rare Beast seal requires one carried pet.' });
            }
            try {
                const authority = resolveDungeonPetAuthority({
                    character: myChar ?? {},
                    dungeonRunToken: dungeonBody.token,
                });
                dungeon = {
                    authorityVersion: DUNGEON_PET_BATTLE_AUTHORITY_VERSION,
                    runToken: authority.dungeonRunToken,
                };
            } catch (error) {
                return res.status(409).json({
                    error: error instanceof Error ? error.message : 'Dungeon Rare Beast authority is unavailable.',
                });
            }
            opponentPets = [buildDungeonRareBeast()];
            opponentPetIds = opponentPets.map((pet) => pet.id);
            isAiOpponent = true;
        } else if (hollowGateBody) {
            const runId = String(hollowGateBody.runId ?? '').slice(0, 96);
            const runToken = String(hollowGateBody.token ?? '').slice(0, 64);
            const requestedHoundId = opponentPetIds[0] ?? '';
            if (!runId || !runToken || mode !== '1v1' || playerPets.length !== 1 || !isHollowHoundEncounterId(requestedHoundId)) {
                return res.status(400).json({ error: 'Invalid Hollow Gate pet encounter.' });
            }
            const [binding, run] = await Promise.all([
                kv.get<HollowGateCombatBinding>(hollowGateCombatBindingKey(runId)),
                kv.get<HollowGateRunToken>(hollowGateRunKey(playerName, runToken)),
            ]);
            const validation = validateHollowGatePetClaim({
                binding,
                activeEncounter: run?.activeEncounter,
                playerName,
                token: runToken,
            });
            if (!validation.ok) {
                return res.status(409).json({ error: `Hollow Gate pet encounter rejected: ${validation.reason}.` });
            }
            if (binding?.runId !== runId) return res.status(409).json({ error: 'Hollow Gate pet encounter binding drifted.' });
            opponentPets = [buildServerHollowHound(playerPets[0], binding.floor, requestedHoundId, binding.kind)];
            isAiOpponent = true;
            hollowGate = { runId };
        } else if (opponentName) {
            const oppSave = await kv.get<Record<string, unknown>>(`save:${opponentName}`);
            const oppChar = oppSave?.character as Record<string, unknown> | undefined;
            const stored = activeCarriedPets<Record<string, unknown>>(oppChar ?? {});
            opponentPets = opponentPetIds.map((id) => stored.find((pet) => String(pet?.id ?? '') === id)).filter(Boolean) as unknown as Pet[];
            if (opponentPets.some((pet) => petCombatBusyReason(oppChar ?? {}, pet as unknown as Record<string, unknown>))) {
                return res.status(409).json({ error: 'The selected opponent pet is currently unavailable.' });
            }
            if (opponentPets.length && oppChar) realOpponentLevel = clampLevel(Number(oppChar.level ?? 1));
        }
        if (!opponentPets.length) { opponentPets = opponentPetIds.map((id) => SERVER_ARENA_PETS[id]).filter(Boolean); isAiOpponent = opponentPets.length > 0; }
        if (opponentPets.length !== expectedTeamSize || new Set(opponentPets.map((pet) => String(pet.id))).size !== expectedTeamSize) {
            return res.status(409).json({ error: `A complete server-known ${mode} opponent team is required.` });
        }

        // Reward magnitude is SEALED here from the opponent actually fought — a
        // real opponent's live save level, or the AI pet's own level — never
        // body.opponentLevel. battle-result pays `level*2` ryo from this sealed
        // value, so a client can't beat a trivial level-8 AI and then report a
        // real level-100 name to be paid as though it beat the level-100 player.
        const sealedOpponentLevel = realOpponentLevel != null
            ? realOpponentLevel
            : clampLevel(Math.max(1, ...opponentPets.map((p) => Number((p as { level?: unknown }).level ?? 1))));
        const sealedRewardRyo = dungeon ? 0 : petArenaRyoRewardForTeam(opponentPets);
        const rank = Math.max(0, Math.min(10, Number(myChar?.professionRank) || 0));
        const damageMult = isAiOpponent && myChar?.profession === 'petTamer' ? 1 + (5 + rank * 1.5 + masteryBonus(myChar.profession, myChar.masterySpec, 'petPveDamagePct')) / 100 : 1;
        const hpMult = isAiOpponent ? 1 + masteryBonus(myChar?.profession, myChar?.masterySpec, 'petPveHpPct') / 100 : 1;
        const revive = isAiOpponent && masteryHasCapstone(myChar?.profession, myChar?.masterySpec, 'alpha-bond');
        // A PvE fight is the only one the player can COMMAND — PetArena gates
        // player control on a built-in AI opponent, because a casual-vs-player or
        // clan-war duel must stay precomputed so both clients derive the same
        // fight. So it is also the only one whose reward can come from replaying
        // the player's inputs. Seal everything that replay needs; the client
        // restates none of it when it reports the result.
        const sealedParams: SealedDuelParams | null = isAiOpponent ? {
            mode,
            seed,
            damageMult,
            hpMult,
            revive,
            // Must match the client's controlled-duel construction exactly: items
            // ON, and accuracy PINNED rather than read from the per-device
            // petAccuracy.v1 flag (CONTROLLED_DUEL_ACCURACY in pet-duel-live.ts).
            // Either one disagreeing resolves a different fight.
            applyItems: true,
            accuracy: true,
            terrain: null,
        } : null;
        const casualPveSeal = sealedParams
            ? createCasualPveBattleSeal(playerPets, opponentPets, sealedParams)
            : null;

        // Baseline outcome, used when the report carries no input log — the flag
        // is off, an older client, or the player just watched. For a PvE fight
        // this now runs the CINEMATIC engine the coliseum actually renders (an
        // empty log reproduces the uncommanded AI fight exactly), so the sealed
        // value finally agrees with the fight on screen instead of coming from
        // the retired pet-duel-sim engine. Non-PvE casual duels are untouched.
        const result = casualPveSeal
            ? replayCasualPetDuel(casualPveSeal.playerPets, casualPveSeal.opponentPets, casualPveSeal.params, []).outcome
            : mode === '2v2'
                ? runPetPartyDuel(playerPets[0], playerPets[1] ?? null, opponentPets[0], opponentPets[1] ?? null, seed, damageMult, hpMult, revive, false, false, true).result
                : runPetDuel(playerPets[0], opponentPets[0], seed, damageMult, hpMult, revive, false, false, null, true).result;

        const tokenKey = `pet:battle-token:${playerName}:${token}`;
        const tokenData = {
            playerName,
            opponentName: opponentName || undefined,
            opponentLevel: sealedOpponentLevel,
            rewardRyo: sealedRewardRyo,
            reportKey,
            seed,
            mode,
            createdAt: Date.now(),
            playerPetIds,
            // Needed to rebuild the same opponent at report time. AI pets come
            // from the server's own roster, so these ids are not player input in
            // any meaningful sense — but they are re-resolved, never trusted.
            opponentPetIds,
            ...(hollowGate ? { sealedOpponentPets: opponentPets, hollowGate } : {}),
            ...(dungeon ? { dungeon } : {}),
            sealedParams,
            ...(casualPveSeal ? { casualPveSeal } : {}),
            authoritativeOutcome: result,
        };

        // Publish the complete seal before its global pointer. A process crash
        // can therefore leave only an unreachable expiring seal, never a live
        // pointer whose missing proof blocks every pet mode for the full TTL.
        await kv.set(tokenKey, tokenData, { ex: TOKEN_TTL_SECONDS });

        // One outstanding receipt per player closes seed-shopping: a client must
        // settle (including a loss/draw) before it can mint another random seed.
        const activeKey = `pet:battle-active:${playerName}`;
        let claimed: unknown;
        try {
            claimed = await kv.set(activeKey, token, { nx: true, ex: TOKEN_TTL_SECONDS });
        } catch (claimError) {
            await kv.del(tokenKey).catch(() => undefined);
            throw claimError;
        }
        if (!claimed) {
            // Heal the old pointer-first crash shape. CAS deletion cannot evict a
            // concurrently replaced winner; after cleanup this request gets one
            // chance to publish its already-complete seal.
            const orphanToken = await kv.get<string>(activeKey);
            if (orphanToken && !await kv.get(`pet:battle-token:${playerName}:${orphanToken}`)) {
                await kv.delIfEqual(activeKey, orphanToken);
                claimed = await kv.set(activeKey, token, { nx: true, ex: TOKEN_TTL_SECONDS });
            }
        }
        if (!claimed) {
            // A refresh may lose the in-memory receipt. Return the SAME seal only
            // when it describes the exact requested matchup; never mint a new
            // seed and never attach the old token to different pets.
            let activeToken = await kv.get<string>(activeKey);
            let active = activeToken ? await kv.get<{
                reportKey?: string; seed?: number; mode?: string;
                playerPetIds?: string[]; opponentPetIds?: string[];
                casualPveSeal?: CasualPveBattleSeal;
                hollowGate?: { runId?: string };
                dungeon?: DungeonPetBattleBinding;
            }>(`pet:battle-token:${playerName}:${activeToken}`) : null;
            const sameIds = (a: string[] | undefined, b: string[]) => JSON.stringify(a ?? []) === JSON.stringify(b);
            let activeDungeon = parseDungeonPetBattleBinding(active?.dungeon);

            // A hard crash may occur after Dungeon proof + durable result commit
            // but before either short-lived key is retired. That completed seal
            // must not block a later ordinary/Hollow/Dungeon admission. Only an
            // exact server receipt can retire it, and CAS protects a newer lease.
            const completedDungeon = activeToken && activeDungeon
                ? parseDungeonPetResultReceipt(await kv.get(dungeonPetResultKey(playerName, activeToken)))
                : null;
            if (activeToken && active && activeDungeon && completedDungeon
                && completedDungeon.playerName.toLowerCase() === playerName.toLowerCase()
                && completedDungeon.battleToken === activeToken
                && completedDungeon.runToken === activeDungeon.runToken
                && sameIds(completedDungeon.playerPetIds, active.playerPetIds ?? [])) {
                await kv.del(`pet:battle-token:${playerName}:${activeToken}`).catch(() => undefined);
                await kv.delIfEqual(activeKey, activeToken);
                claimed = await kv.set(activeKey, token, { nx: true, ex: TOKEN_TTL_SECONDS });
                if (!claimed) {
                    activeToken = await kv.get<string>(activeKey);
                    active = activeToken
                        ? await kv.get<NonNullable<typeof active>>(`pet:battle-token:${playerName}:${activeToken}`)
                        : null;
                    activeDungeon = parseDungeonPetBattleBinding(active?.dungeon);
                }
            }
            if (claimed) {
                return res.status(200).json({
                    ok: true,
                    token,
                    reportKey,
                    seed,
                    ...(dungeon ? { dungeon: true } : {}),
                    ...(casualPveSeal
                        ? {
                            playerPets: casualPveSeal.playerPets,
                            opponentPets: casualPveSeal.opponentPets,
                            battleConfig: casualPveSeal.params,
                        }
                        : {}),
                });
            }
            const sameAuthority = dungeon
                ? activeDungeon?.runToken === dungeon.runToken && !active?.hollowGate?.runId
                : hollowGate
                    ? !activeDungeon && active?.hollowGate?.runId === hollowGate.runId
                    : !activeDungeon && !active?.hollowGate?.runId;
            if (activeToken && active?.reportKey && Number.isSafeInteger(active.seed)
                && active.mode === mode
                && sameAuthority
                && sameIds(active.playerPetIds, playerPetIds)
                && sameIds(active.opponentPetIds, opponentPetIds)) {
                await kv.del(tokenKey).catch(() => undefined);
                return res.status(200).json({
                    ok: true,
                    token: activeToken,
                    reportKey: active.reportKey,
                    seed: active.seed,
                    resumed: true,
                    ...(dungeon ? { dungeon: true } : {}),
                    ...(active.casualPveSeal
                        ? {
                            playerPets: active.casualPveSeal.playerPets,
                            opponentPets: active.casualPveSeal.opponentPets,
                            battleConfig: active.casualPveSeal.params,
                        }
                        : {}),
                });
            }
            await kv.del(tokenKey).catch(() => undefined);
            return res.status(409).json({ error: 'Finish or settle your active Pet Coliseum battle first.' });
        }

        return res.status(200).json({
            ok: true,
            token,
            reportKey,
            seed,
            ...(dungeon ? { dungeon: true } : {}),
            ...(casualPveSeal
                ? {
                    playerPets: casualPveSeal.playerPets,
                    opponentPets: casualPveSeal.opponentPets,
                    battleConfig: casualPveSeal.params,
                }
                : {}),
        });
    } catch (err) {
        console.error('[pet/battle-start]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
