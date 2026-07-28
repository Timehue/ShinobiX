/*
 * Hollow Gate tile resolution — drained verbatim out of App.tsx.
 *
 * This was a 654-line function declared inside the App component, and it alone held
 * App.tsx hard against its line-budget ratchet, blocking unrelated fixes from landing.
 *
 * The body below is a VERBATIM move: dedented one level, otherwise character-for-
 * character what ran before. Everything it used to close over arrives through `ctx`
 * and is destructured under the same names, so the logic reads identically and
 * behaviour is preserved. Please keep it that way — this applies rewards, hazards and
 * death, so a "tidy-up" here is a balance change wearing a refactor's clothes.
 *
 * Why context instead of imports for the last few: `gainXp`, `petPool` and
 * `HOLLOW_GATE_TRAP_DMG_PCT` all live in App.tsx, so importing them here would create
 * an App -> lib -> App cycle. HOLLOW_GATE_TRAP_DMG_PCT is additionally a mutable
 * `export let` tuned at runtime, so it must be read per call, not captured once.
 */
import { hollowGateFlavorFor } from "../data/hollow-gate-flavor";
import { petRarityOrder } from "../data/pet-config";
import { applyAttunementToRun } from "./hollow-gate-attunement";
import { generateHollowGateShrineRun, pickHollowGateEncounterPet } from "./hollow-gate-dungeon";
import { befriendHollowGatePetServer, rollHollowLockedDoorServer } from "./hollow-gate-locked-door-api";
import { hollowShardDrop } from "./hollow-gate-run";
import { consumeHollowGateServerSecondWind, hollowGateAugmentEffects } from "./hollow-gate-server";
import { tryHollowGateSecondWind } from "./hollow-gate-shards";
import { hollowGateRunMaxFloor } from "./hollow-gate-variant";
import { isPetOnExpedition } from "./pet";
import { effectiveCharacterXpGain } from "./progression";
import { requireServerSettlement } from "./server-settlement-gate";
import type { Pet, PetRarity } from "../types/pet";
import type {
    Character,
    HollowGateShrineRun,
    HollowGateTile,
    HollowGateTileKind,
} from "../types/character";
import type { Screen } from "../types/core";
import type { PetArenaOpponent } from "../data/pet-arena-opponents";

/** Modal the shrine raises for a resolved tile. Lived inside App; here so the lib owns it. */
export type HollowGateEventModal = {
    title: string;
    body: string;
    kind: HollowGateTileKind;
    choices: Array<{ label: string; onSelect: () => void; tone?: "danger" | "safe" | "primary" }>;
} | null;

/** Hidden-chamber search state for the current run. */
export type HiddenChamberState = {
    searched: boolean;
    relicTaken: boolean;
} | null;

type SetState<T> = (value: T | ((prev: T) => T)) => void;

/**
 * Everything the resolver used to close over as a component. Named to match the
 * identifiers in the moved body exactly, so the body needed no edits.
 */
export interface HollowGateTileCtx {
    /** Nullable: the body's own first line guards `!character` before use. */
    character: Character | null;
    hollowGateRun: HollowGateShrineRun | null;
    sharedImages: Record<string, string>;
    petPool: Pet[];
    /** Mutable runtime tunable from App.tsx — read per call. */
    HOLLOW_GATE_TRAP_DMG_PCT: number;

    setCharacter: SetState<Character | null>;
    setHollowGateRun: SetState<HollowGateShrineRun | null>;
    setHollowGateEvent: SetState<HollowGateEventModal>;
    setHollowGateHiddenChamber: SetState<HiddenChamberState>;
    setHollowGateTileGameActive: SetState<boolean>;
    setPendingPetBattleOpponent: SetState<PetArenaOpponent | null>;
    setScreen: (screen: Screen) => void;

    gainXp: (character: Character, amount: number) => Character;
    pushHollowGateLog: (line: string) => void;
    buildHollowGateRunSummary: () => string;
    startHollowGateBattle: (opts: { isBoss?: boolean; isAmbush?: boolean; isBeast?: boolean; isElite?: boolean; nodeId?: string }) => void | Promise<void>;
    leaveHollowGateShrine: (opts?: { death?: boolean }) => void;
}

export function resolveHollowGateTile(
    tile: HollowGateTile,
    x: number,
    y: number,
    ctx: HollowGateTileCtx,
): void {
    const {
        character, hollowGateRun, sharedImages, petPool, HOLLOW_GATE_TRAP_DMG_PCT,
        setCharacter, setHollowGateRun, setHollowGateEvent, setHollowGateHiddenChamber,
        setHollowGateTileGameActive, setPendingPetBattleOpponent, setScreen,
        gainXp, pushHollowGateLog, buildHollowGateRunSummary, startHollowGateBattle,
        leaveHollowGateShrine,
    } = ctx;
    if (!hollowGateRun || !character) return;
    const idx = y * hollowGateRun.width + x;
    const flavor = hollowGateFlavorFor(tile.kind);
    // Mark resolved immediately so re-entering the tile doesn't fire it again.
    // CRITICAL: this MUST use the functional setHollowGateRun(prev => ...) form
    // and apply only the patch fields you actually want to change. The earlier
    // version of this helper accepted a full HollowGateShrineRun and spread it,
    // which silently overwrote the player's CURRENT position with whatever
    // position was in the closure at the time the deferred resolver ran. That
    // produced the "WASD teleports back" bug — the move took, then a stale
    // setTimeout fired markResolved with closure.hollowGateRun, snapping the
    // player back. Patches now only touch resolved/keys/torch.
    function markResolved(patch?: { keysDelta?: number; setKeys?: number; torchDelta?: number; setTorch?: number }) {
        setHollowGateRun(prev => {
            if (!prev) return prev;
            const tiles = prev.tiles.slice();
            if (tiles[idx]) tiles[idx] = { ...tiles[idx], resolved: true };
            const keys = patch?.setKeys != null
                ? patch.setKeys
                : prev.keys + (patch?.keysDelta ?? 0);
            const torchRaw = patch?.setTorch != null
                ? patch.setTorch
                : prev.torch + (patch?.torchDelta ?? 0);
            return {
                ...prev,
                keys,
                torch: Math.max(0, Math.min(10, torchRaw)),
                tiles,
            };
        });
    }
    switch (tile.kind) {
        case "empty": {
            pushHollowGateLog(flavor);
            markResolved();
            return;
        }
        case "battle": {
            pushHollowGateLog(flavor);
            void startHollowGateBattle({ nodeId: `floor:${hollowGateRun.floor}:tile:${idx}` });
            markResolved();
            return;
        }
        case "elite": {
            pushHollowGateLog(`[Elite] ${flavor}`);
            void startHollowGateBattle({ isElite: true, nodeId: `floor:${hollowGateRun.floor}:tile:${idx}` });
            markResolved();
            return;
        }
        case "tile_game": {
            // Shinobi Tile card-game encounter. Pre-modal shows the
            // shadow-opponent scene art (shrine:tile-tile-game); Begin
            // dives into the 3x3 card duel. Resolution callbacks back
            // in the App body handle win/lose/abandon.
            pushHollowGateLog(`[Tile Seal] ${flavor}`);
            markResolved();
            setHollowGateEvent({
                title: "Shinobi Chronicle Showdown Seal",
                body: `${flavor}\n\nA shadow opponent waits across the stone table. Defeat them in a Shinobi Chronicle Showdown to claim the seal. Loss costs 20% of your max HP. You can step away with no penalty before the result is reached.`,
                kind: "tile_game",
                choices: [
                    {
                        label: "Begin Tile Showdown",
                        tone: "primary",
                        onSelect: () => {
                            setHollowGateEvent(null);
                            setHollowGateTileGameActive(true);
                            setScreen("hollowGateTiles");
                        },
                    },
                    {
                        label: "Step Away",
                        onSelect: () => {
                            setHollowGateEvent(null);
                            pushHollowGateLog("You leave the tile table untouched. The shadow opponent fades.");
                        },
                    },
                ],
            });
            return;
        }
        case "pet_battle": {
            // Wild Hollow Beast — pet vs pet autobattler using the existing
            // PetArena. The player's active pet duels a random wild pet
            // scaled to the player's level. Falls back to a themed shinobi
            // fight if the player has no battle-ready pet (so the tile is
            // never a dead-end).
            const activePet = (character.pets ?? []).find(p => p.id === character.activePetId);
            const petReady = activePet && activePet.unlockedForPve && !isPetOnExpedition(activePet);
            if (!petReady) {
                // No pet → fall back to the themed shinobi version of the
                // encounter so the tile still fires something on step.
                pushHollowGateLog(`[Hollow Beast] ${flavor} You have no pet ready — the beast comes for you instead.`);
                void startHollowGateBattle({ isBeast: true, nodeId: `floor:${hollowGateRun.floor}:tile:${idx}` });
                markResolved();
                return;
            }
            // Pick a wild pet rarity capped to one tier above the player's
            // pet — never a mythic vs standard mismatch. Floor weighting
            // pushes toward the cap on deeper floors but still allows
            // mirror / lower-tier matches so easier fights remain possible.
            const floor = hollowGateRun?.floor ?? 1;
            const playerRarityIdx = petRarityOrder.indexOf(activePet.rarity);
            const maxRarityIdx = Math.min(petRarityOrder.length - 1, playerRarityIdx + 1);
            // bumpChance: F1=10%, F2=15%, ..., F5=30%. Probability of using
            // the +1 tier; otherwise stay at player tier (or lower for
            // standard players when bump isn't picked).
            const bumpChance = Math.min(0.45, 0.10 + (floor - 1) * 0.05);
            const targetIdx = Math.random() < bumpChance ? maxRarityIdx : playerRarityIdx;
            const targetRarity: PetRarity = petRarityOrder[targetIdx];
            const wildBase = pickHollowGateEncounterPet(petPool, targetRarity);
            if (!wildBase) {
                // Shouldn't happen with the canonical pool, but defensive.
                pushHollowGateLog(`[Hollow Beast] ${flavor} The beast melts back into the mist.`);
                void startHollowGateBattle({ isBeast: true, nodeId: `floor:${hollowGateRun.floor}:tile:${idx}` });
                markResolved();
                return;
            }
            // Rebase wild pet to the player's pet level so the duel is
            // balanced on stats. On the hardest floors (F4-5) trim 10%
            // off hp/attack/defense so the fight stays winnable —
            // mythic-template stats can otherwise steamroll a standard
            // player pet even at matched level.
            const handicap = floor >= 4 ? 0.90 : 1.00;
            // Override the wild pet's image with the shrine beast portrait,
            // and give it an "hg-beast-" id so the image-lookup chain falls
            // through to pet.image instead of a user-generated pet template.
            const hollowBeastImg = sharedImages["shrine:tile-hollow-beast"];
            const wild: Pet = {
                ...wildBase,
                id: `hg-beast-${Date.now()}`,
                level: Math.max(1, activePet.level),
                name: `Hollow ${wildBase.name}`,
                hp: Math.max(1, Math.floor(wildBase.hp * handicap)),
                attack: Math.max(1, Math.floor(wildBase.attack * handicap)),
                defense: Math.max(1, Math.floor(wildBase.defense * handicap)),
                image: hollowBeastImg || wildBase.image,
            };
            pushHollowGateLog(`[Hollow Beast] ${flavor} ${activePet.name} squares off against ${wild.name}.`);
            // Pre-encounter modal — shows the Hollow Beast scene art
            // (shrine:tile-hollow-beast) before the player commits to
            // the duel. Begin transitions to PetArena. Step Away bails
            // with no penalty. Threat / torch reset applies whether the
            // player engages (so leaving is the safer path).
            markResolved({ setTorch: 10 });
            setHollowGateRun(prev => prev ? { ...prev, threat: 0 } : prev);
            setHollowGateEvent({
                title: `Hollow Beast: ${wild.name}`,
                body: `${flavor}\n\n${activePet.name} (Lv ${activePet.level} ${activePet.rarity}) faces ${wild.name} (Lv ${wild.level} ${wild.rarity ?? "wild"}). Win to claim victory; lose to take 20% HP damage. Either way your run continues.`,
                kind: "pet_battle",
                choices: [
                    {
                        label: "Send Pet to Duel",
                        tone: "primary",
                        onSelect: () => {
                            setHollowGateEvent(null);
                            setPendingPetBattleOpponent({
                                owner: "Hollow Gate",
                                pet: wild,
                                battleSeed: Date.now(),
                                returnScreen: "hollowGateShrine",
                            });
                            setScreen("petArena");
                        },
                    },
                    {
                        label: "Step Away",
                        onSelect: () => {
                            setHollowGateEvent(null);
                            pushHollowGateLog(`${activePet.name} pulls back. The Hollow Beast fades into mist.`);
                        },
                    },
                ],
            });
            return;
        }
        case "trap": {
            // Hollow Gate traps deal a flat percent of the player's max HP
            // (tunable: HOLLOW_GATE_TRAP_DMG_PCT). Healing is forbidden inside the
            // shrine, so this damage is permanent until you leave or descend.
            // A trap CAN kill you if HP is already low.
            const dmgPct = HOLLOW_GATE_TRAP_DMG_PCT;
            const dmg = Math.max(1, Math.floor(character.maxHp * dmgPct));
            const nextHp = Math.max(0, character.hp - dmg);
            const willDie = nextHp <= 0;
            const trapWind = willDie && hollowGateRun?.secondWindArmed ? tryHollowGateSecondWind(hollowGateRun, character) : null;
            if (trapWind) {
                consumeHollowGateServerSecondWind(character.name, hollowGateRun?.runToken);
                setCharacter(trapWind.character);
                setHollowGateRun(prev => prev ? trapWind.run : prev);
                markResolved();
                pushHollowGateLog(`${flavor} The trap's killing blow lands — then ${trapWind.log}`);
                setHollowGateEvent({ title: "Second Wind", body: trapWind.log, kind: "trap", choices: [{ label: "Press On", tone: "primary", onSelect: () => setHollowGateEvent(null) }] });
                return;
            }
            // On death, match the Arena-loss pipeline: hp:0 + hospitalized.
            setCharacter({
                ...character,
                hp: willDie ? 0 : nextHp,
                hospitalized: willDie ? true : character.hospitalized,
            });
            pushHollowGateLog(`${flavor} The seals tear ${dmg} HP from you (${Math.round(dmgPct * 100)}% of max).${willDie ? " You collapse — admitted to the village hospital." : ""}`);
            if (willDie) {
                setHollowGateEvent({
                    title: "You Have Fallen",
                    body: `${flavor}\n\nThe trap drains your final breath. You are admitted to the village hospital and your shrine run ends.\n\n— RUN SUMMARY —\n${buildHollowGateRunSummary()}`,
                    kind: "trap",
                    choices: [{
                        label: "Leave Shrine",
                        tone: "danger",
                        onSelect: () => {
                            setHollowGateEvent(null);
                            leaveHollowGateShrine({ death: true });
                            setScreen("hospital");
                        },
                    }],
                });
            } else {
                setHollowGateEvent({
                    title: "Ancient Seal Trap",
                    body: `${flavor}\n\nYou take ${dmg} HP damage (${Math.round(dmgPct * 100)}% of max).`,
                    kind: "trap",
                    choices: [{ label: "Press On", onSelect: () => setHollowGateEvent(null), tone: "primary" }],
                });
            }
            markResolved();
            return;
        }
        case "chest": {
            const ryoGain = 80 + Math.floor(Math.random() * 200);
            const xpGain = 25 + Math.floor(Math.random() * 30);
            const auraDustGain = Math.random() < 0.4 ? 5 + Math.floor(Math.random() * 8) : 0;
            // Hollow Gate Shrine chests always yield aura stones and bone charms.
            const auraStoneGain = 1 + Math.floor(Math.random() * 10);  // 1..10
            const boneCharmGain = 5 + Math.floor(Math.random() * 11);  // 5..15
            const keyGain = Math.random() < 0.3 ? 1 : 0;
            const shardGain = hollowShardDrop(hollowGateRun.floor, "chest");
            const leveled = gainXp(character, xpGain);
            setCharacter({
                ...leveled,
                ryo: leveled.ryo + ryoGain,
                auraDust: (leveled.auraDust ?? 0) + auraDustGain,
                auraStones: (leveled.auraStones ?? 0) + auraStoneGain,
                boneCharms: (leveled.boneCharms ?? 0) + boneCharmGain,
                hollowShards: (leveled.hollowShards ?? 0) + shardGain,
            });
            // Chests also refill the Torch of Reiki by 2.
            const torchRefill = 2;
            pushHollowGateLog(`Chest opened. +${ryoGain} ryo, +${effectiveCharacterXpGain(character, xpGain)} XP${auraDustGain ? `, +${auraDustGain} Aura Dust` : ""}, +${auraStoneGain} Aura Stones, +${boneCharmGain} Bone Charms, +${shardGain} Hollow Shards${keyGain ? ", +1 Shrine Key" : ""}, +${torchRefill} Torch.`);
            markResolved({ keysDelta: keyGain, torchDelta: torchRefill });
            setHollowGateEvent({
                title: "Shrine Offering Chest",
                body: `${flavor}\n\n+${ryoGain} ryo\n+${effectiveCharacterXpGain(character, xpGain)} XP${auraDustGain ? `\n+${auraDustGain} Aura Dust` : ""}\n+${auraStoneGain} Aura Stones\n+${boneCharmGain} Bone Charms\n+${shardGain} Hollow Shards${keyGain ? "\n+1 Shrine Key" : ""}`,
                kind: "chest",
                choices: [{ label: "Continue", onSelect: () => setHollowGateEvent(null), tone: "primary" }],
            });
            return;
        }
        case "shard_vein": {
            const gain = hollowShardDrop(hollowGateRun.floor, "shardVein");
            setCharacter(prev => prev ? { ...prev, hollowShards: (prev.hollowShards ?? 0) + gain } : prev);
            pushHollowGateLog(`${flavor} You pry ${gain} Hollow Shards loose.`);
            markResolved();
            return;
        }
        case "pet_event": {
            // Flavor only — pet pawprints are atmosphere, not a reward source.
            // Real pet encounters are gated behind sealed doors (the "secret room"
            // reward path) where the rare/legendary/mythic rolls live.
            const pet = character.pets.find(p => p.id === character.activePetId);
            pushHollowGateLog(flavor);
            setHollowGateEvent({
                title: "Glowing Pawprints",
                body: pet
                    ? `${flavor}\n\n${pet.name} sniffs the air, then the trail fades into the dark.`
                    : `${flavor}\n\nThe trail fades into the dark.`,
                kind: "pet_event",
                choices: [{ label: "Onward", onSelect: () => setHollowGateEvent(null), tone: "primary" }],
            });
            markResolved();
            return;
        }
        case "shrine": {
            // Shrine tile fully refills the Torch of Reiki.
            pushHollowGateLog(`${flavor} The Torch of Reiki flares to full.`);
            setHollowGateHiddenChamber({ searched: false, relicTaken: false });
            markResolved({ setTorch: 10 });
            return;
        }
        case "story": {
            // Flavor only — story tiles teach you about the shrine. No rewards
            // (rewards come from chests, secret doors, and the Warden).
            pushHollowGateLog(flavor);
            setHollowGateEvent({
                title: "Hollow Gate Echo",
                body: `${flavor}\n\nYou study the engraving. The shrine watches.`,
                kind: "story",
                choices: [{ label: "Move On", onSelect: () => setHollowGateEvent(null), tone: "primary" }],
            });
            markResolved();
            return;
        }
        case "boss": {
            pushHollowGateLog(flavor);
            void startHollowGateBattle({ isBoss: true, nodeId: `floor:${hollowGateRun.floor}:tile:${idx}` });
            // Do NOT mark resolved here — boss tile is resolved on victory by the battle complete handler.
            return;
        }
        case "descend": {
            // Staircase to the next floor. Carries torch + keys forward and
            // gives a small torch refill. Resolved on use.
            pushHollowGateLog(flavor);
            if (hollowGateRun.floor >= hollowGateRunMaxFloor(hollowGateRun)) {
                // Defensive — shouldn't happen since the final floor never
                // spawns a descend tile, but if it somehow does, treat as exit.
                setHollowGateEvent({
                    title: "Bottomless Staircase",
                    body: "The staircase coils into the dark, leading nowhere.\n\nThis is the deepest floor.",
                    kind: "descend",
                    choices: [{ label: "Continue", onSelect: () => setHollowGateEvent(null), tone: "primary" }],
                });
                markResolved();
                return;
            }
            setHollowGateEvent({
                title: "Descend the Staircase",
                body: `${flavor}\n\nDescend to Floor ${hollowGateRun.floor + 1}? You carry your keys and torch forward, with a small Reiki refill.`,
                kind: "descend",
                choices: [
                    {
                        label: "Descend Deeper",
                        tone: "primary",
                        onSelect: () => {
                            // The run's variant rides along so an event gate keeps its
                            // shape (floors / board / boss) on every floor below.
                            const next = applyAttunementToRun(generateHollowGateShrineRun(hollowGateRun.floor + 1, hollowGateRun.variant), character, false);
                            setHollowGateRun({ ...next, keys: hollowGateRun.keys, torch: Math.min(10, hollowGateRun.torch + 4), entryCurrencies: hollowGateRun.entryCurrencies });
                            pushHollowGateLog(`You descend to Floor ${next.floor}. Torch flares: +4.`);
                            setHollowGateEvent(null);
                        },
                    },
                    { label: "Hold Position", onSelect: () => setHollowGateEvent(null) },
                ],
            });
            // Don't markResolved — player can stay on the floor and come back to the staircase.
            return;
        }
        case "npc": {
            // Shrine Keeper — one per floor. Offers a one-time blessing.
            pushHollowGateLog(flavor);
            setHollowGateEvent({
                title: "The Shrine Keeper",
                body: `${flavor}\n\n"Choose your gift, traveler. The shrine offers what it can spare."`,
                kind: "npc",
                choices: [
                    // Treasure Sense ("fewer healing tiles") seals the Keeper's heal — HG-only.
                    ...(hollowGateAugmentEffects(hollowGateRun).noKeeperHeal ? [] : [{
                        label: "Restore HP (33% of max)",
                        tone: "primary" as const,
                        onSelect: () => {
                            if (!character) return;
                            // NOTE: healing is normally forbidden in the shrine, but a
                            // Shrine Keeper blessing is the canonical exception.
                            const heal = Math.floor(character.maxHp * 0.33);
                            setCharacter({ ...character, hp: Math.min(character.maxHp, character.hp + heal) });
                            pushHollowGateLog(`The Shrine Keeper restores ${heal} HP.`);
                            setHollowGateEvent(null);
                        },
                    }]),
                    {
                        label: "Refill Torch of Reiki",
                        onSelect: () => {
                            // Functional form preserves markResolved()'s
                            // resolved:true (closure-spread re-armed this tile).
                            setHollowGateRun(prev => prev ? { ...prev, torch: 10 } : prev);
                            pushHollowGateLog("The Shrine Keeper rekindles the Torch of Reiki to full.");
                            setHollowGateEvent(null);
                        },
                    },
                    {
                        label: "Gift a Shrine Key",
                        onSelect: () => {
                            // Functional form — see the Refill Torch note above:
                            // the closure-spread form reverted markResolved()'s
                            // resolved:true and let this tile be farmed for keys.
                            setHollowGateRun(prev => prev ? { ...prev, keys: prev.keys + 1 } : prev);
                            pushHollowGateLog("The Shrine Keeper presses a Shrine Key into your palm. +1 Shrine Key.");
                            setHollowGateEvent(null);
                        },
                    },
                ],
            });
            markResolved();
            return;
        }
        case "exit": {
            // The Exit tile is the LEAVE tile — the only voluntary way out of
            // the shrine. Stepping on it ends the run and returns to worldMap.
            // The saved run is cleared; re-entering costs another Hollow Gate Key.
            pushHollowGateLog(flavor);
            // Berserker's Gamble ("no retreat") seals the Leave tile for the run (HG-only).
            const noRetreat = hollowGateAugmentEffects(hollowGateRun).noRetreat;
            setHollowGateEvent({
                title: noRetreat ? "The Gate Holds You" : "Leave the Hollow Gate",
                body: noRetreat
                    ? `${flavor}\n\nBerserker's Gamble binds you — the torii will not open backward. Clear the Hollow Gate or fall.`
                    : `${flavor}\n\nThe broken torii on this tile opens back to the world map.\n\n— RUN SUMMARY —\n${buildHollowGateRunSummary()}\n\nLeaving ends this run — your progress is forfeit and you'll need another Hollow Gate Key to return.`,
                kind: "exit",
                choices: noRetreat
                    ? [{ label: "Press On", tone: "primary", onSelect: () => setHollowGateEvent(null) }]
                    : [
                        {
                            label: "Leave Shrine",
                            tone: "danger",
                            onSelect: () => {
                                setHollowGateEvent(null);
                                leaveHollowGateShrine();
                            },
                        },
                        { label: "Step Back", onSelect: () => setHollowGateEvent(null) },
                    ],
            });
            // Don't mark resolved — players can step back and approach later
            // (the tile still works on re-entry).
            return;
        }
        case "locked": {
            if (hollowGateRun.keys > 0) {
                pushHollowGateLog(`${flavor} You spend a Shrine Key to open it.`);
                const serverRunToken = hollowGateRun.runToken;
                if (!serverRunToken) {
                    pushHollowGateLog("This legacy run has no server seal. Leave and begin a new run before opening locked doors.");
                    return;
                }
                void (async () => {
                    const result = await rollHollowLockedDoorServer(character.name, serverRunToken, `floor:${hollowGateRun.floor}:tile:${idx}`);
                    if (!result) {
                        pushHollowGateLog("The sealed door did not answer. Your Shrine Key was not spent; try again.");
                        return;
                    }
                    markResolved({ keysDelta: -1 });
                    if (result.outcome === "chest" && result.loot) {
                        const loot = result.loot;
                        setCharacter((prev) => {
                            if (!prev) return prev;
                            const leveled = gainXp(prev, loot.xp);
                            return { ...leveled, ryo: leveled.ryo + (loot.ryo ?? 0), fateShards: (leveled.fateShards ?? 0) + (loot.fateShards ?? 0), boneCharms: (leveled.boneCharms ?? 0) + (loot.boneCharms ?? 0), auraStones: (leveled.auraStones ?? 0) + (loot.auraStones ?? 0), auraDust: (leveled.auraDust ?? 0) + (loot.auraDust ?? 0), hollowShards: (leveled.hollowShards ?? 0) + loot.hollowShards };
                        });
                        const lines = [`+${effectiveCharacterXpGain(character, loot.xp)} XP`];
                        if (loot.ryo) lines.push(`+${loot.ryo} ryo`); if (loot.fateShards) lines.push(`+${loot.fateShards} Fate Shard`);
                        if (loot.boneCharms) lines.push(`+${loot.boneCharms} Bone Charm`); if (loot.auraStones) lines.push(`+${loot.auraStones} Aura Stone`); if (loot.auraDust) lines.push(`+${loot.auraDust} Aura Dust`);
                        lines.push(`+${loot.hollowShards} Hollow Shards`);
                        pushHollowGateLog(`Ancient Chest opened. ${lines.join(", ")}.`);
                        setHollowGateEvent({ title: "Ancient Chest", body: `Behind the chains, an ancient chest creaks open.\n\n${lines.join("\n")}`, kind: "chest", choices: [{ label: "Continue", onSelect: () => setHollowGateEvent(null), tone: "primary" }] });
                        return;
                    }
                    if (result.outcome === "trap") {
                        const damage = Math.max(1, Math.floor(character.maxHp * HOLLOW_GATE_TRAP_DMG_PCT));
                        const nextHp = Math.max(0, character.hp - damage);
                        const willDie = nextHp <= 0;
                        const secondWind = willDie && hollowGateRun.secondWindArmed ? tryHollowGateSecondWind(hollowGateRun, character) : null;
                        if (secondWind) {
                            consumeHollowGateServerSecondWind(character.name, hollowGateRun.runToken);
                            setCharacter(secondWind.character); setHollowGateRun(secondWind.run);
                            pushHollowGateLog(`The cursed seal drains your last breath - then ${secondWind.log}`);
                            setHollowGateEvent({ title: "Second Wind", body: secondWind.log, kind: "trap", choices: [{ label: "Press On", tone: "primary", onSelect: () => setHollowGateEvent(null) }] });
                            return;
                        }
                        setCharacter({ ...character, hp: nextHp, hospitalized: willDie || character.hospitalized });
                        pushHollowGateLog(`Trap behind the door! You take ${damage} HP damage.`);
                        setHollowGateEvent({ title: willDie ? "Cursed Trap Door" : "Trap Door", body: willDie ? "The binding seal drains the last of your chakra. Your shrine run ends." : `Behind the chains, a cursed seal lashes out.\n\nYou take ${damage} HP damage.`, kind: "trap", choices: [{ label: willDie ? "Leave Shrine" : "Press On", tone: "danger", onSelect: () => { setHollowGateEvent(null); if (willDie) { leaveHollowGateShrine({ death: true }); setScreen("hospital"); } } }] });
                        return;
                    }
                    const encounter = result.pet;
                    const petToken = result.petToken;
                    if (!encounter || !petToken) {
                        setHollowGateEvent({ title: "Empty Chamber", body: "A presence stirs, then fades away.", kind: "locked", choices: [{ label: "Continue", onSelect: () => setHollowGateEvent(null), tone: "primary" }] });
                        return;
                    }
                    const rarity = result.rarity ?? encounter.rarity;
                    pushHollowGateLog(`A ${rarity} pet emerges from behind the sealed door: ${encounter.name}.`);
                    setHollowGateEvent({
                        title: `${String(rarity).charAt(0).toUpperCase() + String(rarity).slice(1)} Pet Encounter`,
                        body: `Behind the chains, a ${rarity} spirit-bound creature studies you.\n\n${encounter.name} - Lv. ${encounter.level}\nHP ${encounter.hp} | ATK ${encounter.attack} | DEF ${encounter.defense} | SPD ${encounter.speed}\n\nBefriend it? (${character.pets.length}/5)`,
                        kind: "pet_event",
                        choices: [{ label: `Befriend ${encounter.name}`, tone: "primary", onSelect: () => {
                            if (!requireServerSettlement("hollowGatePetBefriend")) return;
                            void befriendHollowGatePetServer(character.name, petToken).then((befriended) => {
                                if (!befriended.character) return alert(befriended.error || "The pet could not be befriended.");
                                setCharacter(befriended.character); pushHollowGateLog(`${encounter.name} joined you!${befriended.trait ? ` Trait: ${befriended.trait}.` : ""}`); setHollowGateEvent(null);
                            });
                        } }, { label: "Leave it", onSelect: () => setHollowGateEvent(null) }],
                    });
                })();
                return; /* Legacy client-side locked-door table retained only as history.
                Server-authoritative roll/befriend above is the sole runtime path.
                const roll = Math.random();
                if (roll < 0.50) {
                    // ANCIENT CHEST
                    const loot = rollHollowGateAncientChest(hollowGateRun.floor);
                    const leveled = gainXp(character, loot.xp);
                    const lockedShards = hollowShardDrop(hollowGateRun.floor, "lockedChest");
                    // Stack only flagged-stackable items; skip non-stackable dups.
                    const shouldAddItem = loot.itemId && (
                        stackableItemIds.has(loot.itemId) || !character.inventory.includes(loot.itemId)
                    );
                    const next: Character = {
                        ...leveled,
                        ryo: leveled.ryo + (loot.ryo ?? 0),
                        fateShards: (leveled.fateShards ?? 0) + (loot.fateShards ?? 0),
                        boneCharms: (leveled.boneCharms ?? 0) + (loot.boneCharms ?? 0),
                        auraStones: (leveled.auraStones ?? 0) + (loot.auraStones ?? 0),
                        auraDust: (leveled.auraDust ?? 0) + (loot.auraDust ?? 0),
                        hollowShards: (leveled.hollowShards ?? 0) + lockedShards,
                        inventory: shouldAddItem && loot.itemId ? [...leveled.inventory, loot.itemId] : leveled.inventory,
                    };
                    setCharacter(next);
                    const lootLines: string[] = [
                        `+${effectiveCharacterXpGain(character, loot.xp)} XP`,
                    ];
                    if (loot.ryo) lootLines.push(`+${loot.ryo} ryo`);
                    if (loot.itemId && shouldAddItem) {
                        const item = starterItems.find(it => it.id === loot.itemId) ?? petTreatItems.find(t => t.id === loot.itemId);
                        lootLines.push(`+1 ${item?.name ?? loot.itemId}`);
                    }
                    if (loot.fateShards) lootLines.push(`+${loot.fateShards} Fate Shard`);
                    if (loot.boneCharms) lootLines.push(`+${loot.boneCharms} Bone Charm`);
                    if (loot.auraStones) lootLines.push(`+${loot.auraStones} Aura Stone`);
                    if (loot.auraDust) lootLines.push(`+${loot.auraDust} Aura Dust`);
                    lootLines.push(`+${lockedShards} Hollow Shards`);
                    pushHollowGateLog(`Ancient Chest opened. ${lootLines.join(", ")}.`);
                    setHollowGateEvent({
                        title: "Ancient Chest",
                        body: `Behind the chains, an ancient chest creaks open.\n\n${lootLines.join("\n")}`,
                        kind: "chest",
                        choices: [{ label: "Continue", onSelect: () => setHollowGateEvent(null), tone: "primary" }],
                    });
                } else if (roll < 0.75) {
                    // TRAP — same formula as the trap tile (tunable HOLLOW_GATE_TRAP_DMG_PCT).
                    const dmgPct = HOLLOW_GATE_TRAP_DMG_PCT;
                    const dmg = Math.max(1, Math.floor(character.maxHp * dmgPct));
                    const nextHp = Math.max(0, character.hp - dmg);
                    const willDie = nextHp <= 0;
                    const doorWind = willDie && hollowGateRun?.secondWindArmed ? tryHollowGateSecondWind(hollowGateRun, character) : null;
                    if (doorWind) {
                        consumeHollowGateServerSecondWind(character.name, hollowGateRun?.runToken);
                        setCharacter(doorWind.character);
                        setHollowGateRun(prev => prev ? doorWind.run : prev);
                        pushHollowGateLog(`The cursed seal drains your last breath — then ${doorWind.log}`);
                        setHollowGateEvent({ title: "Second Wind", body: doorWind.log, kind: "trap", choices: [{ label: "Press On", tone: "primary", onSelect: () => setHollowGateEvent(null) }] });
                        return;
                    }
                    setCharacter({
                        ...character,
                        hp: willDie ? 0 : nextHp,
                        hospitalized: willDie ? true : character.hospitalized,
                    });
                    pushHollowGateLog(`Trap behind the door! You take ${dmg} HP damage (${Math.round(dmgPct * 100)}% of max).${willDie ? " You collapse — admitted to the hospital." : ""}`);
                    if (willDie) {
                        setHollowGateEvent({
                            title: "Cursed Trap Door",
                            body: `The chains were a binding seal. They drain the last of your chakra. You are admitted to the village hospital and your shrine run ends.`,
                            kind: "trap",
                            choices: [{
                                label: "Leave Shrine",
                                tone: "danger",
                                onSelect: () => {
                                    setHollowGateEvent(null);
                                    leaveHollowGateShrine({ death: true });
                                    setScreen("hospital");
                                },
                            }],
                        });
                    } else {
                        setHollowGateEvent({
                            title: "Trap Door",
                            body: `Behind the chains, a cursed seal lashes out.\n\nYou take ${dmg} HP damage (${Math.round(dmgPct * 100)}% of max).`,
                            kind: "trap",
                            choices: [{ label: "Press On", onSelect: () => setHollowGateEvent(null), tone: "danger" }],
                        });
                    }
                } else {
                    // PET ENCOUNTER — rare (24%), legendary (0.8%), mythic (0.2%).
                    // Roll within the [0.75, 1.0] band for relative weights:
                    //   0.75 .. 0.99 (24%)  rare
                    //   0.99 .. 0.998 (0.8%) legendary
                    //   0.998 .. 1.0 (0.2%) mythic
                    let rarity: PetRarity;
                    if (roll < 0.99) rarity = "rare";
                    else if (roll < 0.998) rarity = "legendary";
                    else rarity = "mythic";

                    // Use the canonical petPool (full built-in pool) rather than editablePets
                    // so each rarity band always has variety even if admins haven't seeded
                    // the editable pool yet.
                    const encounter = pickHollowGateEncounterPet(petPool, rarity);
                    if (!encounter) {
                        // Defensive — should never happen with the standard pet pool, but bail safely.
                        pushHollowGateLog("A presence stirs behind the door, then fades away.");
                        setHollowGateEvent({
                            title: "Empty Chamber",
                            body: "Behind the chains, an empty chamber. The presence retreats.",
                            kind: "locked",
                            choices: [{ label: "Continue", onSelect: () => setHollowGateEvent(null), tone: "primary" }],
                        });
                    } else {
                        pushHollowGateLog(`A ${rarity} pet emerges from behind the sealed door: ${encounter.name}.`);
                        const rarityColor = rarity === "mythic" ? "#fbbf24" : rarity === "legendary" ? "#a855f7" : "#60a5fa";
                        setHollowGateEvent({
                            title: `${rarity.charAt(0).toUpperCase() + rarity.slice(1)} Pet Encounter`,
                            body: `Behind the chains, a ${rarity} spirit-bound creature studies you.\n\n${encounter.name} — Lv. ${encounter.level}\nHP ${encounter.hp} | ATK ${encounter.attack} | DEF ${encounter.defense} | SPD ${encounter.speed}\n\nBefriend it? (Pet Yard ${character.pets.length}/5)`,
                            kind: "pet_event",
                            choices: [
                                {
                                    label: `Befriend ${encounter.name}`,
                                    tone: "primary",
                                    onSelect: () => {
                                        if (!requireServerSettlement("hollowGatePetBefriend")) return;
                                        if (character.pets.length >= 5) {
                                            alert("Your Pet Yard is full (5/5). Release a pet before befriending another.");
                                            return;
                                        }
                                        const trait = rollPetTrait(encounter.rarity);
                                        const petWithTrait = applyPetTraitBonuses({ ...encounter, trait }, trait);
                                        const updated = { ...character, pets: [...character.pets, petWithTrait] };
                                        setCharacter(updated);
                                        // Flush now (mirrors starter-pet path) so a refresh/close inside the 3s
                                        // autosave debounce can't lose a freshly befriended rare/mythic pet.
                                        void pushSaveToServer(updated, currentAccountName || character.name).catch(() => {});
                                        pushHollowGateLog(`${encounter.name} joined you! Trait: ${trait}.`);
                                        setHollowGateEvent(null);
                                    },
                                },
                                { label: "Leave it", onSelect: () => { pushHollowGateLog(`You leave the ${rarity} spirit be.`); setHollowGateEvent(null); } },
                            ],
                        });
                        // Subtle color hint via log
                        pushHollowGateLog(`%c${rarity.toUpperCase()} aura detected.`);
                        void rarityColor; // referenced for clarity; actual coloring not in this simple log
                    }
                } */
            } else {
                pushHollowGateLog(`${flavor} Without a Shrine Key, the door will not open.`);
                setHollowGateEvent({
                    title: "Sealed Door",
                    body: `${flavor}\n\nYou need a Shrine Key to open this door.`,
                    kind: "locked",
                    choices: [{ label: "Step Back", onSelect: () => setHollowGateEvent(null) }],
                });
                // Don't mark resolved — player can try again with a key later.
            }
            return;
        }
    }
}
