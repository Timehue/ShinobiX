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
    HOLLOW_GATE_PET_RESULT_TTL_SECONDS,
    claimHollowGateCinematicAuthority,
    validateHollowGateCinematicPublication,
} from '../hollow-gate/_pet-authority.js';
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
// The sector wanderer runs as its own sealed session rather than through the
// generic opponent flow: it owns a durable use-cooldown proof, the sector move,
// and a resume that re-serves the first verdict. `_wanderer-duel.ts`'s inline
// `buildWandererBeast` is the simpler shape this supersedes — see the early
// return in the handler.
import { startNaturalWandererPetSession } from './_wanderer-session.js';
import { loadPvpPetDuel, pvpPetDuelOutcomeFor, pvpSettlementSnapshot, resolvePvpPetDuel } from './_pvp-duel.js';

/*
 * /api/pet/battle-start - POST only
 *
 * Mints a short-lived single-use token for contextual pet combat. New ordinary
 * player challenges are social sparring and seal no paid Coliseum progression;
 * Dungeon/Hollow Gate remain parent-owned, and Warfront uses its own kickoff.
 * Pre-cutover AI receipts can still be resumed and redeemed, but this endpoint
 * no longer admits a new pick-your-opponent Coliseum fight.
 */

const TOKEN_TTL_SECONDS = 15 * 60;

const clampLevel = (n: number): number => Math.max(1, Math.min(100, Math.floor(Number.isFinite(n) ? n : 1)));
const sameOrderedIds = (a: string[] | undefined, b: string[]): boolean => JSON.stringify(a ?? []) === JSON.stringify(b);

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
        // A player-challenge duel takes its shape from the fight sealed when the
        // responder accepted, never from the caller: format, teams, seed and
        // verdict were all fixed there, for both participants at once.
        const pvpChallengeId = typeof body.pvpChallengeId === 'string'
            ? body.pvpChallengeId.trim().slice(0, 80)
            : '';
        const bodyMode = body.mode === '2v2' ? '2v2' : '1v1';
        // (Nothing parses `body.wanderer` here. A sector wanderer duel is claimed
        // by the sealed wanderer session a few lines below, which validates the
        // encounter id AND the sector against the caller's own save before it
        // resolves anything.)
        const requestedPlayerPetIds: string[] = Array.isArray(body.playerPetIds) ? body.playerPetIds.map((value: unknown) => String(value)).slice(0, 2) : [];
        // `let`, not `const`: the Dungeon Rare Beast branch below replaces these
        // with the ids of the beast the SERVER built, so the token seals what was
        // actually fought rather than what the caller named.
        let opponentPetIds: string[] = Array.isArray(body.opponentPetIds) ? body.opponentPetIds.map((value: unknown) => String(value)).slice(0, 2) : [];
        // The battle receipt owns both identifiers. A caller cannot search for a
        // favourable deterministic seed and then ask the server to certify it.
        let token = randomUUID().replace(/-/g, '');
        let reportKey = `pet:${token}`;

        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only start your own pet battles.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'pet-battle-start', 30, 60_000, identity.name))) return;
        // Natural sector pet wanderers are a distinct server-owned journey.
        // Isolate it before any generic opponent/HG/Dungeon branch can infer a
        // different authority from overlapping request fields.
        //
        // This returns before any generic opponent handling below ever runs, and
        // deliberately so. A simpler inline version of this duel is possible —
        // pick a template by the caller's level, scale it, resolve one bout — but
        // it stamps none of the durable state a wanderer owes the world: the
        // per-encounter use cooldown, the sector move, the save-version echo, and
        // a resume that re-serves the FIRST verdict instead of restaging the
        // fight. See api/pet/wanderer-authority.test.ts for the whole contract.
        if (body.wanderer !== undefined) {
            const started = await startNaturalWandererPetSession(playerName, body as Record<string, unknown>);
            if (!started.ok) return res.status(started.status).json({ error: started.error });
            const { session } = started;
            return res.status(200).json({
                ok: true,
                token: session.token,
                reportKey: session.reportKey,
                seed: session.seed,
                resumed: started.resumed,
                playerPets: session.playerPets,
                opponentPets: session.opponentPets,
                showdownScript: session.showdownScript,
                outcome: session.outcome,
                wanderer: session.wanderer,
                cooldownUntil: session.cooldownUntil,
                moveToSector: session.moveToSector,
                character: started.character,
                _saveVersion: started._saveVersion,
            });
        }
        /*
         * THE SEALED PLAYER DUEL, if this is one.
         *
         * Both participants call this endpoint for their own reward token, and
         * each used to be handed its own `randomInt` seed and its own sealed
         * outcome — two unrelated fights for one challenge, either of which
         * could name its caller the winner. The duel is now sealed once against
         * the challenge (api/pet/_pvp-duel.ts), so both calls read the same
         * teams, the same seed and the same verdict, and the script returned
         * below is the fight both of them watch.
         */
        const pvpDuel = pvpChallengeId ? await loadPvpPetDuel(pvpChallengeId) : null;
        if (pvpChallengeId && !pvpDuel) {
            return res.status(409).json({ error: 'That pet challenge has no sealed duel. It may have expired.' });
        }
        const pvpResolution = pvpDuel ? resolvePvpPetDuel(pvpDuel) : null;
        const pvpOutcome = pvpDuel && pvpResolution
            ? pvpPetDuelOutcomeFor(pvpDuel, playerName, pvpResolution.winnerName)
            : null;
        if (pvpDuel && !pvpOutcome) {
            return res.status(403).json({ error: 'That pet duel does not name you.' });
        }
        const mode = pvpDuel ? pvpDuel.format : bodyMode;
        // `let`: the Hollow Gate publish-before-pointer branch below adopts an
        // already-published seal's seed rather than overwriting it with a freshly
        // rolled one, which is what stops outcome shopping on a retry.
        let seed = pvpDuel
            ? pvpDuel.seed
            : identity.admin && Number.isSafeInteger(Number(body.seed))
                ? Number(body.seed)
                : randomInt(1, 0x7fffffff);
        // The caller's own side of the sealed duel — the pets it agreed to
        // field, not the ones it asks to field now.
        const pvpSelfIsA = pvpDuel ? pvpDuel.a.toLowerCase() === playerName.toLowerCase() : false;
        const pvpSelfPets = pvpDuel ? (pvpSelfIsA ? pvpDuel.aPets : pvpDuel.bPets) : null;
        const pvpFoePets = pvpDuel ? (pvpSelfIsA ? pvpDuel.bPets : pvpDuel.aPets) : null;
        const pvpFoeName = pvpDuel ? (pvpSelfIsA ? pvpDuel.b : pvpDuel.a) : '';
        const playerPetIds = pvpSelfPets ? pvpSelfPets.map((pet) => String(pet.id)) : requestedPlayerPetIds;

        const mySave = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const myChar = mySave?.character as Record<string, unknown> | undefined;
        const myPets = activeCarriedPets<Record<string, unknown>>(myChar ?? {});
        const playerPets = pvpSelfPets
            ? pvpSelfPets
            : playerPetIds.map((id) => myPets.find((pet) => String(pet?.id ?? '') === id)).filter(Boolean) as unknown as Pet[];
        const expectedTeamSize = mode === '2v2' ? 2 : 1;
        if (playerPets.length !== expectedTeamSize || new Set(playerPets.map((pet) => String(pet.id))).size !== expectedTeamSize) {
            return res.status(409).json({ error: `A complete stored ${mode} player team is required.` });
        }
        // A sealed player duel skips this: eligibility was checked for BOTH
        // sides when the responder accepted, and the fight was decided in the
        // same breath. Refusing the token now would not un-fight it — it would
        // only strand one participant with a result they cannot settle while
        // their opponent settles normally.
        if (!pvpDuel && playerPets.some((pet) => petCombatBusyReason(myChar ?? {}, pet as unknown as Record<string, unknown>))) {
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
        // A sealed player duel is checked FIRST: its teams were fixed at accept,
        // so it must not be re-derived from a parent-mode body the caller also
        // happened to send.
        if (pvpFoePets) {
            // Sealed at accept from the opponent's own save. Not re-read here:
            // the fight this token settles was decided against these exact
            // pets, so a later roster edit must not change what was fought.
            opponentPets = pvpFoePets;
            const foeSave = await kv.get<Record<string, unknown>>(`save:${pvpFoeName.toLowerCase()}`);
            const foeChar = foeSave?.character as Record<string, unknown> | undefined;
            if (foeChar) realOpponentLevel = clampLevel(Number(foeChar.level ?? 1));
        } else if (dungeonBody) {
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
            // The parent encounter chooses exactly one child proof. New parents
            // arrive pre-bound to the mounted cinematic engine; the claim path
            // only migrates a pre-cutover parent that had no child identity.
            let proofId = binding.petAuthority?.proofId;
            if (!proofId) {
                // Pre-cutover recovery is permitted only when the global
                // single-flight pointer already names one live cinematic seal
                // for this exact parent. With no such server-owned identity,
                // choosing a fresh request token here would let the caller pick
                // which legacy child/outcome becomes authoritative.
                const legacyActiveToken = await kv.get<string>(`pet:battle-active:${playerName}`);
                const legacyActive = legacyActiveToken
                    ? await kv.get<{ playerName?: string; hollowGate?: { runId?: string } }>(`pet:battle-token:${playerName}:${legacyActiveToken}`)
                    : null;
                if (!legacyActiveToken
                    || legacyActive?.playerName?.toLowerCase() !== playerName.toLowerCase()
                    || legacyActive.hollowGate?.runId !== runId) {
                    return res.status(409).json({ error: 'This legacy Hollow Gate pet encounter has no unique retained cinematic proof.' });
                }
                proofId = legacyActiveToken;
            }
            const authority = await claimHollowGateCinematicAuthority({
                runId,
                playerName,
                proofId,
            });
            if (!authority.ok) {
                return res.status(409).json({ error: 'This Hollow Gate encounter is already bound to another pet battle.' });
            }
            token = authority.binding.petAuthority!.proofId;
            reportKey = `pet:${token}`;
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
        if (!opponentPets.length && opponentPetIds.some((id) => Boolean(SERVER_ARENA_PETS[id]))) {
            // Recovery only: an older client may have lost the response carrying
            // an already-issued cinematic AI receipt. Return that exact immutable
            // proof when it still owns the active pointer, but never mint a new
            // user-picked paid Coliseum battle. New paid admission belongs to
            // Showdown's `arena` action.
            const activeToken = await kv.get<string>(`pet:battle-active:${playerName}`);
            const active = activeToken ? await kv.get<{
                playerName?: string; opponentName?: string; reportKey?: string; seed?: number; mode?: string;
                playerPetIds?: string[]; opponentPetIds?: string[]; settlementPolicy?: unknown;
                casualPveSeal?: CasualPveBattleSeal;
            }>(`pet:battle-token:${playerName}:${activeToken}`) : null;
            if (activeToken
                && active
                && active.settlementPolicy === undefined
                && active.playerName?.toLowerCase() === playerName.toLowerCase()
                && active.mode === mode
                && typeof active.reportKey === 'string'
                && Number.isSafeInteger(active.seed)
                && sameOrderedIds(active.playerPetIds, playerPetIds)
                && sameOrderedIds(active.opponentPetIds, opponentPetIds)
                && active.casualPveSeal) {
                return res.status(200).json({
                    ok: true,
                    token: activeToken,
                    reportKey: active.reportKey,
                    seed: active.seed,
                    resumed: true,
                    playerPets: active.casualPveSeal.playerPets,
                    opponentPets: active.casualPveSeal.opponentPets,
                    battleConfig: active.casualPveSeal.params,
                });
            }
            return res.status(410).json({
                error: 'The pick-your-opponent Pet Colosseum is retired. Enter the paid Showdown arena instead.',
            });
        }
        // No generic `opponentPets = opponentPetIds.map(SERVER_ARENA_PETS)` fallback
        // follows. Resolving a caller-named roster id into a live opponent is
        // exactly the pick-your-opponent admission the 410 above retires, and the
        // recovery branch there already covers the one case that still needs it:
        // redeeming a receipt minted before the cutover. New paid admission goes
        // through Showdown's `arena` action, which derives the tier itself.
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
        //
        // A wanderer duel is excluded: it resolves on Showdown below, so there is
        // no local fight to replay and nothing for these params to describe.
        //
        // With the wanderer ported, NOTHING IN THE APP produces a casualPveSeal
        // any more — the sealed-params branch below, and the legacy sims it feeds,
        // are reachable only by a caller naming a SERVER_ARENA_PETS id directly.
        // They are kept rather than deleted for two reasons: battle-result must
        // still settle tokens minted before this deploy (15-minute TTL), and
        // `_duel-replay.ts` is still the live-PvP lockstep path's replay. Both go
        // when live PvP ports.
        // Gated on `isAiOpponent` alone. A wanderer duel never reaches this line
        // — it is answered by the sealed session and returned far above — so an
        // extra wanderer term here could only ever read as true, while implying
        // a second wanderer path through this function that does not exist.
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
        let casualPveSeal = sealedParams
            ? createCasualPveBattleSeal(playerPets, opponentPets, sealedParams)
            : null;

        // Baseline outcome, used when the report carries no input log — the flag
        // is off, an older client, or the player just watched. For a PvE fight
        // this now runs the CINEMATIC engine the coliseum actually renders (an
        // empty log reproduces the uncommanded AI fight exactly), so the sealed
        // value finally agrees with the fight on screen instead of coming from
        // the retired pet-duel-sim engine. Non-PvE casual duels are untouched.
        /*
         * There is deliberately no wanderer branch in this chain. A sector
         * wanderer duel is resolved by the sealed wanderer session and returned
         * at the top of this handler, together with the cooldown and relocation
         * it writes — it never falls through to here. A second resolution at
         * this point would decide the same encounter a second way, which is the
         * exact class of split this endpoint has been closing.
         */
        const result = pvpOutcome
            // Already decided, on Showdown, for both participants at once. The
            // legacy sims below never run for a player challenge again.
            ? pvpOutcome
            : casualPveSeal
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
            // The pets this token settles for, with the consumable slot cleared —
            // the sealed duel does not fire consumables (a fight decided at accept
            // has no settlement to charge one against), so battle-result must not
            // spend them either. An empty consumable snapshot makes its spend step
            // a deliberate no-op.
            ...(pvpChallengeId && pvpSelfPets
                ? { pvpChallengeId, pvpParticipatingPets: pvpSettlementSnapshot(pvpSelfPets) }
                : {}),
            settlementPolicy: dungeon || hollowGate ? 'parent-mode' : 'casual-no-progression',
            sealedParams,
            ...(casualPveSeal ? { casualPveSeal } : {}),
            authoritativeOutcome: result,
        };

        // Publish the complete seal before its global pointer. A process crash
        // can therefore leave only an unreachable expiring seal, never a live
        // pointer whose missing proof blocks every pet mode for the full TTL.
        let ownsPublishedSeal = true;
        if (hollowGate) {
            // The parent-selected token is stable across retries, so publish it
            // once. A second request adopts the first complete snapshot instead
            // of overwriting it with a newly rolled seed (outcome shopping).
            const published = await kv.set(tokenKey, tokenData, { nx: true, ex: HOLLOW_GATE_PET_RESULT_TTL_SECONDS });
            if (!published) {
                ownsPublishedSeal = false;
                const existing = await kv.get<{
                    playerName?: string; reportKey?: string; seed?: number; mode?: string;
                    playerPetIds?: string[]; opponentPetIds?: string[];
                    casualPveSeal?: CasualPveBattleSeal;
                    hollowGate?: { runId?: string };
                }>(tokenKey);
                if (!existing
                    || existing.playerName?.toLowerCase() !== playerName.toLowerCase()
                    || existing.hollowGate?.runId !== hollowGate.runId
                    || existing.mode !== mode
                    || typeof existing.reportKey !== 'string'
                    || !Number.isSafeInteger(existing.seed)
                    || !sameOrderedIds(existing.playerPetIds, playerPetIds)
                    || !sameOrderedIds(existing.opponentPetIds, opponentPetIds)
                    || !existing.casualPveSeal) {
                    return res.status(409).json({ error: 'The sealed Hollow Gate pet proof conflicts with this encounter.' });
                }
                reportKey = existing.reportKey;
                seed = Number(existing.seed);
                casualPveSeal = existing.casualPveSeal;
            }
        } else {
            await kv.set(tokenKey, tokenData, { ex: TOKEN_TTL_SECONDS });
        }

        // One outstanding receipt per player closes seed-shopping: a client must
        // settle (including a loss/draw) before it can mint another random seed.
        const activeKey = `pet:battle-active:${playerName}`;
        const hollowGatePublicationIsValid = async (proofId: string): Promise<boolean> => !hollowGate
            || validateHollowGateCinematicPublication({
                runId: hollowGate.runId,
                playerName,
                proofId,
            });
        let claimed: unknown;
        try {
            claimed = await kv.set(activeKey, token, { nx: true, ex: TOKEN_TTL_SECONDS });
        } catch (claimError) {
            if (ownsPublishedSeal) await kv.del(tokenKey).catch(() => undefined);
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
                && sameOrderedIds(completedDungeon.playerPetIds, active.playerPetIds ?? [])) {
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
                if (!await hollowGatePublicationIsValid(token)) {
                    return res.status(409).json({ error: 'The Hollow Gate encounter ended before its pet battle became active.' });
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
            }
            const sameAuthority = dungeon
                ? activeDungeon?.runToken === dungeon.runToken && !active?.hollowGate?.runId
                : hollowGate
                    ? !activeDungeon && active?.hollowGate?.runId === hollowGate.runId
                    : !activeDungeon && !active?.hollowGate?.runId;
            if (activeToken && active?.reportKey && Number.isSafeInteger(active.seed)
                && active.mode === mode
                && sameAuthority
                && sameOrderedIds(active.playerPetIds, playerPetIds)
                && sameOrderedIds(active.opponentPetIds, opponentPetIds)) {
                if (ownsPublishedSeal && activeToken !== token) await kv.del(tokenKey).catch(() => undefined);
                if (!await hollowGatePublicationIsValid(activeToken)) {
                    return res.status(409).json({ error: 'The Hollow Gate encounter ended before its pet battle became active.' });
                }
                return res.status(200).json({
                    ok: true,
                    token: activeToken,
                    reportKey: active.reportKey,
                    seed: active.seed,
                    resumed: true,
                    ...(dungeon ? { dungeon: true } : {}),
                    // A refresh mid-duel re-derives the same script from the
                    // same seal rather than restaging the fight.
                    ...(pvpResolution && pvpOutcome
                        ? {
                            showdownScript: pvpResolution.script,
                            winnerName: pvpResolution.winnerName,
                            outcome: pvpOutcome,
                        }
                        : {}),
                    ...(active.casualPveSeal
                        ? {
                            playerPets: active.casualPveSeal.playerPets,
                            opponentPets: active.casualPveSeal.opponentPets,
                            battleConfig: active.casualPveSeal.params,
                        }
                        : {}),
                });
            }
            if (ownsPublishedSeal) await kv.del(tokenKey).catch(() => undefined);
            return res.status(409).json({ error: 'Finish or settle your active Pet Colosseum battle first.' });
        }
        // (No second `kv.set` of the battle token here. The seal is written once,
        // above, through `tokenData` — which carries the same pvpChallengeId /
        // pvpParticipatingPets fields plus `settlementPolicy` and the Dungeon
        // binding, and which publishes a Hollow Gate seal with `nx` BEFORE its
        // pointer. A second unconditional write at this point would overwrite an
        // already-published Gate seal with a freshly rolled one, reopening the
        // outcome shopping that protocol exists to close.)

        if (!await hollowGatePublicationIsValid(token)) {
            return res.status(409).json({ error: 'The Hollow Gate encounter ended before its pet battle became active.' });
        }
        return res.status(200).json({
            ok: true,
            token,
            reportKey,
            seed,
            ...(dungeon ? { dungeon: true } : {}),
            // The fight itself, for a player challenge. Both participants get
            // this same script from their own call, so the duel they watch is
            // the duel that was rated — there is nothing left for the client to
            // simulate, and deliberately no local fallback if it is absent.
            //
            // `outcome` is the caller's OWN side of the verdict, decided here.
            // The client is not asked to work it out by matching `winnerName`
            // against its account name: account names are normalised
            // (`safeName`) before they reach a seal, so a display name that
            // normalises differently would compare unequal and quietly report
            // every duel as a loss. `winnerName` is still returned, for display.
            ...(pvpResolution && pvpOutcome
                ? {
                    showdownScript: pvpResolution.script,
                    winnerName: pvpResolution.winnerName,
                    outcome: pvpOutcome,
                }
                : {}),
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
