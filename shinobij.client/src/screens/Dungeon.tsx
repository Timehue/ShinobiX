import "../styles/pet-battle-theme.css";
import { useState, useCallback, useRef, useEffect, useMemo, lazy, Suspense } from "react";
import type { Character } from "../types/character";
import type { Pet } from "../types/pet";
import { CardClashDuel } from "./CardClashDuel";
import { PetArenaCard } from "../components/PetBattleAvatar";
import { type TileCard } from "../data/tile-cards";
import { isPetOnExpedition, petDisplayName } from "../lib/pet";
import { primePetSfx } from "../lib/pet-sfx";
import { startBattleMusic } from "../lib/pet-music";
import { applyVnTextVars, vnTextVarsFor, defaultVnScene, hidePlayerPortraitDuringNarration, splitDialogueLine, vnSceneCaption } from "../lib/vn";
import { rewardSummary } from "../lib/currency";
import { hiddenDungeonVnEvent } from "../data/vn-events";
import { CinematicVisualNovelStage } from "../components/CinematicVisualNovelStage";
import { activeCarriedPets } from "../lib/entitlements";
import { resolveDungeonStage } from "../lib/dungeon-stage";
import { resolveDungeonSpeakerPortrait } from "../lib/ai-fight-art";
import { useVerifiedSharedArt, useVnArtwork } from '../lib/useVnArtwork';
import { overlayVnImages } from '../lib/vn-shared-artwork';
import { resolveVnPresentation } from '../lib/vn-presentation';
import { isLowEndMobile, prefersReducedMotion } from '../lib/device-tier';
import { claimVnAction } from '../lib/vn-action-gate';
import {
    startAuthoredEncounter,
    submitShowdownTurn,
    forfeitShowdown,
    type ShowdownCommand,
    type ShowdownEncounterRef,
    type ShowdownStateView,
} from "../lib/pet-showdown-api";
import { type CreatorEvent } from "../App";

// The turn-based battle. Lazy so three/r3f only load when a fight actually
// mounts — the same deal the continuous-duel renderer had before it.
const PetShowdownBattle = lazy(() => import("../components/PetShowdownBattle").then((m) => ({ default: m.PetShowdownBattle })));

export function DungeonEncounter({
    event: sourceEvent,
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
    /** The server-minted dungeon run token. Seal 3's opponent is derived from
     *  it server-side, so this is the whole identity of the encounter. */
    dungeonRunToken: string;
    onVersionedCharacter: (character: Character, saveVersion: number) => boolean;
    // No `stage` / `pageIndex` props: both are derived below from
    // `character.activeDungeonRun` via resolveDungeonStage, which reads the run
    // itself rather than trusting a caller to say which seal you are on.
    lineIndex: number;
    setLineIndex: (index: number | ((index: number) => number)) => void;
    onStartAiFight: () => void;
    onTileWin: () => void;
    onPetWin: () => void | Promise<void>;
    onClaimReward: () => void | Promise<void>;
    onLeave: () => void | Promise<void>;
    sharedImages?: Record<string, string>;
}) {
    // Both derivations below scan every shared image key. They are pure in their
    // inputs, so keep them across the parent's once-a-second regen re-renders.
    const overlaidEvent = useMemo(() => overlayVnImages(sourceEvent, sourceEvent.id, sharedImages), [sourceEvent, sharedImages]);
    const event = useVnArtwork(overlaidEvent);
    // Page portraits have already been hydrated and verified above. Feeding raw
    // positional slots back to the resolver would resurrect a retired image.
    const dedicatedImages = useMemo(
        () => Object.fromEntries(Object.entries(sharedImages).filter(([id]) => !id.startsWith(`vn:${event.id}:page:`))),
        [event.id, sharedImages],
    );
    const stage = resolveDungeonStage(character.activeDungeonRun);
    const pages = event.vnPages && event.vnPages.length > 0 ? event.vnPages : hiddenDungeonVnEvent.vnPages!;
    const stagePage = stage === "pet" ? 2 : stage === "tile" ? 1 : 0;
    const page = pages[Math.min(stagePage, pages.length - 1)];
    const pageDialogue = page.dialogue.length > 0 ? page.dialogue : event.dialogue;
    const activeLine = pageDialogue[lineIndex] ?? pageDialogue[0] ?? (vnSceneCaption(page.scene) || "The dungeon waits.");
    const textVars = vnTextVarsFor(character);
    const parsedLine = page.lines?.[lineIndex] ?? splitDialogueLine(activeLine, page.speaker || event.vnSpeaker || "Narrator");
    const speaker = applyVnTextVars(parsedLine.speaker, textVars);
    const spoken = applyVnTextVars(parsedLine.text, textVars);
    const playerAvatar = sharedImages['avatar:' + character.name.trim().toLowerCase()] || character.avatarImage || '';
    const speakerKey = speaker.trim().toLowerCase();
    const playerSpeaking = ['player', character.name.trim().toLowerCase()].includes(speakerKey);
    const pageActor = page.rightName?.toLowerCase() === 'player' ? page.leftName : page.rightName;
    const actorName = playerSpeaking || speakerKey === 'narrator' ? pageActor || page.speaker || 'Narrator' : speaker;
    const actorImage = resolveDungeonSpeakerPortrait(event, actorName, dedicatedImages, page) || '';
    // Admin-uploaded dungeon art (managed via the Relic Dungeons admin tab)
    // overlays the static event/page fallbacks. Each dungeon has 4 slots:
    // backdrop (VN scene), warden (boss portrait), tilescene (seal 2
    // banner), pet (seal 3 rare-beast portrait). Keys piggyback on the
    // existing `event:` category so no server prefix change is needed.
    const adminBackdrop = useVerifiedSharedArt(event.id, sharedImages[`event:${event.id}:backdrop`]);
    const adminTileScene = sharedImages[`event:${event.id}:tilescene`];
    const adminPet = sharedImages[`event:${event.id}:pet`];
    const presentation = resolveVnPresentation({ event, page, pageIndex: stagePage, lineIndex, speaker,
        speakingSide: playerSpeaking ? 'left' : speakerKey === 'narrator' ? null : 'right',
        pageImage: page.image || event.image || defaultVnScene(event.id, event.biome),
        reducedMotion: prefersReducedMotion(), liteFx: isLowEndMobile() });
    // Seal two has its own authored altar. The entrance backdrop must not replace
    // every room; dedicated tile art also stays consistent with the card battle.
    const stageBackdrop = stage === 'tile' ? adminTileScene : stage === 'intro' ? adminBackdrop : undefined;
    const canBack = lineIndex > 0;
    const isLastLine = lineIndex >= pageDialogue.length - 1;
    const actionLabel = stage === "intro" ? "Challenge Seal One" : stage === "tile" ? "Start Chronicle Seal" : "Challenge rare pet";
    const [encounter, setEncounter] = useState<{ token: string; stage: string } | null>(null);
    const actionLocked = useRef(false);
    useEffect(() => { actionLocked.current = false; }, [dungeonRunToken, stage, lineIndex]);
    function nextLine() {
        if (!isLastLine && claimVnAction(actionLocked)) setLineIndex((line) => Math.min(pageDialogue.length - 1, line + 1));
    }
    function startSeal() {
        if (!isLastLine || !claimVnAction(actionLocked)) return;
        if (stage === 'intro') onStartAiFight();
        else setEncounter({ token: dungeonRunToken, stage });
    }
    // A server proof can arrive before the battle replay/result has finished.
    // Keep its host mounted until the player exits it, then open the next seal
    // at its first line. The proof still exclusively determines that next seal.
    if (encounter?.token === dungeonRunToken && encounter.stage === 'tile') {
        return <CardClashDuel character={character} creatorCards={creatorCards} dungeonRunToken={dungeonRunToken}
            onVersionedCharacter={onVersionedCharacter} onDungeonWin={() => {
                setEncounter(null); setLineIndex(0); onTileWin();
            }} onDungeonLeave={onLeave} dungeonSceneImage={adminTileScene} />;
    }
    if (encounter?.token === dungeonRunToken && encounter.stage === 'pet') {
        return <DungeonRareBeastBattle key={dungeonRunToken} character={character} dungeonRunToken={dungeonRunToken}
            onVersionedCharacter={onVersionedCharacter} onWin={() => {
                setEncounter(null); setLineIndex(0); return onPetWin();
            }} onLeave={onLeave} sharedImages={sharedImages} dungeonPetImage={adminPet} />;
    }
    if (stage === "complete") {
        return (
            <div className="card cinematic-card">
                <p className="act-label">HIDDEN DUNGEON</p>
                <h2>All three trials complete</h2>
                <p>“You cleared all three trials. Your reward is ready. I need to prepare for the next challenger.”</p>
                <p>You defeated the Warden, won the Chronicle Showdown, and beat the Rare Beast. Claim your dungeon reward below. If the claim is interrupted, reopen this dungeon to check it.</p>
                <div className="menu vn-decision-controls">
                    <button className="danger-button" onClick={onLeave}>Abandon dungeon</button>
                    <button className="admin-button" onClick={onClaimReward}>Claim dungeon reward</button>
                </div>
            </div>
        );
    }
    return (
        <CinematicVisualNovelStage
            eventId={event.id}
            eventLabel={`Hidden relic vault · ${event.biome}`}
            pageTitle={page.title || event.vnTitle || event.name}
            scene={vnSceneCaption(page.scene, event.vnScene) || 'A hidden dungeon opens underfoot.'}
            speaker={speaker} spoken={spoken}
            pageIndex={stagePage} pageCount={3} progressLabel="Seal"
            lineIndex={lineIndex} lineCount={Math.max(1, pageDialogue.length)}
            left={{ name: 'Player', image: playerAvatar, initials: character.name.slice(0, 2).toUpperCase(),
                player: true, speaking: playerSpeaking, hidden: !playerAvatar || hidePlayerPortraitDuringNarration(speaker, 'Player') }}
            right={{ name: actorName, image: actorImage, initials: actorName.split(' ').map(part => part[0]).join('').slice(0, 2),
                speaking: speakerKey === actorName.trim().toLowerCase(), hidden: !actorImage }}
            presentation={{ ...presentation, ...(stageBackdrop ? { backgroundImage: stageBackdrop } : {}) }}
            allowStageAdvance={!isLastLine}
            onAdvance={nextLine} onCancel={onLeave} cancelLabel="Leave"
            renderFooter={(typingDone) => <div className="cvn-dungeon-footer">
                <p className="cvn-dungeon-reward">Level {event.levelReq} · Clear all 3 seals: {rewardSummary(event.ryoReward, event.staminaReward, event.currencyRewards)}</p>
                {typingDone && <div className="vn-controls">
                    <button disabled={!canBack} onClick={() => {
                        if (claimVnAction(actionLocked)) setLineIndex(line => Math.max(0, line - 1));
                    }}>Back</button>
                    {!isLastLine ? <button onClick={nextLine}>Next</button> : <button onClick={startSeal}>{actionLabel}</button>}
                </div>}
            </div>}
        />
    );
}

/** Rare Beast combat uses the server command arena and its exact parent receipt. */
export function DungeonRareBeastBattle({ character, dungeonRunToken, onVersionedCharacter, onWin, onLeave, sharedImages = {}, dungeonPetImage }: {
    character: Character; dungeonRunToken: string;
    onVersionedCharacter: (character: Character, saveVersion: number) => boolean;
    onWin: () => void | Promise<void>; onLeave: () => void | Promise<void>;
    sharedImages?: Record<string, string>; dungeonPetImage?: string;
}) {
    return <DungeonPetBattle character={character} encounter={{ kind: "dungeon-seal", runToken: dungeonRunToken }}
        onVersionedCharacter={onVersionedCharacter} onWin={onWin} onLeave={onLeave}
        sharedImages={sharedImages} dungeonPetImage={dungeonPetImage} />;
}
/**
 * Every admin-authored VN pet encounter.
 *
 * These were among the last fights running a client-local duel sim. They now run
 * the same server-authoritative Showdown engine as the Coliseum, entered through
 * /api/pet/showdown's AUTHORED entry: the client sends a selector — the event id
 * plus the authored (petId, difficulty) pair naming the choice — and the SERVER
 * builds the opponent from its own copy of the authored content. Nothing about
 * the beast is decided here anymore, which is exactly why the port was possible.
 *
 * The Rare Beast Seal uses this renderer with an exact server-bound Dungeon
 * command session. Its terminal response commits the parent proof before the
 * client can advance the seal; ordinary story encounters remain unpaid.
 *
 * The reward contract is unchanged, deliberately. The bout pays nothing; it
 * decides an OUTCOME, and `onWin` still advances the seal / completes the event
 * so the dungeon run's own settle endpoint and the event's completion stay the
 * only things that grant anything.
 */
export function DungeonPetBattle({ character, onWin, onLeave, onVersionedCharacter, sharedImages = {}, encounter, enemyOwner = "Dungeon Beast", dungeonPetImage }: { character: Character; onWin: () => void | Promise<void>; onLeave: () => void | Promise<void>; onVersionedCharacter?: (character: Character, saveVersion: number) => boolean; sharedImages?: Record<string, string>; encounter: ShowdownEncounterRef; enemyOwner?: string; dungeonPetImage?: string }) {
    const eligiblePets = activeCarriedPets<Pet>(character);
    const defaultPetId = eligiblePets.find((pet) => pet.id === character.activePetId)?.id ?? eligiblePets[0]?.id ?? "";
    const [chosenPetId, setChosenPetId] = useState(defaultPetId);
    const selectedPet = eligiblePets.find((pet) => pet.id === chosenPetId) ?? eligiblePets[0];
    const [starting, setStarting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [battle, setBattle] = useState<{ state: ShowdownStateView; key: number } | null>(null);
    const battleKey = useRef(1);
    // A ref, not state: onExit can fire in the same tick as onFinished (an
    // exit-forfeit settles then leaves), so a state write would still be stale
    // when it is read.
    const outcome = useRef<"win" | "loss" | null>(null);

    async function startBattle() {
        if (!selectedPet || starting) return;
        if (isPetOnExpedition(selectedPet)) {
            setError(`${petDisplayName(selectedPet)} is exploring and cannot battle right now.`);
            return;
        }
        primePetSfx(); // unlock the audio context inside the click gesture
        startBattleMusic(); // rotate to a fresh battle track
        setStarting(true);
        setError(null);
        const result = await startAuthoredEncounter(character.name, selectedPet.id, encounter);
        if ("error" in result) {
            setStarting(false);
            setError(result.error);
            return;
        }
        if (result.character && result._saveVersion !== undefined
            && onVersionedCharacter && !onVersionedCharacter(result.character as Character, result._saveVersion)) {
            setStarting(false); setError("Reopen the Dungeon to recover its recorded battle."); return;
        }
        if ('completed' in result) { setStarting(false); outcome.current = 'win'; void onWin(); return; }
        // Reopening adopts the sealed lead, even if the picker changed meanwhile.
        const sealedPet = eligiblePets.find(pet => pet.id === result.state.player[0]?.id) ?? selectedPet;
        setChosenPetId(sealedPet.id);
        // The sealed beast is only named by the response, so its model can only
        // be warmed here — and the renderer suspends an unwarmed one into
        // nothing rather than a placeholder. Imported dynamically to match the
        // lazy PetShowdownBattle above: this screen keeps three/drei out of its
        // eager chunk, and a static import here would undo that.
        await import("../lib/pet-model-preload")
            // Use the same eligible sealed lead as the renderer, including resumes.
            .then((m) => m.warmShowdownModels(result.state, [sealedPet]))
            .catch(() => undefined);
        setStarting(false);
        outcome.current = null;
        setBattle({ state: result.state, key: battleKey.current++ });
    }

    const sessionId = battle?.state.sessionId ?? null;
    const submitTurn = useCallback(
        async (commands: ShowdownCommand[], expectedRound: number) => {
            if (!sessionId) return null;
            const result = await submitShowdownTurn(character.name, sessionId, commands, expectedRound);
            if (result && 'state' in result && result.character && result._saveVersion !== undefined
                && onVersionedCharacter && !onVersionedCharacter(result.character as Character, result._saveVersion)) return null;
            return result;
        },
        [character.name, sessionId, onVersionedCharacter],
    );
    // A forfeit is recorded as a defeat before leaving, so quitting
    // a losing seal can never advance it.
    async function forfeit() {
        if (sessionId && !(await forfeitShowdown(character.name, sessionId,
            onVersionedCharacter ? (snapshot, version) => onVersionedCharacter(snapshot as Character, version) : undefined))) {
            setError("The concession could not be recorded. Retry before leaving."); return;
        }
        outcome.current = "loss";
        setBattle(null);
        void onLeave();
    }

    if (!selectedPet) {
        return (
            <div className="card cinematic-card pet-battle-theme pet-battle-lobby">
                <h2>Rare Beast Seal</h2>
                <p className="hint">You need at least one pet to complete this seal.</p>
                <button className="danger-button" onClick={onLeave}>Leave dungeon</button>
            </div>
        );
    }
    if (isPetOnExpedition(selectedPet)) {
        return <div className="card cinematic-card pet-battle-theme pet-battle-lobby"><h2>Rare Beast Seal</h2><p className="hint">{petDisplayName(selectedPet)} is away exploring. Choose another pet in the Pet Yard or wait for it to return.</p><button className="danger-button" onClick={onLeave}>Leave dungeon</button></div>;
    }
    if (!battle) {
        return (
            <div className="card cinematic-card pet-battle-theme pet-battle-lobby">
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
                    {/* The beast is the SERVER's now, so there is nothing honest to
                        put on a card before the seal opens. Same card shape as the
                        real one (avatar column + body) so the grid reads unchanged;
                        the stat block is simply not knowable yet. */}
                    <div className="pet-arena-card">
                        <div className="pet-arena-avatar">
                            {dungeonPetImage
                                ? <img src={dungeonPetImage} alt={enemyOwner} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                                : <span>??</span>}
                        </div>
                        <div>
                            <strong>{enemyOwner}</strong>
                            <p>The seal keeps its beast hidden until it breaks.</p>
                        </div>
                    </div>
                </div>
                {error && <p className="hint" style={{ color: "#fca5a5" }}>{error}</p>}
                <div className="menu vn-decision-controls">
                    <button className="danger-button" onClick={onLeave}>Leave dungeon</button>
                    <button className="admin-button" disabled={starting} onClick={() => void startBattle()}>
                        {starting ? "Breaking the seal…" : "Start pet battle"}
                    </button>
                </div>
            </div>
        );
    }
    // The session is live. Exiting after a win advances the seal (onWin),
    // otherwise it leaves the dungeon — and the outcome comes from the server's
    // finishing turn, never from anything decided here.
    return (
        <Suspense fallback={<div className="summary-box" style={{ padding: "2rem", textAlign: "center", color: "#94a3b8" }}>Loading the arena…</div>}>
            {error && <div role="alert" className="pet-battle-record-error pet-battle-theme">{error}</div>}
            <PetShowdownBattle
                key={battle.key}
                initialState={battle.state}
                playerPets={[selectedPet]}
                // Admin-uploaded dungeon art still dresses the boss: the server
                // names the species it built, so the portrait is overlaid onto
                // that species' art key for this fight only.
                sharedImages={dungeonPetImage && battle.state.enemy[0]?.templateId
                    ? { ...sharedImages, [`petbody:${battle.state.enemy[0].templateId}`]: dungeonPetImage }
                    : sharedImages}
                submitTurn={submitTurn}
                onForfeit={forfeit}
                onFinished={(result) => { outcome.current = result; }}
                onExit={() => { setBattle(null); void (outcome.current === "win" ? onWin() : onLeave()); }}
                hideRematch
                exitLabel="Continue dungeon"
                onRematch={() => {}}
            />
        </Suspense>
    );
}

// Pets must reach this level before expeditions unlock. Training (and the
// loadout scaffold) stay available from level 1.
