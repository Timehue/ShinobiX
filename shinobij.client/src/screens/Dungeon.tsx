/* eslint-disable react-hooks/purity */
import { useState, useRef, lazy, Suspense } from "react";
import type { Character } from "../types/character";
import type { Pet } from "../types/pet";
import { CardClashDuel } from "./CardClashDuel";
import { PetArenaCard } from "../components/PetBattleAvatar";
import { type TileCard } from "../data/tile-cards";
import { genericPetArenaOpponents } from "../data/pet-arena-opponents";
import { type DuelResult } from "../lib/pet-duel-sim";
import { runPetDuelCinematic } from "../lib/pet-duel-cinematic";
import { createLiveDuel, type LiveDuel } from "../lib/pet-duel-live";
import { petPlayerControlEnabled } from "../lib/pet-coliseum-flag";
import { isPetOnExpedition, petDisplayName } from "../lib/pet";
import { primePetSfx } from "../lib/pet-sfx";
import { startBattleMusic } from "../lib/pet-music";
import { defaultVnPortrait, defaultVnScene, hidePlayerPortraitDuringNarration, splitDialogueLine } from "../lib/vn";
import { rewardSummary } from "../lib/currency";
import { hiddenDungeonVnEvent } from "../data/vn-events";
import { petPveHpMult, petAlphaBond } from "../lib/profession-mastery";
import { activeCarriedPets } from "../lib/entitlements";
import { isLivePetDuelAvailable } from "../lib/pet-duel-live-roster";
import {
    settleDungeonPetBattle,
    startDungeonPetBattle,
    type DungeonPetBattleSeal,
    type DungeonPetSettlement,
} from "../lib/dungeon-pet-authority";
import { resolveDungeonStage } from "../lib/dungeon-stage";
import {
    petTamerPveMultiplier,
    type CreatorEvent,
} from "../App";

// Continuous-duel renderer — the dungeon-duel arena. Lazy so three/r3f only
// load when a duel actually mounts.
const PetColiseumDuel = lazy(() => import("../components/PetColiseum").then((m) => ({ default: m.PetColiseumDuel })));

export function DungeonEncounter({
    event,
    character,
    creatorCards,
    dungeonRunToken,
    onVersionedCharacter,
    lineIndex,
    setLineIndex,
    onStartAiFight,
    onTileWin,
    onPetWin,
    onClaimReward,
    onLeave,
    sharedImages = {},
}: {
    event: CreatorEvent;
    character: Character;
    creatorCards: TileCard[];
    dungeonRunToken: string;
    onVersionedCharacter: (character: Character, saveVersion: number) => boolean;
    lineIndex: number;
    setLineIndex: (index: number | ((index: number) => number)) => void;
    onStartAiFight: () => void;
    onTileWin: () => void;
    onPetWin: () => void | Promise<void>;
    onClaimReward: () => void | Promise<void>;
    onLeave: () => void | Promise<void>;
    sharedImages?: Record<string, string>;
}) {
    const stage = resolveDungeonStage(character.activeDungeonRun);
    const pages = event.vnPages && event.vnPages.length > 0 ? event.vnPages : hiddenDungeonVnEvent.vnPages!;
    const stagePage = stage === "pet" ? 2 : stage === "tile" ? 1 : 0;
    const page = pages[Math.min(stagePage, pages.length - 1)];
    const pageDialogue = page.dialogue.length > 0 ? page.dialogue : event.dialogue;
    const activeLine = pageDialogue[lineIndex] ?? pageDialogue[0] ?? page.scene ?? "The dungeon waits.";
    const { speaker, text: spoken } = splitDialogueLine(activeLine, page.speaker || event.vnSpeaker || "Narrator");
    const hidePlayerPortrait = hidePlayerPortraitDuringNarration(speaker, "Player");
    // Admin-uploaded dungeon art (managed via the Relic Dungeons admin tab)
    // overlays the static event/page fallbacks. Each dungeon has 4 slots:
    // backdrop (VN scene), warden (boss portrait), tilescene (seal 2
    // banner), pet (seal 3 rare-beast portrait). Keys piggyback on the
    // existing `event:` category so no server prefix change is needed.
    const adminBackdrop = sharedImages[`event:${event.id}:backdrop`];
    const adminWarden = sharedImages[`event:${event.id}:warden`];
    const adminTileScene = sharedImages[`event:${event.id}:tilescene`];
    const adminPet = sharedImages[`event:${event.id}:pet`];
    const pageImage = adminBackdrop || page.image || event.image || defaultVnScene(event.id, event.biome);
    const canBack = lineIndex > 0;
    const isLastLine = lineIndex >= pageDialogue.length - 1;
    const actionLabel = stage === "intro" ? "Challenge Seal One" : stage === "tile" ? "Start Tile Seal" : "Challenge Rare Pet";
    function nextLine() {
        if (!isLastLine) setLineIndex((line) => line + 1);
    }
    if (stage === "complete") {
        return (
            <div className="card cinematic-card">
                <p className="act-label">HIDDEN DUNGEON</p>
                <h2>All seals verified</h2>
                <p>The Warden, Chronicle, and Rare Beast proofs are bound to this run. Claim the reserved reward now; if the request is interrupted, this screen remains recoverable.</p>
                <div className="menu">
                    <button className="admin-button" onClick={onClaimReward}>Claim Dungeon Reward</button>
                    <button className="danger-button" onClick={onLeave}>Abandon Dungeon</button>
                </div>
            </div>
        );
    }
    if (stage === "tile" && isLastLine) {
        return <CardClashDuel character={character} creatorCards={creatorCards} dungeonRunToken={dungeonRunToken} onVersionedCharacter={onVersionedCharacter} onDungeonWin={onTileWin} onDungeonLeave={onLeave} dungeonSceneImage={adminTileScene} />;
    }
    if (stage === "pet" && isLastLine) {
        return <DungeonRareBeastBattle key={dungeonRunToken} character={character} dungeonRunToken={dungeonRunToken} onVersionedCharacter={onVersionedCharacter} onWin={onPetWin} onLeave={onLeave} sharedImages={sharedImages} dungeonPetImage={adminPet} />;
    }
    return (
        <div className="card cinematic-card">
            <button className="danger-button" onClick={onLeave}>Leave Dungeon</button>
            <div className="visual-novel admin-vn-play">
                <div className="vn-header">
                    <div>
                        <p className="act-label">HIDDEN DUNGEON</p>
                        <h2>{page.title || event.vnTitle || event.name}</h2>
                    </div>
                    <div className="vn-progress">Seal {stagePage + 1}/3 | Line {lineIndex + 1}/{Math.max(1, pageDialogue.length)}</div>
                </div>
                <div className={"vn-stage vn-biome-" + event.biome + (pageImage ? " vn-has-image" : "")} style={pageImage ? { backgroundImage: `linear-gradient(180deg, rgba(7,12,27,.18), rgba(7,12,27,.78)), url(${pageImage})` } : undefined}>
                    <div className="vn-backdrop"><span className="vn-village-silhouette"></span></div>
                    {hidePlayerPortrait ? null : <div className="vn-character mentor-character">
                        {character.avatarImage
                            ? <img src={character.avatarImage} alt={character.name} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                            : null}
                        <span className="vn-character-initials">{character.name.slice(0, 2).toUpperCase()}</span>
                    </div>}
                    {(() => {
                        if (speaker.trim().toLowerCase() === "narrator") return null;
                        const portrait = adminWarden || event.avatarImage || defaultVnPortrait(speaker);
                        return (
                            <div className="vn-character hero-character">
                                {portrait
                                    ? <img src={portrait} alt={speaker} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                                    : null}
                                <span className="vn-character-initials">{speaker.trim().toLowerCase() === "narrator" ? "..." : (speaker.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase() || "DG")}</span>
                            </div>
                        );
                    })()}
                    <div className="vn-scene-card">{page.scene || event.vnScene || "A hidden dungeon opens underfoot."}</div>
                    <div className="vn-dialogue">
                        <div className="vn-speaker">{speaker}</div>
                        <p>{spoken}</p>
                        <div className="vn-controls">
                            <button disabled={!canBack} onClick={() => setLineIndex((line) => Math.max(0, line - 1))}>Back</button>
                            {!isLastLine ? <button onClick={nextLine}>Next</button> : <button className="admin-button" onClick={stage === "intro" ? onStartAiFight : () => setLineIndex((line) => line)}>{actionLabel}</button>}
                        </div>
                    </div>
                </div>
                <div className="vn-reward-strip">
                    <span>Requires Level {event.levelReq}</span>
                    <span>Clear all 3 seals: {rewardSummary(event.ryoReward, event.staminaReward, event.currencyRewards)}</span>
                </div>
            </div>
        </div>
    );
}

type DungeonPetTerminalPayload = Readonly<{
    seal: DungeonPetBattleSeal;
    reportedOutcome: "win" | "loss" | "draw";
    inputLog?: unknown;
}>;

function restoreDungeonPetCosmetics(sealed: Pet, local: Pet | undefined, image?: string): Pet {
    return {
        ...sealed,
        ...(image || local?.image ? { image: image || local?.image } : {}),
        ...(local?.bodyImage ? { bodyImage: local.bodyImage } : {}),
    };
}

function snapshotDungeonInputLog(value: unknown): unknown {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value)) as unknown;
}

/** Reward-bearing Rare Beast seal. Combat presentation remains cinematic/live,
 * while encounter identity, opponent, replay verdict, and parent proof are all
 * owned by the server's pet-cinematic authority. */
export function DungeonRareBeastBattle({
    character,
    dungeonRunToken,
    onVersionedCharacter,
    onWin,
    onLeave,
    sharedImages = {},
    dungeonPetImage,
}: {
    character: Character;
    dungeonRunToken: string;
    onVersionedCharacter: (character: Character, saveVersion: number) => boolean;
    onWin: () => void | Promise<void>;
    onLeave: () => void | Promise<void>;
    sharedImages?: Record<string, string>;
    dungeonPetImage?: string;
}) {
    const eligiblePets = activeCarriedPets<Pet>(character)
        .filter((pet) => isLivePetDuelAvailable(pet, character.petBreeding));
    const defaultPetId = eligiblePets.find((pet) => pet.id === character.activePetId)?.id ?? eligiblePets[0]?.id ?? "";
    const [chosenPetId, setChosenPetId] = useState(defaultPetId);
    const selectedPet = eligiblePets.find((pet) => pet.id === chosenPetId) ?? eligiblePets[0];
    const [battle, setBattle] = useState<{
        seal: DungeonPetBattleSeal;
        result: DuelResult | null;
        live: LiveDuel | null;
        playerPet: Pet;
        opponentPet: Pet;
        id: number;
    } | null>(null);
    const [startBusy, setStartBusy] = useState(false);
    const [error, setError] = useState("");
    const [settlementStatus, setSettlementStatus] = useState<"idle" | "pending" | "error" | "settled">("idle");
    const [recoveryOnly, setRecoveryOnly] = useState(false);
    const battleId = useRef(0);
    const terminalPayload = useRef<DungeonPetTerminalPayload | null>(null);
    const settlementPromise = useRef<Promise<DungeonPetSettlement> | null>(null);
    const routed = useRef(false);

    function routeTerminal(outcome: DungeonPetSettlement["outcome"]) {
        if (routed.current) return;
        routed.current = true;
        if (outcome === "win") void onWin();
        else void onLeave();
    }

    function submitTerminal(payload: DungeonPetTerminalPayload): Promise<DungeonPetSettlement> {
        terminalPayload.current = payload;
        if (settlementPromise.current) return settlementPromise.current;
        setSettlementStatus("pending");
        setError("");
        const task = settleDungeonPetBattle({
            playerName: character.name,
            seal: payload.seal,
            reportedOutcome: payload.reportedOutcome,
            inputLog: payload.inputLog,
        }).then((settled) => {
            if (!onVersionedCharacter(settled.character, settled.saveVersion)) {
                throw new Error("The Dungeon result belongs to a no-longer-active save session.");
            }
            setSettlementStatus("settled");
            return settled;
        }).catch((cause: unknown) => {
            settlementPromise.current = null;
            setSettlementStatus("error");
            setError(cause instanceof Error ? cause.message : "Dungeon pet verification paused.");
            throw cause;
        });
        settlementPromise.current = task;
        return task;
    }

    function reportOutcome(result: DuelResult) {
        if (!battle || terminalPayload.current) return;
        const payload = Object.freeze({
            seal: battle.seal,
            reportedOutcome: result.result,
            inputLog: snapshotDungeonInputLog(battle.live?.inputLog()),
        });
        void submitTerminal(payload).catch(() => undefined);
    }

    async function retrySettlement() {
        const payload = terminalPayload.current;
        if (!payload) return;
        try {
            const settled = await submitTerminal(payload);
            if (recoveryOnly) routeTerminal(settled.outcome);
        } catch { /* the retry card keeps the exact sealed payload available */ }
    }

    async function exitBattle() {
        setRecoveryOnly(true);
        const payload = terminalPayload.current;
        if (!payload) return;
        try {
            const settled = await (settlementPromise.current ?? submitTerminal(payload));
            routeTerminal(settled.outcome);
        } catch { /* fail closed on the retry card; never abandon an unrecorded result */ }
    }

    async function startBattle() {
        if (!selectedPet || startBusy) return;
        primePetSfx();
        setStartBusy(true);
        setError("");
        setSettlementStatus("idle");
        terminalPayload.current = null;
        settlementPromise.current = null;
        routed.current = false;
        try {
            const seal = await startDungeonPetBattle({
                playerName: character.name,
                playerPetId: selectedPet.id,
                dungeonRunToken,
            });
            const playerPet = restoreDungeonPetCosmetics(seal.playerPet, selectedPet);
            const opponentPet = restoreDungeonPetCosmetics(seal.opponentPet, undefined, dungeonPetImage);
            const config = seal.battleConfig;
            const controlled = petPlayerControlEnabled();
            const live = controlled
                ? createLiveDuel(playerPet, opponentPet, seal.seed, config.damageMult, config.hpMult, config.revive, config.applyItems, config.accuracy, config.terrain)
                : null;
            const result = controlled
                ? null
                : runPetDuelCinematic(playerPet, opponentPet, seal.seed, config.damageMult, config.hpMult, config.revive, config.applyItems, config.accuracy, config.terrain);
            const next = { seal, result, live, playerPet, opponentPet, id: ++battleId.current };
            setBattle(next);
            if (result) {
                const payload = Object.freeze({ seal, reportedOutcome: result.result });
                terminalPayload.current = payload;
                void submitTerminal(payload).catch(() => undefined);
            }
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "The Dungeon Rare Beast seal is unavailable.");
        } finally {
            setStartBusy(false);
        }
    }

    if (!selectedPet) {
        return <div className="card cinematic-card"><h2>Rare Beast Seal</h2><p className="hint">Every carried pet is busy, training, breeding, or awaiting an expedition claim.</p><button className="danger-button" onClick={onLeave}>Leave Dungeon</button></div>;
    }
    if (recoveryOnly && settlementStatus === "error") {
        return (
            <div className="card cinematic-card" role="alert">
                <h2>Rare Beast proof paused</h2>
                <p>{error || "Your completed duel remains sealed and safe to retry."}</p>
                <button className="admin-button" onClick={() => { void retrySettlement(); }}>Retry Dungeon Settlement</button>
            </div>
        );
    }
    if (!battle) {
        return (
            <div className="card cinematic-card">
                <h2>Rare Beast Seal</h2>
                {eligiblePets.length > 1 && <div className="menu" style={{ marginBottom: "0.75rem" }}><label style={{ fontWeight: 600, marginRight: "0.5rem" }}>Choose your pet:</label><select value={chosenPetId} onChange={(event) => setChosenPetId(event.target.value)}><option value="">Choose…</option>{eligiblePets.map((pet) => <option key={pet.id} value={pet.id}>{petDisplayName(pet)} (Lv {pet.level} · {pet.rarity})</option>)}</select></div>}
                <div className="pet-arena-grid"><PetArenaCard owner="You" pet={selectedPet} sharedImages={sharedImages} /><div className="pet-arena-card"><p className="act-label">SERVER-SEALED OPPONENT</p><h3>Dungeon Rare Beast</h3><p className="hint">Species, stats, seed, and outcome are revealed only by the combat authority.</p></div></div>
                {error && <p role="alert" className="hint">{error}</p>}
                <div className="menu"><button className="admin-button" disabled={startBusy} onClick={() => { void startBattle(); }}>{startBusy ? "Sealing…" : "Start Pet Battle"}</button><button className="danger-button" disabled={startBusy} onClick={onLeave}>Leave Dungeon</button></div>
            </div>
        );
    }
    return (
        <Suspense fallback={<div className="summary-box" style={{ padding: "2rem", textAlign: "center", color: "#94a3b8" }}>Loading the arena…</div>}>
            <PetColiseumDuel
                key={battle.id}
                playerPet={battle.playerPet}
                enemyPet={battle.opponentPet}
                seed={battle.seal.seed}
                result={battle.result ?? undefined}
                live={battle.live ?? undefined}
                onOutcome={reportOutcome}
                sharedImages={sharedImages}
                settlementStatus={settlementStatus}
                onRetrySettlement={() => { void retrySettlement(); }}
                settlementCopy={{ pending: "Sealing the Dungeon Rare Beast result…", error: error || "Dungeon verification paused. Your completed duel is safe to retry.", retry: "Retry Dungeon Settlement", settledExit: "Return to Dungeon" }}
                onExit={() => { void exitBattle(); }}
            />
        </Suspense>
    );
}

export function DungeonPetBattle({ character, updateCharacter: _updateCharacter, editablePets, onWin, onLeave, sharedImages = {}, enemyOverride, enemyOwner = "Dungeon Beast", dungeonPetImage }: { character: Character; updateCharacter: (character: Character) => void; editablePets: Pet[]; onWin: () => void | Promise<void>; onLeave: () => void | Promise<void>; sharedImages?: Record<string, string>; enemyOverride?: Pet; enemyOwner?: string; dungeonPetImage?: string }) {
    const eligiblePets = activeCarriedPets<Pet>(character);
    const defaultPetId = eligiblePets.find((pet) => pet.id === character.activePetId)?.id ?? eligiblePets[0]?.id ?? "";
    const [chosenPetId, setChosenPetId] = useState(defaultPetId);
    const selectedPet = eligiblePets.find((pet) => pet.id === chosenPetId) ?? eligiblePets[0];
    const rarePool = editablePets.filter((pet) => pet.rarity === "rare" || pet.rarity === "legendary" || pet.rarity === "mythic");
    const basePet = rarePool[Math.floor(Math.random() * Math.max(1, rarePool.length))] ?? genericPetArenaOpponents[2].pet;
    const [enemyPet] = useState<Pet>(() => enemyOverride ?? ({
        ...basePet,
        id: `dungeon-pet-${Date.now()}`,
        name: basePet.name || "Dungeon Rare Beast",
        // Admin-uploaded dungeon-specific rare-beast art overrides the
        // random rare pet's image (lore-aware boss portrait), while all
        // other stats stay rolled from the random pet so combat behavior
        // is unchanged.
        image: dungeonPetImage || basePet.image,
        rarity: "rare",
        level: Math.max(55, basePet.level + 25),
        hp: Math.max(900, Math.floor(basePet.hp * 2.1)),
        attack: Math.max(110, Math.floor(basePet.attack * 1.9)),
        defense: Math.max(100, Math.floor(basePet.defense * 1.8)),
        speed: Math.max(90, Math.floor(basePet.speed * 1.6)),
        trait: basePet.trait ?? "Battleborn",
    }));
    // The Rare Beast Seal is a PLAYER-CONTROLLED duel
    // (docs/pet-coliseum-player-control-plan.md): the fight runs live behind the
    // command deck, so its outcome is not known until the player has played it.
    // Hollow Gate is pure client-side PvE with no server re-sim, so it can command
    // freely. Flag off → the precomputed cinematic duel, watched as before.
    const [duelBattle, setDuelBattle] = useState<{
        result: DuelResult | null; live: LiveDuel | null;
        playerPet: Pet; enemyPet: Pet; seed: number; id: number;
    } | null>(null);
    const [duelNonce, setDuelNonce] = useState(0); // monotonic per-fight React key (state, not ref → no render-time ref read)
    // A ref, not state: onExit fires in the same tick as onOutcome (an exit-forfeit
    // settles then leaves), so a state write would still be stale when it reads it.
    const duelOutcome = useRef<"win" | "loss" | "draw" | null>(null);
    function startBattle() {
        primePetSfx(); // unlock the audio context inside the click gesture
        startBattleMusic(); // rotate to a fresh battle track
        if (!selectedPet) return;
        if (isPetOnExpedition(selectedPet)) return alert(`${petDisplayName(selectedPet)} is exploring and cannot battle right now.`);
        const seed = Date.now();
        const nextDuelId = duelNonce + 1;
        duelOutcome.current = null;
        const dmg = petTamerPveMultiplier(character), hp = petPveHpMult(character), revive = petAlphaBond(character);
        const controlled = petPlayerControlEnabled();
        setDuelNonce(nextDuelId);
        setDuelBattle({
            result: controlled ? null : runPetDuelCinematic(selectedPet, enemyPet, seed, dmg, hp, revive, true, undefined, null),
            live: controlled ? createLiveDuel(selectedPet, enemyPet, seed, dmg, hp, revive, true, undefined, null) : null,
            playerPet: selectedPet, enemyPet, seed, id: nextDuelId,
        });
    }
    if (!selectedPet) {
        return (
            <div className="card cinematic-card">
                <h2>Rare Beast Seal</h2>
                <p className="hint">You need at least one pet to complete this seal.</p>
                <button className="danger-button" onClick={onLeave}>Leave Dungeon</button>
            </div>
        );
    }
    if (isPetOnExpedition(selectedPet)) {
        return <div className="card cinematic-card"><h2>Rare Beast Seal</h2><p className="hint">{petDisplayName(selectedPet)} is away exploring. Choose another pet in the Pet Yard or wait for it to return.</p><button className="danger-button" onClick={onLeave}>Leave Dungeon</button></div>;
    }
    if (!duelBattle) {
        return (
            <div className="card cinematic-card">
                <h2>Rare Beast Seal</h2>
                {eligiblePets.length > 1 && (
                    <div className="menu" style={{ marginBottom: "0.75rem" }}>
                        <label style={{ fontWeight: 600, marginRight: "0.5rem" }}>Choose your pet:</label>
                        <select value={chosenPetId} onChange={e => setChosenPetId(e.target.value)} style={{ padding: "4px 8px", borderRadius: 6 }}>
                            {eligiblePets.map(p => (
                                <option key={p.id} value={p.id}>{p.nickname ?? p.name} (Lv {p.level} · {p.rarity})</option>
                            ))}
                        </select>
                    </div>
                )}
                <div className="pet-arena-grid">
                    <PetArenaCard owner="You" pet={selectedPet} sharedImages={sharedImages} />
                    <PetArenaCard owner={enemyOwner} pet={enemyPet} sharedImages={sharedImages} />
                </div>
                <div className="menu">
                    <button className="admin-button" onClick={startBattle}>Start Pet Battle</button>
                    <button className="danger-button" onClick={onLeave}>Leave Dungeon</button>
                </div>
            </div>
        );
    }
    // duelBattle is set (the !duelBattle gate above returned the pre-battle card).
    // Exiting after a win advances the seal (onWin), otherwise it leaves the
    // dungeon. A commanded fight has no result until it is played, so the branch
    // reads the settled outcome the renderer hands back — and an exit-forfeit
    // reports a loss, so quitting a losing seal can never advance it.
    return (
        <Suspense fallback={<div className="summary-box" style={{ padding: "2rem", textAlign: "center", color: "#94a3b8" }}>Loading the arena…</div>}>
            <PetColiseumDuel
                key={duelBattle.id}
                playerPet={duelBattle.playerPet}
                enemyPet={duelBattle.enemyPet}
                seed={duelBattle.seed}
                result={duelBattle.result ?? undefined}
                live={duelBattle.live ?? undefined}
                onOutcome={(r) => { duelOutcome.current = r.result; }}
                sharedImages={sharedImages}
                onFightAgain={() => startBattle()}
                onExit={() => ((duelOutcome.current ?? duelBattle.result?.result) === "win" ? onWin() : onLeave())}
            />
        </Suspense>
    );
}

// Pets must reach this level before expeditions unlock. Training (and the
// loadout scaffold) stay available from level 1.
