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
 * Server event routes own all rewards, traps, and run-state consequences.
 */
import { hollowGateFlavorFor } from "../data/hollow-gate-flavor";
import { applyAttunementToRun } from "./hollow-gate-attunement";
// The procedural generator (./hollow-gate-dungeon + its ASCII layouts, BSP and
// maze modules) is loaded on demand — the only call site here already awaits a
// network round-trip first, so it costs no extra wait and keeps ~16 KB of
// generator off the startup graph. Visibility is a separate, always-loaded
// module (./hollow-gate-visibility).
import { loadHollowGateGenerator } from "./hollow-gate-generator-loader";
import { befriendHollowGatePetServer } from "./hollow-gate-locked-door-api";
import { hollowGateFloorProfile } from "./hollow-gate-presentation";
import { hollowGateAugmentEffects } from "./hollow-gate-server";
import { hollowGateRunMaxFloor } from "./hollow-gate-variant";
import { requireServerSettlement } from "./server-settlement-gate";
import { descendHollowGateRun } from "./hollow-gate-combat-api";
import { activeCarriedPets, maxPets } from "./entitlements";
import { hollowGateRewardLines, resolveHollowGateServerEvent, sealHollowGateFloor } from "./hollow-gate-event-api";
import type {
    Character,
    HollowGateShrineRun,
    HollowGateTile,
    HollowGateTileKind,
    VersionedCharacterCommit,
} from "../types/character";

/** Modal the shrine raises for a resolved tile. Lived inside App; here so the lib owns it. */
export type HollowGateEventModal = {
    title: string;
    body: string;
    kind: HollowGateTileKind;
    presentation?: "standard" | "boss-victory";
    image?: string;
    eyebrow?: string;
    choices: Array<{ label: string; onSelect: () => void; tone?: "danger" | "safe" | "primary" }>;
} | null;

/** Hidden-chamber search state for the current run. */
export type HiddenChamberState = {
    searched: boolean;
    relicTaken: boolean;
    nodeId: string;
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
    setHollowGateRun: SetState<HollowGateShrineRun | null>;
    setHollowGateEvent: SetState<HollowGateEventModal>;
    setHollowGateHiddenChamber: SetState<HiddenChamberState>;
    onVersionedCharacter: VersionedCharacterCommit;

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
        character, hollowGateRun,
        setHollowGateRun, setHollowGateEvent, setHollowGateHiddenChamber,
        onVersionedCharacter,
        pushHollowGateLog, buildHollowGateRunSummary, startHollowGateBattle,
        leaveHollowGateShrine,
    } = ctx;
    if (!hollowGateRun || !character) return;
    const idx = y * hollowGateRun.width + x;
    const flavor = hollowGateFlavorFor(tile.kind);
    const floorProfile = hollowGateFloorProfile(hollowGateRun.floor);
    // Mark resolved immediately so re-entering the tile doesn't fire it again.
    // CRITICAL: this MUST use the functional setHollowGateRun(prev => ...) form
    // and apply only the patch fields you actually want to change. The earlier
    // version of this helper accepted a full HollowGateShrineRun and spread it,
    // which silently overwrote the player's CURRENT position with whatever
    // position was in the closure at the time the deferred resolver ran. That
    // produced the "WASD teleports back" bug — the move took, then a stale
    // setTimeout fired markResolved with closure.hollowGateRun, snapping the
    // player back. Patches now only touch resolved/keys/torch.
    function markResolved(patch?: { keysDelta?: number; setKeys?: number; torchDelta?: number; setTorch?: number; setThreat?: number; secondWindArmed?: boolean }) {
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
                ...(patch?.setThreat != null ? { threat: patch.setThreat } : {}),
                ...(patch?.secondWindArmed != null ? { secondWindArmed: patch.secondWindArmed } : {}),
                tiles,
            };
        });
    }
    function adoptServerEvent(result: Awaited<ReturnType<typeof resolveHollowGateServerEvent>>) {
        if (result.character && !onVersionedCharacter(result.character, result._saveVersion)) return false;
        if (result.runState) {
            markResolved({
                setKeys: result.runState.keys,
                setTorch: result.runState.torch,
                setThreat: result.runState.threat,
                secondWindArmed: result.runState.secondWindArmed,
            });
        } else {
            markResolved();
        }
        return true;
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
            return;
        }
        case "elite": {
            pushHollowGateLog(`[Elite] ${flavor}`);
            void startHollowGateBattle({ isElite: true, nodeId: `floor:${hollowGateRun.floor}:tile:${idx}` });
            return;
        }
        case "tile_game": {
            // Compatibility migration for runs saved before Tile Showdown was
            // retired. Do not resolve the old tile up front: convert it into the
            // same sealed Hollow Hound choice as every current combat node.
            pushHollowGateLog(`[Hollow Hound] ${flavor} The obsolete tile seal fractures, revealing claw marks beneath it.`);
            void startHollowGateBattle({ nodeId: `floor:${hollowGateRun.floor}:tile:${idx}` });
            return;
        }
        case "pet_battle": {
            pushHollowGateLog(`[Hollow Hound] ${flavor}`);
            void startHollowGateBattle({ isBeast: true, nodeId: `floor:${hollowGateRun.floor}:tile:${idx}` });
            return;
        }
        case "trap": {
            if (!hollowGateRun.runToken) return;
            void resolveHollowGateServerEvent({
                playerName: character.name,
                token: hollowGateRun.runToken,
                nodeId: `floor:${hollowGateRun.floor}:tile:${idx}`,
                action: "trap",
            }).then((result) => {
                if (!result.ok) return pushHollowGateLog(result.error || "The trap seal did not resolve.");
                if (!adoptServerEvent(result)) return;
                const damage = Math.max(0, Math.floor(result.damage ?? 0));
                if (result.revived) {
                    pushHollowGateLog(`${flavor} The trap's killing blow lands — then Second Wind restores half your HP.`);
                    setHollowGateEvent({ title: "Second Wind", body: "The stored Hollow Shards burst into violet flame and restore half your HP.", kind: "trap", choices: [{ label: "Press On", tone: "primary", onSelect: () => setHollowGateEvent(null) }] });
                } else if (result.ended) {
                    pushHollowGateLog(`${flavor} The seals tear ${damage} HP from you. You collapse and the server closes the run.`);
                    setHollowGateEvent({
                        title: "You Have Fallen",
                        body: `${flavor}\n\nThe trap drains your final breath. Your verified run ledger is reconciled and you are admitted to the village hospital.\n\n— RUN SUMMARY —\n${buildHollowGateRunSummary()}`,
                        kind: "trap",
                        choices: [{ label: "Leave Shrine", tone: "danger", onSelect: () => { setHollowGateEvent(null); leaveHollowGateShrine({ death: true }); } }],
                    });
                } else {
                    pushHollowGateLog(`${flavor} The seals tear ${damage} HP from you (33% of max).`);
                    setHollowGateEvent({ title: "Ancient Seal Trap", body: `${flavor}\n\nYou take ${damage} HP damage (33% of max).`, kind: "trap", choices: [{ label: "Press On", onSelect: () => setHollowGateEvent(null), tone: "primary" }] });
                }
            });
            return;
        }
        case "chest": {
            if (!hollowGateRun.runToken) return;
            void resolveHollowGateServerEvent({ playerName: character.name, token: hollowGateRun.runToken, nodeId: `floor:${hollowGateRun.floor}:tile:${idx}`, action: "chest" }).then((result) => {
                if (!result.ok) return pushHollowGateLog(result.error || "The chest seal did not resolve.");
                if (!adoptServerEvent(result)) return;
                const lines = hollowGateRewardLines(result.reward);
                const gainedKey = (result.runState?.keys ?? hollowGateRun.keys) > hollowGateRun.keys;
                pushHollowGateLog(`Chest opened. ${lines.join(", ")}${gainedKey ? ", +1 Shrine Key" : ""}, +2 Torch.`);
                setHollowGateEvent({
                    title: "Shrine Offering Chest",
                    body: `${flavor}\n\n${lines.join("\n")}${gainedKey ? "\n+1 Shrine Key" : ""}`,
                    kind: "chest",
                    choices: [{ label: "Continue", onSelect: () => setHollowGateEvent(null), tone: "primary" }],
                });
            });
            return;
        }
        case "shard_vein": {
            if (!hollowGateRun.runToken) return;
            void resolveHollowGateServerEvent({ playerName: character.name, token: hollowGateRun.runToken, nodeId: `floor:${hollowGateRun.floor}:tile:${idx}`, action: "shard-vein" }).then((result) => {
                if (!result.ok) return pushHollowGateLog(result.error || "The shard vein did not resolve.");
                if (!adoptServerEvent(result)) return;
                const gain = Math.max(0, Math.floor(result.reward?.currencies?.hollowShards ?? 0));
                pushHollowGateLog(`${flavor} You pry ${gain} Hollow Shards loose.`);
            });
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
                    ? `${floorProfile.petTrace}\n\n${pet.name} sniffs the air, then the trail fades into the dark.`
                    : `${floorProfile.petTrace}\n\nThe trail fades into the dark.`,
                kind: "pet_event",
                choices: [{ label: "Onward", onSelect: () => setHollowGateEvent(null), tone: "primary" }],
            });
            markResolved();
            return;
        }
        case "shrine": {
            const nodeId = `floor:${hollowGateRun.floor}:tile:${idx}`;
            if (!hollowGateRun.runToken) return;
            void resolveHollowGateServerEvent({
                playerName: character.name,
                token: hollowGateRun.runToken,
                nodeId,
                action: "shrine",
            }).then((result) => {
                if (!result.ok) return pushHollowGateLog(result.error || "The shrine seal did not answer.");
                if (!adoptServerEvent(result)) return;
                pushHollowGateLog(`${floorProfile.shrineTitle}: ${floorProfile.shrineRite} The Torch of Reiki flares to full.`);
                setHollowGateHiddenChamber({ searched: false, relicTaken: false, nodeId });
            });
            return;
        }
        case "story": {
            // Flavor only — story tiles teach you about the shrine. No rewards
            // (rewards come from chests, secret doors, and the Alpha Hound).
            pushHollowGateLog(flavor);
            setHollowGateEvent({
                title: floorProfile.storyTitle,
                body: `${floorProfile.storyEcho}\n\nYou study the engraving. The shrine watches.`,
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
                        onSelect: async () => {
                            if (!hollowGateRun.runToken) {
                                pushHollowGateLog("The staircase has no secure run seal. Use Emergency Forfeit and begin a fresh dive.");
                                return;
                            }
                            // The generator chunk is fetched BEFORE the server call,
                            // deliberately. descendHollowGateRun COMMITS the floor
                            // advance server-side and is not idempotent: once it has
                            // returned, a client-side failure leaves the client on
                            // floor N with the server on N+1, and re-clicking re-sends
                            // the now-stale fromFloor, which is rejected forever. Doing
                            // the load first means a dropped chunk fails while both
                            // sides still agree — and since the generator is pure and
                            // side-effect-free, this also overlaps the round-trip
                            // rather than adding to it.
                            const generator = await loadHollowGateGenerator().catch(() => null);
                            if (!generator) {
                                pushHollowGateLog("The shrine could not draw the floor below this one — the connection dropped mid-load. Nothing was spent; try the staircase again.");
                                return;
                            }
                            try {
                                await descendHollowGateRun({
                                    playerName: character.name,
                                    token: hollowGateRun.runToken,
                                    fromFloor: hollowGateRun.floor,
                                });
                            } catch (error) {
                                pushHollowGateLog(error instanceof Error ? error.message : "The staircase refuses to open.");
                                return;
                            }
                            // The run's variant rides along so an event gate keeps its
                            // shape (floors / board / boss) on every floor below.
                            const next = applyAttunementToRun(generator.generateHollowGateShrineRun(hollowGateRun.floor + 1, hollowGateRun.variant, hollowGateRun.serverSeed), character, false);
                            const sealed = await sealHollowGateFloor(character.name, hollowGateRun.runToken, next);
                            if (!sealed.ok) {
                                pushHollowGateLog(sealed.error || "The next floor could not be sealed. Retry the staircase.");
                                return;
                            }
                            setHollowGateRun({
                                ...next,
                                keys: hollowGateRun.keys,
                                torch: Math.min(10, hollowGateRun.torch + 4),
                                entryCurrencies: hollowGateRun.entryCurrencies,
                                runToken: hollowGateRun.runToken,
                                serverSeed: hollowGateRun.serverSeed,
                                augmentOffers: hollowGateRun.augmentOffers,
                                chosenAugment: hollowGateRun.chosenAugment,
                                secondWindArmed: hollowGateRun.secondWindArmed,
                                earnedXp: hollowGateRun.earnedXp,
                                earnedFragments: hollowGateRun.earnedFragments,
                                earnedVeils: hollowGateRun.earnedVeils,
                            });
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
            const resolveKeeper = async (action: "keeper-heal" | "keeper-torch" | "keeper-key", success: string) => {
                if (!hollowGateRun.runToken) return;
                const result = await resolveHollowGateServerEvent({ playerName: character.name, token: hollowGateRun.runToken, nodeId: `floor:${hollowGateRun.floor}:tile:${idx}`, action });
                if (!result.ok) return pushHollowGateLog(result.error || "The Shrine Keeper's seal did not answer.");
                if (!adoptServerEvent(result)) return;
                pushHollowGateLog(success);
                setHollowGateEvent(null);
            };
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
                            void resolveKeeper("keeper-heal", "The Shrine Keeper restores 33% of your maximum HP.");
                        },
                    }]),
                    {
                        label: "Refill Torch of Reiki",
                        onSelect: () => {
                            void resolveKeeper("keeper-torch", "The Shrine Keeper rekindles the Torch of Reiki to full.");
                        },
                    },
                    {
                        label: "Gift a Shrine Key",
                        onSelect: () => {
                            void resolveKeeper("keeper-key", "The Shrine Keeper presses a Shrine Key into your palm. +1 Shrine Key.");
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
                    const eventResult = await resolveHollowGateServerEvent({
                        playerName: character.name,
                        token: serverRunToken,
                        nodeId: `floor:${hollowGateRun.floor}:tile:${idx}`,
                        action: "locked-door",
                    });
                    const result = eventResult.lockedResult;
                    if (!eventResult.ok || !result) {
                        pushHollowGateLog("The sealed door did not answer. Your Shrine Key was not spent; try again.");
                        return;
                    }
                    if (!adoptServerEvent(eventResult)) return;
                    if (result.outcome === "chest") {
                        const lines = hollowGateRewardLines(eventResult.reward);
                        pushHollowGateLog(`Ancient Chest opened. ${lines.join(", ")}.`);
                        setHollowGateEvent({ title: "Ancient Chest", body: `Behind the chains, an ancient chest creaks open.\n\n${lines.join("\n")}`, kind: "chest", choices: [{ label: "Continue", onSelect: () => setHollowGateEvent(null), tone: "primary" }] });
                        return;
                    }
                    if (result.outcome === "trap") {
                        const damage = Math.max(0, Math.floor(eventResult.damage ?? 0));
                        pushHollowGateLog(`Trap behind the door! You take ${damage} HP damage.`);
                        setHollowGateEvent({ title: eventResult.ended ? "Cursed Trap Door" : eventResult.revived ? "Second Wind" : "Trap Door", body: eventResult.ended ? "The binding seal drains the last of your chakra. Your verified run ledger is reconciled and the run ends." : eventResult.revived ? "The cursed seal lands a killing blow, but Second Wind restores half your HP." : `Behind the chains, a cursed seal lashes out.\n\nYou take ${damage} HP damage.`, kind: "trap", choices: [{ label: eventResult.ended ? "Leave Shrine" : "Press On", tone: "danger", onSelect: () => { setHollowGateEvent(null); if (eventResult.ended) leaveHollowGateShrine({ death: true }); } }] });
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
                        body: `Behind the chains, a ${rarity} spirit-bound creature studies you.\n\n${encounter.name} - Lv. ${encounter.level}\nHP ${encounter.hp} | ATK ${encounter.attack} | DEF ${encounter.defense} | SPD ${encounter.speed}\n\nBefriend it? (Carried ${activeCarriedPets(character).length}/${maxPets(character)}; overflow rests in the Sanctuary)`,
                        kind: "pet_event",
                        choices: [{ label: `Befriend ${encounter.name}`, tone: "primary", onSelect: () => {
                            if (!requireServerSettlement("hollowGatePetBefriend")) return;
                            void befriendHollowGatePetServer(character.name, petToken).then((befriended) => {
                                if (!befriended.character) return alert(befriended.error || "The pet could not be befriended.");
                                if (!onVersionedCharacter(befriended.character, befriended.saveVersion)) return;
                                pushHollowGateLog(`${encounter.name} joined you!${befriended.trait ? ` Trait: ${befriended.trait}.` : ""}${befriended.destination === "sanctuary" ? " Your carried roster was full, so the companion is resting in the Sanctuary." : ""}`); setHollowGateEvent(null);
                            });
                        } }, { label: "Leave it", onSelect: () => setHollowGateEvent(null) }],
                    });
                })();
                return;
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
