// Echoes of War — the Chronicle Showdown story campaign inside the Celestial
// Tower. This screen owns the floor ladder + encounter details; story scenes
// run through the shared TriggeredVisualNovel reader and every battle runs
// through the shared CardClashDuel host (the real Shinobi Chronicle Showdown
// engine, server-authoritative). Progression and Chronicle Points live on
// SERVER-OWNED character fields, so this screen renders purely from `character`
// and never needs its own fetch on mount.
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Character } from "../types/character";
import type { TileCard } from "../data/tile-cards";
import type { CreatorEvent } from "../types/vn";
import {
    echoesWitnessEraForCloseEncounter,
    normalizeEchoesWitnessChoices,
    type EchoesBattleBeat,
    type EchoesWitnessChoiceId,
    type EchoesWitnessEraId,
} from "../../../shared/echoes-witness";
import {
    ECHOES_ERAS,
    ECHOES_HERO_COPY,
    ECHOES_OPPONENTS,
    ECHOES_REWARD_DISPLAY,
    ECHOES_TOWER_HERO,
    echoesBandForFloor,
    echoesClientProgress,
    echoesEraById,
    echoesEraCleared,
    echoesEraForFloor,
    echoesEraOpponents,
    echoesEraUnlocked,
    echoesFloorUnlockedClient,
    echoesHighestUnlockedFloorClient,
    echoesOpponentById,
    echoesStoriesCompleted,
    type EchoesEra,
    type EchoesOpponent,
    type EchoesOpponentScenes,
    type EchoesScenePage,
} from "../data/echoes-of-war";
import { readEchoesContent, resetEchoesContent } from "../lib/echoes-content-loader";
import { cardGameLockStatus } from "../lib/chronicle-lock";
import type { EchoesSettleSummary } from "../lib/chronicle-duel";
import { playEchoesSfx, startEchoesAmbience, stopEchoesAmbience } from "../lib/echoes-sfx";
import { echoesConclusionPending, recordEchoesWitness } from "../lib/echoes-witness";
import { echoesReactiveEraIntro, echoesReactiveVictory } from "../lib/echoes-witness-scenes";
import { ContentLoadBoundary } from "../components/StoryContentBoundary";
import { TriggeredVisualNovel } from "../components/TriggeredVisualNovel";
import { CardClashDuel } from "./CardClashDuel";
import "./EchoesOfWar.css";

/** Beat between "you chose to enter" and the board mounting: the matchup
 * splash. Long enough to read both names once; skipped entirely under
 * prefers-reduced-motion. */
const ENTER_MEMORY_VEIL_MS = 1650;

function prefersReducedMotion(): boolean {
    try {
        return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    } catch { return false; }
}

// Interrupted-showdown resume pointer (mirrors CardHall's chronicleAiMatch.v1).
const ECHOES_RESUME_KEY = "echoesAiMatch.v1";

type ResumePointer = { matchId: string; encounterId: string };

function readResumePointer(): ResumePointer | null {
    try {
        const raw = sessionStorage.getItem(ECHOES_RESUME_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as ResumePointer;
        return typeof parsed?.matchId === "string" && typeof parsed?.encounterId === "string" ? parsed : null;
    } catch { return null; }
}

function writeResumePointer(pointer: ResumePointer | null): void {
    try {
        if (pointer) sessionStorage.setItem(ECHOES_RESUME_KEY, JSON.stringify(pointer));
        else sessionStorage.removeItem(ECHOES_RESUME_KEY);
    } catch { /* private mode: resume is a convenience, not a requirement */ }
}

type SceneKind = "pre" | "defeat" | "victory" | "rematch";

/** Wrap a scene as a zero-reward VN event for the shared reader. The scripts
 * arrive via the on-demand story-content payload, not the route chunk. */
function sceneEvent(opponent: EchoesOpponent, scenes: EchoesOpponentScenes, kind: SceneKind, overridePages?: EchoesScenePage[]): CreatorEvent {
    const pages: EchoesScenePage[] = overridePages ?? (kind === "pre" ? scenes.preShowdown
        : kind === "defeat" ? scenes.defeat
        : kind === "victory" ? scenes.firstVictory
        : scenes.rematch);
    return {
        id: `${opponent.id}-${kind}`,
        name: `${opponent.name}, ${opponent.title}`,
        biome: "central",
        icon: "📜",
        eventKind: "visualNovel",
        vnTitle: `${opponent.name}, ${opponent.title}`,
        image: opponent.sceneImage,
        avatarImage: opponent.portrait,
        levelReq: 0,
        xpReward: 0,
        ryoReward: 0,
        staminaReward: 0,
        dialogue: [],
        vnPages: pages.map((page) => ({
            title: page.title,
            scene: page.scene,
            speaker: page.speaker,
            dialogue: [...page.dialogue],
        })),
    };
}

/** Wrap an Age intro as a zero-reward VN event for the shared reader. */
function eraIntroEvent(era: EchoesEra, pages: EchoesScenePage[]): CreatorEvent {
    return {
        id: `${era.id}-intro`,
        name: `${era.ageLabel} · ${era.title}`,
        biome: "central",
        icon: "📜",
        eventKind: "visualNovel",
        vnTitle: `${era.ageLabel} · ${era.title}`,
        image: era.plateImage,
        levelReq: 0,
        xpReward: 0,
        ryoReward: 0,
        staminaReward: 0,
        dialogue: [],
        vnPages: pages.map((page) => ({
            title: page.title,
            scene: page.scene,
            speaker: page.speaker,
            dialogue: [...page.dialogue],
        })),
    };
}

/** What happens when a scene finishes. Data, not closures: the completion
 * handler interprets it against the CURRENT render's character, so a scene
 * played across regen ticks or a settle commit never clobbers fresh state.
 * `markEraSeen`/`openEra` handle the Age intro flow. */
type VnAfter = {
    markSeen?: { id: string; kind: "pre" | "post" };
    battleEncounterId?: string;
    markEraSeen?: string;
    openEra?: string;
    openWitnessEra?: EchoesWitnessEraId;
};
type ActiveVn = { event: CreatorEvent; after: VnAfter };
type ActiveBattle = { opponent: EchoesOpponent; resumeMatchId?: string };

const TILE_DIFFICULTY: Record<EchoesOpponent["difficultyLabel"], "easy" | "normal" | "hard"> = {
    Introductory: "easy", Moderate: "normal", Difficult: "hard", Boss: "hard",
};

type EchoesOfWarProps = {
    character: Character;
    creatorCards: TileCard[];
    updateCharacter: (character: Character) => void;
    onVersionedCharacter: (character: Character, saveVersion?: number) => boolean;
    onBack: () => void;
};

export function EchoesOfWar(props: EchoesOfWarProps) {
    return (
        <ContentLoadBoundary
            reset={resetEchoesContent}
            title="The tower's memories are unavailable"
            body="The Echoes of War script could not be verified. No Showdown, reward, or story progress was changed."
            retryLabel="Retry Loading the Memories"
            returnLabel="Leave the Tower"
            onReturn={props.onBack}
        >
            <EchoesOfWarContent {...props} />
        </ContentLoadBoundary>
    );
}

function EchoesOfWarContent({ character, creatorCards, updateCharacter, onVersionedCharacter, onBack }: EchoesOfWarProps) {
    // Suspends to App's lazy-screen fallback on the first visit; the payload is
    // content-addressed and immutable-cached, so every later mount is sync.
    const { scenes: echoesScenes, eras: echoesEraIntros, witness: echoesWitness } = readEchoesContent();
    const [selectedEraId, setSelectedEraId] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [vn, setVn] = useState<ActiveVn | null>(null);
    const [vnPage, setVnPage] = useState(0);
    const [vnLine, setVnLine] = useState(0);
    const [battle, setBattle] = useState<ActiveBattle | null>(null);
    const [witnessView, setWitnessView] = useState<{ playerName: string; eraId: EchoesWitnessEraId } | null>(null);
    const [witnessReceipt, setWitnessReceipt] = useState<{ playerName: string; eraId: EchoesWitnessEraId; choiceId: EchoesWitnessChoiceId } | null>(null);
    const [witnessPending, setWitnessPending] = useState<EchoesWitnessChoiceId | null>(null);
    const [witnessError, setWitnessError] = useState("");
    const witnessRequest = useRef(0);
    const characterNameRef = useRef(character.name);
    useEffect(() => {
        characterNameRef.current = character.name;
        witnessRequest.current += 1;
    }, [character.name]);
    const witnessEraId = witnessView?.playerName === character.name ? witnessView.eraId : null;
    const openWitness = (eraId: EchoesWitnessEraId) => {
        witnessRequest.current += 1;
        setWitnessView({ playerName: character.name, eraId });
        setWitnessReceipt(null);
        setWitnessPending(null);
        setWitnessError("");
    };
    // The "entering the memory" veil shown between choosing a Showdown and the
    // board mounting. Skipped entirely under prefers-reduced-motion.
    const [veil, setVeil] = useState<ActiveBattle | null>(null);
    const veilTimer = useRef<number | null>(null);
    useEffect(() => () => { if (veilTimer.current) window.clearTimeout(veilTimer.current); }, []);
    const [resume, setResume] = useState<ResumePointer | null>(() => readResumePointer());
    // The settle summary arrives before the player clicks Continue; a ref
    // avoids reading a stale state snapshot from the win callback's closure.
    const summaryRef = useRef<EchoesSettleSummary | null>(null);

    // Subdued tower ambience while browsing the memories (handoff art
    // direction). It yields to the Showdown itself and stops on screen exit.
    const inBattle = battle !== null;
    useEffect(() => {
        if (inBattle) return;
        startEchoesAmbience();
        return () => stopEchoesAmbience();
    }, [inBattle]);

    const progress = echoesClientProgress(character.echoesOfWar);
    const storySeen = character.echoesStorySeen ?? {};
    const witnessChoices = normalizeEchoesWitnessChoices(character.echoesWitnessChoices);
    const chroniclePoints = character.chroniclePoints ?? 0;
    const highestFloor = echoesHighestUnlockedFloorClient(progress);
    const completed = echoesStoriesCompleted(progress);
    const selected = selectedId ? ECHOES_OPPONENTS.find((opponent) => opponent.id === selectedId) ?? null : null;
    const lock = cardGameLockStatus(character);

    function markStorySeen(id: string, kind: "pre" | "post") {
        const seen = character.echoesStorySeen ?? {};
        if (seen[id]?.[kind]) return;
        updateCharacter({
            ...character,
            echoesStorySeen: { ...seen, [id]: { ...seen[id], [kind]: true } },
        });
    }

    // Age intros reuse the same client-owned seen map, under an "era:<id>" key.
    const eraIntroSeen = (era: EchoesEra) => storySeen[`era:${era.id}`]?.pre === true;
    function markEraSeen(eraId: string) {
        const seen = character.echoesStorySeen ?? {};
        const key = `era:${eraId}`;
        if (seen[key]?.pre) return;
        updateCharacter({
            ...character,
            echoesStorySeen: { ...seen, [key]: { ...seen[key], pre: true } },
        });
    }

    function playEraIntro(era: EchoesEra, after: VnAfter) {
        const pages = echoesReactiveEraIntro(era.id, echoesEraIntros[era.id], witnessChoices, echoesWitness);
        if (!pages) {
            // Missing intro must never trap the player: apply the outcome.
            if (after.markEraSeen) markEraSeen(after.markEraSeen);
            if (after.openEra) setSelectedEraId(after.openEra);
            return;
        }
        setVnPage(0);
        setVnLine(0);
        setVn({ event: eraIntroEvent(era, pages), after });
    }

    /** Open an Age: play its intro the first time (then reveal its floors),
     * or go straight to the floors on later visits. */
    function openEra(era: EchoesEra) {
        if (!eraIntroSeen(era)) {
            playEraIntro(era, { markEraSeen: era.id, openEra: era.id });
            return;
        }
        setSelectedEraId(era.id);
    }

    function playScene(opponent: EchoesOpponent, kind: SceneKind, after: VnAfter, battleBeat?: EchoesBattleBeat) {
        const scenes = echoesScenes[opponent.id];
        if (!scenes) {
            // The generator guarantees scene parity with the shell, so this is
            // unreachable in a healthy build — but never trap a player behind a
            // missing script: apply the scene's outcome directly.
            if (after.markSeen) markStorySeen(after.markSeen.id, after.markSeen.kind);
            if (after.openWitnessEra) openWitness(after.openWitnessEra);
            if (after.battleEncounterId) {
                const target = echoesOpponentById(after.battleEncounterId);
                if (target) beginBattle(target);
            }
            return;
        }
        let pages: EchoesScenePage[] | undefined;
        if (kind === "victory") {
            pages = echoesReactiveVictory(opponent.id, scenes.firstVictory, battleBeat, witnessChoices, echoesWitness);
        }
        setVnPage(0);
        setVnLine(0);
        setVn({ event: sceneEvent(opponent, scenes, kind, pages), after });
    }

    function beginBattle(opponent: EchoesOpponent, resumeMatchId?: string) {
        summaryRef.current = null;
        const next: ActiveBattle = { opponent, resumeMatchId };
        if (prefersReducedMotion()) {
            setBattle(next);
            return;
        }
        playEchoesSfx("enter-memory");
        setVeil(next);
        if (veilTimer.current) window.clearTimeout(veilTimer.current);
        veilTimer.current = window.setTimeout(() => {
            setVeil(null);
            setBattle(next);
        }, ENTER_MEMORY_VEIL_MS);
    }

    function challenge(opponent: EchoesOpponent) {
        const cleared = (progress[opponent.id]?.wins ?? 0) > 0;
        if (!cleared && !storySeen[opponent.id]?.pre) {
            playScene(opponent, "pre", { markSeen: { id: opponent.id, kind: "pre" }, battleEncounterId: opponent.id });
            return;
        }
        if (cleared) {
            if (echoesConclusionPending(progress[opponent.id]?.wins, storySeen[opponent.id]?.post)) {
                const witnessEra = echoesWitnessEraForCloseEncounter(opponent.id);
                playScene(opponent, "victory", {
                    markSeen: { id: opponent.id, kind: "post" },
                    ...(witnessEra && !witnessChoices[witnessEra.id] ? { openWitnessEra: witnessEra.id } : {}),
                }, progress[opponent.id]?.firstClearBattleBeat);
                return;
            }
            // The echo has moved on: rematches are the tower replaying the
            // preserved match, framed by the short rematch scene each time.
            playScene(opponent, "rematch", { battleEncounterId: opponent.id });
            return;
        }
        beginBattle(opponent);
    }

    function endBattle(opponent: EchoesOpponent, outcome: "win" | "loss" | "draw" | "leave") {
        setBattle(null);
        if (outcome === "leave") return; // keep the resume pointer for mid-match exits
        writeResumePointer(null);
        setResume(null);
        if (outcome === "win" && summaryRef.current?.firstClear) {
            const witnessEra = echoesWitnessEraForCloseEncounter(opponent.id);
            playScene(opponent, "victory", {
                markSeen: { id: opponent.id, kind: "post" },
                ...(witnessEra && !witnessChoices[witnessEra.id] ? { openWitnessEra: witnessEra.id } : {}),
            }, summaryRef.current.battleBeat);
            return;
        }
        if (outcome === "loss") playScene(opponent, "defeat", {});
    }

    // ── Full-screen takeovers ────────────────────────────────────────────────
    if (battle) {
        const opponent = battle.opponent;
        return <CardClashDuel
            character={character}
            creatorCards={creatorCards}
            tileDifficulty={TILE_DIFFICULTY[opponent.difficultyLabel]}
            dungeonSceneImage={opponent.sceneImage}
            opponentAvatar={opponent.portrait}
            echoes={{
                encounterId: opponent.id,
                floor: opponent.floor,
                opponentName: opponent.name,
                opponentTitle: opponent.title,
                isBoss: opponent.isBoss,
                resumeMatchId: battle.resumeMatchId,
            }}
            onVersionedCharacter={onVersionedCharacter}
            onMatchStarted={(matchId) => { writeResumePointer({ matchId, encounterId: opponent.id }); setResume({ matchId, encounterId: opponent.id }); }}
            onEchoesSettled={(summary) => { summaryRef.current = summary; }}
            onDungeonWin={() => endBattle(opponent, "win")}
            onDungeonLose={() => endBattle(opponent, "loss")}
            onDungeonDraw={() => endBattle(opponent, "draw")}
            onDungeonLeave={() => endBattle(opponent, "leave")}
        />;
    }
    if (vn) {
        return <TriggeredVisualNovel
            event={vn.event}
            character={character}
            pageIndex={vnPage}
            lineIndex={vnLine}
            setPageIndex={setVnPage}
            setLineIndex={setVnLine}
            onCancel={() => {
                // Cancelling an Age intro still reveals its floors and marks it
                // seen, so the intro never blocks access on a mis-tap.
                const after = vn.after;
                setVn(null);
                if (after.markEraSeen) markEraSeen(after.markEraSeen);
                if (after.openEra) setSelectedEraId(after.openEra);
            }}
            onComplete={() => {
                const after = vn.after;
                setVn(null);
                if (after.markSeen) markStorySeen(after.markSeen.id, after.markSeen.kind);
                if (after.markEraSeen) markEraSeen(after.markEraSeen);
                if (after.openEra) setSelectedEraId(after.openEra);
                if (after.openWitnessEra) openWitness(after.openWitnessEra);
                if (after.battleEncounterId) {
                    const opponent = echoesOpponentById(after.battleEncounterId);
                    if (opponent) beginBattle(opponent);
                }
            }}
            onBattle={() => { /* Echoes scenes never launch battles directly */ }}
        />;
    }

    if (witnessEraId) {
        const era = ECHOES_ERAS.find(({ id }) => id === witnessEraId);
        const content = echoesWitness[witnessEraId];
        const sealedChoiceId = witnessReceipt?.playerName === character.name && witnessReceipt.eraId === witnessEraId
            ? witnessReceipt.choiceId
            : witnessChoices[witnessEraId];
        const sealedChoice = content?.choices.find(({ id }) => id === sealedChoiceId);
        if (era && content) {
            const submit = async (choiceId: EchoesWitnessChoiceId) => {
                const playerName = character.name;
                const requestId = ++witnessRequest.current;
                setWitnessPending(choiceId);
                setWitnessError("");
                try {
                    const response = await recordEchoesWitness(playerName, witnessEraId, choiceId);
                    if (requestId !== witnessRequest.current || characterNameRef.current !== playerName) return;
                    if (!onVersionedCharacter(response.character, response.saveVersion)) {
                        setWitnessError("A newer save arrived first. Review the record and try again.");
                        return;
                    }
                    setWitnessReceipt({ playerName, eraId: response.eraId, choiceId: response.choiceId });
                } catch (error) {
                    if (requestId !== witnessRequest.current || characterNameRef.current !== playerName) return;
                    setWitnessError(error instanceof Error ? error.message : "Could not seal the witness record.");
                } finally {
                    if (requestId === witnessRequest.current && characterNameRef.current === playerName) setWitnessPending(null);
                }
            };
            return (
                <div className="echoes-shell echoes-witness-shell" style={{ "--band": `var(--echoes-${era.band})` } as CSSProperties}>
                    <header className="echoes-header">
                        <button className="back-btn" onClick={() => { witnessRequest.current += 1; setWitnessView(null); setWitnessError(""); }}>← {era.ageLabel}</button>
                        <div className="echoes-header-titles">
                            <span className="echoes-kicker">{era.ageLabel} · Witness Record</span>
                            <h1>{sealedChoice ? "Record sealed" : content.prompt.title}</h1>
                        </div>
                    </header>
                    <section className="echoes-panel echoes-witness-panel">
                        <p className="echoes-witness-scene">{content.prompt.scene}</p>
                        <strong className="echoes-witness-speaker">{content.prompt.speaker}</strong>
                        {content.prompt.dialogue.map((line) => <p key={line}>{line}</p>)}
                        {sealedChoice ? (
                            <div className="echoes-witness-sealed">
                                <span>Sealed entry · {sealedChoice.label}</span>
                                <p>{sealedChoice.record}</p>
                                <small>The first answer remains part of this character's record.</small>
                            </div>
                        ) : (
                            <div className="echoes-witness-choices">
                                {content.choices.map((choice) => (
                                    <button key={choice.id} disabled={witnessPending !== null} onClick={() => void submit(choice.id)}>
                                        <strong>{choice.label}</strong>
                                        <span>{choice.record}</span>
                                    </button>
                                ))}
                                <button className="echoes-ghost-btn" disabled={witnessPending !== null} onClick={() => setWitnessView(null)}>Leave the page open</button>
                            </div>
                        )}
                        {witnessPending ? <p className="echoes-witness-status" role="status">Sealing the entry…</p> : null}
                        {witnessError ? <p className="echoes-witness-error" role="alert">{witnessError}</p> : null}
                    </section>
                </div>
            );
        }
    }

    // The pre-Showdown veil covers whichever browsing view is behind it: a
    // full matchup splash where the echo and the challenger meet across the
    // tower's divide before the memory opens. The floor's own scene art is
    // the backdrop, so every floor gets a bespoke card.
    const veilBand = veil ? echoesBandForFloor(veil.opponent.floor) : "low";
    const veilEra = veil ? echoesEraForFloor(veil.opponent.floor) : null;
    const veilOverlay = veil ? (
        <div
            className="echoes-veil"
            style={{
                "--band": `var(--echoes-${veilBand})`,
                "--vs-scene": `url(${veil.opponent.sceneImage})`,
            } as CSSProperties}
            role="status"
            aria-label={`Floor ${veil.opponent.floor}. ${veil.opponent.name}, ${veil.opponent.title}, versus ${character.name}. The tower opens the memory.`}
        >
            <div className="echoes-vs-stage">
            <div className="echoes-vs-panel echoes-vs-panel--echo" aria-hidden="true">
                <span
                    className="echoes-vs-portrait"
                    style={{ backgroundImage: `linear-gradient(color-mix(in srgb, var(--band, #d9c88a) 14%, transparent), transparent 46%), url(${veil.opponent.portrait})` }}
                />
                <span className="echoes-vs-id">
                    <small>Floor {veil.opponent.floor}{veilEra ? ` · ${veilEra.title}` : ""}</small>
                    <strong>{veil.opponent.name}</strong>
                    <em>{veil.opponent.title}</em>
                </span>
            </div>
            <div className="echoes-vs-slash" aria-hidden="true"><b>VS</b></div>
            <div className="echoes-vs-panel echoes-vs-panel--challenger" aria-hidden="true">
                <span
                    className="echoes-vs-portrait"
                    style={{ backgroundImage: `linear-gradient(color-mix(in srgb, var(--band, #d9c88a) 14%, transparent), transparent 46%), url(${character.avatarImage || "/portraits/echoes-challenger.webp"})` }}
                />
                <span className="echoes-vs-id">
                    <small>Challenger</small>
                    <strong>{character.name}</strong>
                    <em>The one who climbs</em>
                </span>
            </div>
            <div className="echoes-veil-text echoes-vs-caption" aria-hidden="true">
                <small>The tower opens the memory.</small>
            </div>
            </div>
        </div>
    ) : null;

    const heroHeader = (subline: boolean, onBackClick: () => void, backLabel: string) => (
        <header className="echoes-hero">
            <div className="echoes-hero-art" style={{ backgroundImage: `url(${ECHOES_TOWER_HERO})` }} aria-hidden="true" />
            <button className="back-btn" onClick={onBackClick}>{backLabel}</button>
            <div className="echoes-hero-inner">
                <div className="echoes-header-titles">
                    <span className="echoes-kicker">{ECHOES_HERO_COPY.eyebrow}</span>
                    <h1>Echoes of War</h1>
                    {subline ? <p className="echoes-sub">{ECHOES_HERO_COPY.subtitle}</p> : null}
                </div>
                <div className="echoes-header-stats">
                    <span className="echoes-points-chip" title="Chronicle Points buy the Basic Card Pack in the Card Shop.">🏛️ Chronicle Points: <strong>{chroniclePoints}</strong></span>
                    <span className="echoes-stat">Highest memory: Floor {highestFloor}</span>
                    <div className="echoes-progress" aria-label={`Stories completed: ${completed} of ${ECHOES_OPPONENTS.length}`}>
                        <span>Stories {completed}/{ECHOES_OPPONENTS.length}</span>
                        <div className="echoes-progress-track">
                            <div className="echoes-progress-fill" style={{ width: `${(completed / ECHOES_OPPONENTS.length) * 100}%` }} />
                        </div>
                    </div>
                </div>
            </div>
        </header>
    );

    // ── Chronicle lock (pre-Scribe): same pacing gate as the Card Hall ──────
    if (lock.locked) {
        return (
            <div className="echoes-shell">
                {heroHeader(true, onBack, "← Celestial Tower")}
                <section className="echoes-panel">
                    <h2>The memories are sealed</h2>
                    <p>{lock.body}</p>
                </section>
            </div>
        );
    }

    // ── Encounter detail ─────────────────────────────────────────────────────
    if (selected) {
        const entry = progress[selected.id];
        const cleared = (entry?.wins ?? 0) > 0;
        const unlocked = echoesFloorUnlockedClient(progress, selected.floor);
        const seen = storySeen[selected.id];
        const firstClearTotal = ECHOES_REWARD_DISPLAY.repeatWin + ECHOES_REWARD_DISPLAY.firstClearBonus
            + (selected.isBoss ? ECHOES_REWARD_DISPLAY.bossFirstClearBonus : 0);
        const resumable = resume && resume.encounterId === selected.id ? resume : null;
        const band = echoesBandForFloor(selected.floor);
        return (
            <div className="echoes-shell" style={{ "--band": `var(--echoes-${band})` } as CSSProperties}>
                {veilOverlay}
                <header className="echoes-header">
                    <button className="back-btn" onClick={() => setSelectedId(null)}>← All floors</button>
                    <div className="echoes-header-titles">
                        <span className="echoes-kicker">Echoes of War · Floor {selected.floor}{selected.isBoss ? " · Chapter Boss" : ""}</span>
                        <h1>{selected.name}, {selected.title}</h1>
                    </div>
                    <span className="echoes-points-chip" title="Chronicle Points buy the Basic Card Pack in the Card Shop.">🏛️ {chroniclePoints}</span>
                </header>
                <section className={`echoes-detail-stage ${selected.isBoss ? "echoes-detail-stage--boss" : ""}`}>
                    <div className="echoes-detail-backdrop" style={{ backgroundImage: `url(${selected.sceneImage})` }} aria-hidden="true" />
                    <div className="echoes-panel echoes-detail">
                    <div className="echoes-detail-portrait-wrap">
                        <img className="echoes-detail-portrait" src={selected.portrait} alt={`${selected.name}, ${selected.title}`} />
                        {selected.isBoss ? <span className="echoes-boss-mark">Chapter Boss</span> : null}
                        {cleared ? <span className="echoes-cleared-mark">Story complete</span> : null}
                    </div>
                    <div className="echoes-detail-body">
                        <p className="echoes-blurb">{selected.shortDescription}</p>
                        <dl className="echoes-facts">
                            <div><dt>Deck</dt><dd>{selected.deckName}. {selected.deckTheme}</dd></div>
                            <div><dt>Difficulty</dt><dd>{selected.difficultyLabel}</dd></div>
                            <div><dt>First clear</dt><dd>{firstClearTotal} Chronicle Points</dd></div>
                            <div><dt>Repeat win</dt><dd>{ECHOES_REWARD_DISPLAY.repeatWin} Chronicle Points</dd></div>
                            {cleared ? <div><dt>Wins</dt><dd>{entry?.wins ?? 0}</dd></div> : null}
                        </dl>
                        {cleared ? <p className="echoes-chronicle-note">Chronicle note: {selected.chronicleNote}</p> : null}
                        {!unlocked ? <p className="echoes-locked-note">{selected.lockedHint}</p> : null}
                        <div className="echoes-detail-actions">
                            {resumable ? (
                                <button className="echoes-primary" onClick={() => beginBattle(selected, resumable.matchId)}>Resume Interrupted Showdown</button>
                            ) : null}
                            {unlocked ? (
                                <button className={resumable ? "" : "echoes-primary"} onClick={() => { if (resumable) { writeResumePointer(null); setResume(null); } challenge(selected); }}>
                                    {resumable ? "Start Over" : cleared ? "Replay Memory" : "Challenge"}
                                </button>
                            ) : null}
                            {seen?.pre || cleared ? (
                                <button onClick={() => playScene(selected, "pre", { markSeen: { id: selected.id, kind: "pre" } })}>Replay Intro</button>
                            ) : null}
                            {cleared && seen?.post ? (
                                <button onClick={() => playScene(selected, "victory", {}, entry?.firstClearBattleBeat)}>Replay Conclusion</button>
                            ) : null}
                            {cleared && echoesWitnessEraForCloseEncounter(selected.id) ? (
                                <button onClick={() => openWitness(echoesWitnessEraForCloseEncounter(selected.id)!.id)}>
                                    {witnessChoices[echoesWitnessEraForCloseEncounter(selected.id)!.id] ? "Review Witness Record" : "Record This Age"}
                                </button>
                            ) : null}
                        </div>
                    </div>
                    </div>
                </section>
            </div>
        );
    }

    const renderNode = (opponent: EchoesOpponent) => {
        const entry = progress[opponent.id];
        const cleared = (entry?.wins ?? 0) > 0;
        const unlocked = echoesFloorUnlockedClient(progress, opponent.floor);
        const state = cleared ? "cleared" : unlocked ? "available" : "locked";
        const current = !cleared && unlocked;
        const band = echoesBandForFloor(opponent.floor);
        return (
            <li
                key={opponent.id}
                className={[
                    "echoes-node",
                    `echoes-node--${state}`,
                    `echoes-node--band-${band}`,
                    opponent.isBoss ? "echoes-node--boss" : "",
                    current ? "echoes-node--current" : "",
                ].filter(Boolean).join(" ")}
            >
                <span className="echoes-node-floor">{opponent.floor}</span>
                <img
                    className="echoes-node-portrait"
                    src={opponent.portrait}
                    alt={state === "locked" ? "A sealed memory" : `${opponent.name}, ${opponent.title}`}
                />
                <div className="echoes-node-body">
                    {state === "locked" ? (
                        <>
                            <strong className="echoes-node-name">🔒 A sealed memory</strong>
                            <span className="echoes-node-meta">{opponent.lockedHint}</span>
                        </>
                    ) : (
                        <>
                            <strong className="echoes-node-name">
                                {opponent.name}, {opponent.title}{opponent.isBoss ? " · Boss" : ""}
                                {cleared ? <span className="echoes-node-seal">✓ Recorded</span> : null}
                            </strong>
                            <span className="echoes-node-meta">{opponent.deckName} · {opponent.difficultyLabel}{cleared ? ` · ${entry?.wins ?? 0} ${(entry?.wins ?? 0) === 1 ? "win" : "wins"}` : ""}</span>
                            <span className="echoes-node-reward">
                                {cleared
                                    ? `Repeat win: ${ECHOES_REWARD_DISPLAY.repeatWin} Chronicle Points`
                                    : `First clear: ${ECHOES_REWARD_DISPLAY.repeatWin + ECHOES_REWARD_DISPLAY.firstClearBonus + (opponent.isBoss ? ECHOES_REWARD_DISPLAY.bossFirstClearBonus : 0)} Chronicle Points`}
                            </span>
                        </>
                    )}
                </div>
                {state !== "locked" ? (
                    <button className="echoes-node-action" onClick={() => setSelectedId(opponent.id)}>
                        {cleared ? "Rematch / Story" : "Challenge"}
                    </button>
                ) : null}
            </li>
        );
    };

    // ── One Age: its intro is behind it, its floors are the ladder ──────────
    const selectedEra = selectedEraId ? echoesEraById(selectedEraId) : null;
    if (selectedEra) {
        const eraOpponents = echoesEraOpponents(selectedEra);
        const eraCleared = echoesEraCleared(progress, selectedEra);
        const resumeInEra = resume && eraOpponents.some((o) => o.id === resume.encounterId) ? resume : null;
        return (
            <div className="echoes-shell" style={{ "--band": `var(--echoes-${selectedEra.band})` } as CSSProperties}>
                {veilOverlay}
                <header className="echoes-hero echoes-hero--era">
                    <div className="echoes-hero-art" style={{ backgroundImage: `url(${selectedEra.plateImage})` }} aria-hidden="true" />
                    <button className="back-btn" onClick={() => setSelectedEraId(null)}>← All ages</button>
                    <div className="echoes-hero-inner">
                        <div className="echoes-header-titles">
                            <span className="echoes-kicker">{selectedEra.ageLabel} · The Sunken Court</span>
                            <h1>{selectedEra.title}</h1>
                            <p className="echoes-sub">{selectedEra.tagline}</p>
                        </div>
                        <div className="echoes-header-stats">
                            <span className="echoes-points-chip">🏛️ {chroniclePoints}</span>
                            <span className="echoes-stat">{eraCleared}/{eraOpponents.length} memories finished</span>
                            <button className="echoes-ghost-btn" onClick={() => playEraIntro(selectedEra, {})}>Replay Age Intro</button>
                            {eraCleared >= eraOpponents.length ? (
                                <button className="echoes-ghost-btn" onClick={() => openWitness(selectedEra.id as EchoesWitnessEraId)}>
                                    {witnessChoices[selectedEra.id as EchoesWitnessEraId] ? "Review Witness Record" : "Record This Age"}
                                </button>
                            ) : null}
                        </div>
                    </div>
                </header>
                {resumeInEra ? (
                    <section className="echoes-panel echoes-resume-note">
                        <p>An interrupted Showdown is still on the table.</p>
                        <button className="echoes-primary" onClick={() => setSelectedId(resumeInEra.encounterId)}>Continue</button>
                    </section>
                ) : null}
                <ol className="echoes-ladder echoes-ladder--era">
                    {eraOpponents.map(renderNode)}
                </ol>
                <p className="echoes-footnote">Chronicle Points buy the Basic Card Pack in the Card Shop. Losses cost nothing except the climb back down.</p>
            </div>
        );
    }

    // ── The Ages of the fall: pick a century to descend into ────────────────
    return (
        <div className="echoes-shell">
            {veilOverlay}
            {heroHeader(true, onBack, "← Celestial Tower")}
            {resume ? (
                <section className="echoes-panel echoes-resume-note">
                    <p>An interrupted Showdown is still on the table.</p>
                    <button className="echoes-primary" onClick={() => { const era = echoesEraForFloor(echoesOpponentById(resume.encounterId)?.floor ?? 1); if (era) setSelectedEraId(era.id); setSelectedId(resume.encounterId); }}>Continue</button>
                </section>
            ) : null}
            <div className="echoes-ages">
                {ECHOES_ERAS.map((era) => {
                    const unlocked = echoesEraUnlocked(progress, era);
                    const done = echoesEraCleared(progress, era);
                    const total = era.floors.length;
                    const complete = done >= total;
                    return (
                        <button
                            key={era.id}
                            type="button"
                            className={[
                                "echoes-age-plate",
                                `echoes-age-plate--band-${era.band}`,
                                unlocked ? "" : "echoes-age-plate--locked",
                                complete ? "echoes-age-plate--complete" : "",
                            ].filter(Boolean).join(" ")}
                            style={{ backgroundImage: `url(${era.plateImage})` }}
                            disabled={!unlocked}
                            onClick={() => openEra(era)}
                        >
                            <span className="echoes-age-plate-scrim" aria-hidden="true" />
                            <span className="echoes-age-plate-body">
                                <span className="echoes-age-plate-label">{era.ageLabel}{eraIntroSeen(era) ? "" : unlocked ? " · New" : ""}</span>
                                <strong className="echoes-age-plate-title">{unlocked ? era.title : "A sealed age"}</strong>
                                <span className="echoes-age-plate-tagline">
                                    {unlocked ? era.tagline : era.sealedTease}
                                </span>
                                {unlocked ? (
                                    <span className="echoes-age-plate-progress">
                                        <span className="echoes-age-plate-track"><span className="echoes-age-plate-fill" style={{ width: `${(done / total) * 100}%` }} /></span>
                                        <span className="echoes-age-plate-count">{complete ? "✓ Recorded" : `${done}/${total}`}</span>
                                    </span>
                                ) : <span className="echoes-age-plate-lock">🔒</span>}
                            </span>
                        </button>
                    );
                })}
            </div>
            <p className="echoes-footnote">{ECHOES_HERO_COPY.footnote}</p>
        </div>
    );
}
