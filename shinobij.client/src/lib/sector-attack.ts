/**
 * Sector attack — the open-world "attack this player where they stand" flow.
 *
 * Lifted verbatim out of the 120-line inline JSX handler that lived on WorldMap's
 * `sectorAttackPlayer` prop in App.tsx. Only the indentation and the closure
 * changed: every identifier the body reads is now a destructured parameter with
 * the SAME name, so the statements below are token-for-token what App ran.
 *
 * Why it is worth having its own file: this is a reward-bearing, server-
 * authoritative PvP path (it gates on settlement, claims the target, creates a
 * sealed PvP session, registers the sector battle, and only then routes). While
 * it lived inside App.tsx it could not be unit-tested at all — App.tsx imports a
 * .webp, so node:test can never load it — and its ordering guarantees were
 * pinned only by string-matching the JSX in two contract tests. Those guarantees
 * are now executable; see ./sector-attack.test.ts.
 *
 * Ordering invariants this function must keep (both were previously asserted by
 * source grep in lib/server-settlement-gate.test.ts and lib/pvp-session-runtime.test.ts):
 *   1. requireServerSettlement("pvpSession") runs BEFORE session creation.
 *   2. A "recovered" create installs the reconciled pointer in the same mount.
 * Every await is followed by a createIsCurrent() re-check: the account can change
 * under a slow request, and painting a foreign save is the failure being fenced.
 *
 * getPvpJutsuLoadout and normalizeCharacter were briefly injected as parameters,
 * because both still lived in App.tsx and importing them would have dragged
 * App's `.webp` and component CSS in — the thing that makes a module unloadable
 * under node:test. Both have since moved to lib/ (./jutsu-loadout,
 * ./normalize-character), so they are plain imports again and the option object
 * lost two fields.
 */
import { requireServerSettlement } from "./server-settlement-gate";
import { claimWorldAttack, releaseWorldAttack } from "./world-attack-claim";
import { getAllItems } from "./items";
import {
    getCharacterArmorFactor,
    getCharacterArmorRawDR,
    getEquippedItemBonus,
    getPvpItemLoadout,
} from "./equipment-stats";
import { getBloodlineMultiplier } from "./combat-math";
import { fetchPlayerCombatSave, pvpSessionEnvironment, stringifyPvpSessionPayload } from "./pvp-session";
import { makeId } from "./utils";
import { weatherEffects } from "../data/world";
import { getPvpJutsuLoadout } from "./jutsu-loadout";
import { normalizeCharacter } from "./normalize-character";
import type { PendingPvpRecovery, PvpRecoveryContext } from "./pvp-pending-session";
import type { Character, PlayerRecord } from "../types/character";
import type { GameItem, Jutsu, SavedBloodline } from "../types/combat";
import type { Biome, Screen, WeatherType } from "../types/core";
import type { DuelChallenge } from "../types/duel-challenge";
import type { PvpSessionState } from "../types/pvp-ui";

/** Kept identical to App's own lazy loader so the create helper stays off the startup graph. */
const loadPvpSessionCreate = () => import("./pvp-session-create");

export type SectorAttackOptions = {
    opponent: PlayerRecord;
    character: Character;
    isTraveling: boolean;
    creatorItems: GameItem[];
    creatorJutsus: Jutsu[];
    savedBloodlines: SavedBloodline[];
    currentSector: number;
    currentBiome: Biome;
    currentWeather: WeatherType;
    capturePvpCreateScope: (accountName: string) => { signal: AbortSignal; isCurrent: () => boolean };
    installPvpRecovery: (pending: PendingPvpRecovery) => void;
    setPvpBattleId: (battleId: string) => void;
    setPvpRole: (role: "p1" | "p2") => void;
    setPvpBattleContext: (context: PvpRecoveryContext) => void;
    setPvpSeedSession: (session: PvpSessionState | null) => void;
    setRaidBattleKind: (kind: "none" | "raidAi" | "raidPlayer" | "defense") => void;
    setScreen: (screen: Screen) => void;
};

export async function attackSectorPlayer(opts: SectorAttackOptions): Promise<void> {
    const {
        opponent, character, isTraveling, creatorItems, creatorJutsus, savedBloodlines,
        currentSector, currentBiome, currentWeather, capturePvpCreateScope, installPvpRecovery,
        setPvpBattleId, setPvpRole, setPvpBattleContext, setPvpSeedSession, setRaidBattleKind, setScreen,
    } = opts;
    if (!requireServerSettlement("pvpSession")) return;
    const createOwnerName = character.name;
    const createScope = capturePvpCreateScope(createOwnerName);
    const createIsCurrent = createScope.isCurrent;
    if (isTraveling) {
        alert("You cannot attack while traveling.");
        return;
    }
    // The world path's admission gate — Academy protection and the
    // engaged/traveling/in-battle refusals. See lib/world-attack-claim.
    const claim = await claimWorldAttack(opponent.name, character.name, createScope.signal);
    if (!createIsCurrent()) return; if (!claim.ok) return void alert(claim.error);
    // Use local character data — the server hydrates both
    // fighters from their KV save records directly (see
    // api/pvp/session.ts ~line 502), so the redundant
    // fetchPlayerCombatSave round trips that used to gate
    // this flow are unnecessary. The payload below is
    // only consulted as a fallback for fighters without
    // a save (NPCs).
    const selfChar = character;
    const selfAllItems = getAllItems(creatorItems);
    const p1Jutsus = getPvpJutsuLoadout(savedBloodlines, creatorJutsus, selfChar);

    // Optimistic navigation — flip to the pvpBattle screen
    // immediately so the player sees the proper battle
    // backdrop + a "Connecting to battle session..." card
    // instead of staring at the sector view for 1–3
    // seconds while the session POST resolves. The
    // PvpBattleScreen session-fetch effect is keyed on
    // battleId, so the empty id just renders the
    // loading card; once we set the real id below the
    // effect re-runs and loads the grid.
    // Sector-mate records from /api/player/heartbeat only carry { avatarImage }
    // (the full character is intentionally stripped for bandwidth). Fetch the
    // opponent's combat save and resolve their FULL loadout — stats, armor,
    // weapons + consumables/throwables (pvpItems), jutsu and bloodline — from
    // THEIR own bloodlines + creator content. fetchPlayerCombatSave returns null
    // (never throws) on failure, so the optimistic navigation above stays safe;
    // the server also re-hydrates authoritatively from the save by p2Character.name.
    const oppSave = await fetchPlayerCombatSave(opponent.name);
    if (!createIsCurrent()) return;
    const oppChar = oppSave?.character ?? normalizeCharacter(opponent.character as Character);
    const oppBloodlines = oppSave?.savedBloodlines?.length ? oppSave.savedBloodlines : savedBloodlines;
    const oppCreatorJutsus = oppSave?.creatorJutsus?.length ? [...creatorJutsus, ...oppSave.creatorJutsus] : creatorJutsus;
    const opponentAllItems = getAllItems(oppSave?.creatorItems?.length ? [...creatorItems, ...oppSave.creatorItems] : creatorItems);
    const p2Jutsus = getPvpJutsuLoadout(oppBloodlines, oppCreatorJutsus, oppChar);

    const createBody = stringifyPvpSessionPayload({
        useCurrentVitals: true,
        requireWorldCoLocation: true,
        baseRewards: true,
        rewardSector: currentSector,
        ...pvpSessionEnvironment(false, currentBiome, weatherEffects[currentWeather]?.positiveElement, weatherEffects[currentWeather]?.negativeElement),
        p1Character: { ...selfChar, jutsu: p1Jutsus, pvpItems: getPvpItemLoadout(selfChar, selfAllItems), bloodlineMult: getBloodlineMultiplier(selfChar, savedBloodlines), armorFactor: getCharacterArmorFactor(selfChar, selfAllItems), armorRawDR: getCharacterArmorRawDR(selfChar, selfAllItems), itemDamagePct: getEquippedItemBonus(selfChar, selfAllItems, "damagePercent"), itemAbsorbPct: getEquippedItemBonus(selfChar, selfAllItems, "absorbPercent"), itemReflectPct: getEquippedItemBonus(selfChar, selfAllItems, "reflectPercent"), itemLifeStealPct: getEquippedItemBonus(selfChar, selfAllItems, "lifeStealPercent"), itemShield: getEquippedItemBonus(selfChar, selfAllItems, "shield") },
        p2Character: { ...oppChar, name: opponent.name, jutsu: p2Jutsus, pvpItems: getPvpItemLoadout(oppChar, opponentAllItems), bloodlineMult: getBloodlineMultiplier(oppChar, oppBloodlines), armorFactor: getCharacterArmorFactor(oppChar, opponentAllItems), armorRawDR: getCharacterArmorRawDR(oppChar, opponentAllItems), itemDamagePct: getEquippedItemBonus(oppChar, opponentAllItems, "damagePercent"), itemAbsorbPct: getEquippedItemBonus(oppChar, opponentAllItems, "absorbPercent"), itemReflectPct: getEquippedItemBonus(oppChar, opponentAllItems, "reflectPercent"), itemLifeStealPct: getEquippedItemBonus(oppChar, opponentAllItems, "lifeStealPercent"), itemShield: getEquippedItemBonus(oppChar, opponentAllItems, "shield") },
    });
    setPvpBattleId((await loadPvpSessionCreate()).pvpStableBattleIdFromRequestBody(createBody));
    setPvpRole("p1");
    setPvpBattleContext({ mode: "standard", sectorAttack: true, raidKind: "raidPlayer", sector: currentSector });
    const createResult = await (await loadPvpSessionCreate()).createPvpSessionWithRecovery(fetch, createOwnerName, createBody, {
        signal: createScope.signal, isCurrent: createIsCurrent,
    });
    if (!createIsCurrent()) return;
    if (createResult.kind === "recovered") {
        installPvpRecovery(createResult.pending);
        setScreen("pvpBattle");
        return;
    }
    if (createResult.kind === "rejected") {
        releaseWorldAttack(opponent.name); // no fight started — don't leave them "engaged"
        setPvpBattleId('');
        setPvpSeedSession(null);
        setRaidBattleKind("none");
        setScreen("worldMap");
        alert(createResult.error);
        return;
    }
    const battleId = createResult.battleId;
    if (createResult.kind === "ambiguous") {
        setPvpBattleId(battleId);
        setScreen("pvpBattle");
        alert("The battle response was interrupted. Reconnecting to the authoritative session…");
        return;
    }
    try {
        // Path rebased from "./lib/village-war-map" — this code now lives IN
        // lib/. This is the ONLY edit to the moved statements.
        const { confirmSectorBattleRegistration } = await import("./village-war-map"); // lazy: sector-war client stays off the startup graph
        await confirmSectorBattleRegistration(createOwnerName, currentSector, battleId, createScope);
    } catch (error) {
        releaseWorldAttack(opponent.name); // registration never confirmed — release the claim
        if (!createIsCurrent()) return;
        alert(error instanceof Error ? error.message : "The sector battle is still registering. Retry the same attack.");
        return;
    }
    if (!createIsCurrent()) return;
    setPvpSeedSession(createResult.session);
    setPvpBattleId(battleId);
    setScreen("pvpBattle");

    // Notification is advisory after session+pointer publication.
    const challenge: DuelChallenge = {
        id: makeId(),
        fromName: character.name,
        toName: opponent.name,
        challenger: character,
        challengerJutsus: p1Jutsus,
        challengerBloodlineMult: getBloodlineMultiplier(character, savedBloodlines),
        createdAt: Date.now(),
        mode: "standard" as const,
        sectorAttack: true,
        battleId,
    };
    fetch('/api/player/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetName: opponent.name, challenge }),
    }).then((res) => {
        if (!res.ok) {
            alert(`The battle is live, but ${opponent.name} could not be notified yet.`);
        }
    }).catch(() => { /* defender notification is best-effort; session is live regardless */ });

}
