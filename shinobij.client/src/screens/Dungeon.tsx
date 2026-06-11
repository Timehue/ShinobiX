/* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect, react-hooks/purity */
import { useState, useEffect, lazy, Suspense } from "react";
import type { Character } from "../types/character";
import type { Pet } from "../types/pet";
import { ShinobiTiles } from "../components/ShinobiTiles";
import { PetArenaCard } from "../components/PetBattleAvatar";
import { type TileCard } from "../data/tile-cards";
import { genericPetArenaOpponents } from "../data/pet-arena-opponents";
import { type ArenaTile } from "../lib/pet-tactics";
import { petFramePace, runPetArenaBattle } from "../lib/pet-battle-sim";
import { isPetOnExpedition, petDisplayName } from "../lib/pet";
import { primePetSfx } from "../lib/pet-sfx";
import { startBattleMusic } from "../lib/pet-music";
import { defaultVnPortrait, defaultVnScene } from "../lib/vn";
import { currentDateKey } from "../lib/utils";
import { rewardSummary } from "../lib/currency";
import { hiddenDungeonVnEvent } from "../data/vn-events";
import {
    PetArenaBattlefield,
    petTamerPveMultiplier,
    type CreatorEvent,
    type PetArenaFrame,
} from "../App";
import { petColiseumEnabled } from "../lib/pet-coliseum-flag";

// Cinematic HD-2D coliseum — lazy so three/r3f only load when the flag is on.
// The classic PetArenaBattlefield below stays intact as the fallback.
const PetColiseum = lazy(() => import("../components/PetColiseum").then((m) => ({ default: m.PetColiseum })));

export function DungeonEncounter({
    event,
    character,
    updateCharacter,
    creatorCards,
    editablePets,
    stage,
    lineIndex,
    setLineIndex,
    onStartAiFight,
    onTileWin,
    onPetWin,
    onLeave,
    sharedImages = {},
}: {
    event: CreatorEvent;
    character: Character;
    updateCharacter: (character: Character) => void;
    creatorCards: TileCard[];
    editablePets: Pet[];
    stage: "intro" | "tile" | "pet" | "complete";
    pageIndex: number;
    lineIndex: number;
    setPageIndex: (index: number | ((index: number) => number)) => void;
    setLineIndex: (index: number | ((index: number) => number)) => void;
    onStartAiFight: () => void;
    onTileWin: () => void;
    onPetWin: () => void;
    onLeave: () => void;
    sharedImages?: Record<string, string>;
}) {
    const pages = event.vnPages && event.vnPages.length > 0 ? event.vnPages : hiddenDungeonVnEvent.vnPages!;
    const stagePage = stage === "pet" ? 2 : stage === "tile" ? 1 : 0;
    const page = pages[Math.min(stagePage, pages.length - 1)];
    const pageDialogue = page.dialogue.length > 0 ? page.dialogue : event.dialogue;
    const activeLine = pageDialogue[lineIndex] ?? pageDialogue[0] ?? page.scene ?? "The dungeon waits.";
    const splitLine = activeLine.includes(":") ? activeLine.split(":") : [page.speaker || event.vnSpeaker || "Narrator", activeLine];
    const speaker = splitLine[0].trim();
    const spoken = splitLine.slice(1).join(":").trim() || activeLine;
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
    if (stage === "tile" && isLastLine) {
        return <ShinobiTiles character={character} updateCharacter={updateCharacter} creatorCards={creatorCards} dungeonMode onDungeonWin={onTileWin} onDungeonLeave={onLeave} dungeonSceneImage={adminTileScene} />;
    }
    if (stage === "pet" && isLastLine) {
        return <DungeonPetBattle character={character} updateCharacter={updateCharacter} editablePets={editablePets} onWin={onPetWin} onLeave={onLeave} sharedImages={sharedImages} dungeonPetImage={adminPet} />;
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
                    <div className="vn-character mentor-character">
                        {character.avatarImage
                            ? <img src={character.avatarImage} alt={character.name} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                            : null}
                        <span className="vn-character-initials">{character.name.slice(0, 2).toUpperCase()}</span>
                    </div>
                    {(() => {
                        const portrait = adminWarden || event.avatarImage || defaultVnPortrait(speaker);
                        if (!portrait && speaker.trim().toLowerCase() === "narrator") return null;
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
                    <span>Clear all 3 seals: {rewardSummary(event.xpReward, event.ryoReward, event.staminaReward, event.currencyRewards)}</span>
                </div>
            </div>
        </div>
    );
}

export function DungeonPetBattle({ character, updateCharacter, editablePets, onWin, onLeave, sharedImages = {}, enemyOverride, enemyOwner = "Dungeon Beast", dungeonPetImage }: { character: Character; updateCharacter: (character: Character) => void; editablePets: Pet[]; onWin: () => void; onLeave: () => void; sharedImages?: Record<string, string>; enemyOverride?: Pet; enemyOwner?: string; dungeonPetImage?: string }) {
    const defaultPetId = character.activePetId ?? character.pets[0]?.id ?? "";
    const [chosenPetId, setChosenPetId] = useState(defaultPetId);
    const selectedPet = character.pets.find((pet) => pet.id === chosenPetId) ?? character.pets[0];
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
    const [battleFrames, setBattleFrames] = useState<PetArenaFrame[]>([]);
    const [battleObstacles, setBattleObstacles] = useState<number[]>([]);
    const [battleTiles, setBattleTiles] = useState<ArenaTile[]>([]);
    const [frameIndex, setFrameIndex] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [result, setResult] = useState("");
    const currentFrame = battleFrames[frameIndex];
    useEffect(() => {
        if (!isPlaying) return;
        if (frameIndex >= battleFrames.length - 1) {
            setIsPlaying(false);
            return;
        }
        const timer = window.setTimeout(() => setFrameIndex((index) => Math.min(index + 1, battleFrames.length - 1)), petFramePace(battleFrames[frameIndex]));
        return () => window.clearTimeout(timer);
    }, [battleFrames.length, frameIndex, isPlaying]);
    function startBattle() {
        primePetSfx(); // unlock the audio context inside the click gesture
        startBattleMusic(); // rotate to a fresh battle track
        if (!selectedPet) return;
        if (isPetOnExpedition(selectedPet)) return alert(`${petDisplayName(selectedPet)} is exploring and cannot battle right now.`);
        const battle = runPetArenaBattle(selectedPet, enemyPet, enemyOwner, Date.now(), petTamerPveMultiplier(character));
        setBattleFrames(battle.frames);
        setBattleObstacles(battle.obstacles);
        setBattleTiles(battle.tiles ?? []);
        setFrameIndex(0);
        setIsPlaying(true);
        setResult(battle.result === "win" ? "Victory" : battle.result === "draw" ? "Draw" : "Defeat");
        if (battle.result === "win") updateCharacter({ ...character, totalPetWins: (character.totalPetWins ?? 0) + 1, dailyPetWins: (character.dailyPetWins ?? 0) + 1, lastDailyReset: currentDateKey() });
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
    if (!battleFrames.length) {
        return (
            <div className="card cinematic-card">
                <h2>Rare Beast Seal</h2>
                {character.pets.length > 1 && (
                    <div className="menu" style={{ marginBottom: "0.75rem" }}>
                        <label style={{ fontWeight: 600, marginRight: "0.5rem" }}>Choose your pet:</label>
                        <select value={chosenPetId} onChange={e => setChosenPetId(e.target.value)} style={{ padding: "4px 8px", borderRadius: 6 }}>
                            {character.pets.map(p => (
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
    // Both renderers consume the SAME frames/props — cinematic vs classic is a
    // pure presentation choice (shared flag with the Pet Arena toggle).
    const duelProps = {
        playerPet: selectedPet,
        enemyPet,
        enemyOwner,
        frame: currentFrame,
        recentFrames: battleFrames.slice(Math.max(0, frameIndex - 4), frameIndex + 1),
        // Gate the victory card to the final frame so it doesn't cover the
        // replay (movement, lunges, KO/faint) — mirrors the ranked arena's
        // showResult gate. Without this the card showed from frame 0.
        result: frameIndex >= battleFrames.length - 1 ? result : "",
        obstacles: battleObstacles,
        tiles: battleTiles,
        onReplay: () => { setBattleFrames([]); setResult(""); },
        onFightAgain: () => { setBattleFrames([]); setResult(""); },
        onExit: result === "Victory" ? onWin : onLeave,
        sharedImages,
    };
    return petColiseumEnabled() ? (
        <Suspense fallback={<div className="summary-box" style={{ padding: "2rem", textAlign: "center", color: "#94a3b8" }}>Loading 3D arena…</div>}>
            <PetColiseum {...duelProps} />
        </Suspense>
    ) : (
        <PetArenaBattlefield {...duelProps} />
    );
}

// Pets must reach this level before expeditions unlock. Training (and the
// loadout scaffold) stay available from level 1.
