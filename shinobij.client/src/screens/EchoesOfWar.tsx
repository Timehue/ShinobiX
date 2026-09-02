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
    ECHOES_OPPONENTS,
    ECHOES_REWARD_DISPLAY,
    ECHOES_TOWER_HERO,
    echoesBandForFloor,
    echoesClientProgress,
    echoesFloorUnlockedClient,
    echoesHighestUnlockedFloorClient,
    echoesOpponentById,
    echoesStoriesCompleted,
    type EchoesOpponent,
    type EchoesOpponentScenes,
    type EchoesScenePage,
} from "../data/echoes-of-war";
import { readEchoesContent, resetEchoesContent } from "../lib/echoes-content-loader";
import { cardGameLockStatus } from "../lib/chronicle-lock";
import type { EchoesSettleSummary } from "../lib/chronicle-duel";
import { playEchoesSfx, startEchoesAmbience, stopEchoesAmbience } from "../lib/echoes-sfx";
import { ContentLoadBoundary } from "../components/StoryContentBoundary";
import { TriggeredVisualNovel } from "../components/TriggeredVisualNovel";
import { CardClashDuel } from "./CardClashDuel";
import "./EchoesOfWar.css";

/** Beat between "you chose to enter" and the board mounting: the veil. */
const ENTER_MEMORY_VEIL_MS = 850;

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
function sceneEvent(opponent: EchoesOpponent, scenes: EchoesOpponentScenes, kind: SceneKind): CreatorEvent {
    const pages: EchoesScenePage[] = kind === "pre" ? scenes.preShowdown
        : kind === "defeat" ? scenes.defeat
        : kind === "victory" ? scenes.firstVictory
        : scenes.rematch;
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

/** What happens when a scene finishes. Data, not closures: the completion
 * handler interprets it against the CURRENT render's character, so a scene
 * played across regen ticks or a settle commit never clobbers fresh state. */
type VnAfter = { markSeen?: { id: string; kind: "pre" | "post" }; battleEncounterId?: string };
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
    const { scenes: echoesScenes } = readEchoesContent();
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [vn, setVn] = useState<ActiveVn | null>(null);
    const [vnPage, setVnPage] = useState(0);
    const [vnLine, setVnLine] = useState(0);
    const [battle, setBattle] = useState<ActiveBattle | null>(null);
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

    function playScene(opponent: EchoesOpponent, kind: SceneKind, after: VnAfter) {
        const scenes = echoesScenes[opponent.id];
        if (!scenes) {
            // The generator guarantees scene parity with the shell, so this is
            // unreachable in a healthy build — but never trap a player behind a
            // missing script: apply the scene's outcome directly.
            if (after.markSeen) markStorySeen(after.markSeen.id, after.markSeen.kind);
            if (after.battleEncounterId) {
                const target = echoesOpponentById(after.battleEncounterId);
                if (target) beginBattle(target);
            }
            return;
        }
        setVnPage(0);
        setVnLine(0);
        setVn({ event: sceneEvent(opponent, scenes, kind), after });
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
            playScene(opponent, "victory", { markSeen: { id: opponent.id, kind: "post" } });
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
            onCancel={() => setVn(null)}
            onComplete={() => {
                const after = vn.after;
                setVn(null);
                if (after.markSeen) markStorySeen(after.markSeen.id, after.markSeen.kind);
                if (after.battleEncounterId) {
                    const opponent = echoesOpponentById(after.battleEncounterId);
                    if (opponent) beginBattle(opponent);
                }
            }}
            onBattle={() => { /* Echoes scenes never launch battles directly */ }}
        />;
    }

    // The pre-Showdown veil covers whichever browsing view is behind it.
    const veilBand = veil ? echoesBandForFloor(veil.opponent.floor) : "low";
    const veilOverlay = veil ? (
        <div className="echoes-veil" style={{ "--band": `var(--echoes-${veilBand})` } as CSSProperties} role="status">
            <div className="echoes-veil-text">
                Floor {veil.opponent.floor} · {veil.opponent.name}, {veil.opponent.title}
                <small>The tower opens the memory.</small>
            </div>
        </div>
    ) : null;

    const heroHeader = (subline: boolean, onBackClick: () => void, backLabel: string) => (
        <header className="echoes-hero">
            <div className="echoes-hero-art" style={{ backgroundImage: `url(${ECHOES_TOWER_HERO})` }} aria-hidden="true" />
            <button className="back-btn" onClick={onBackClick}>{backLabel}</button>
            <div className="echoes-hero-inner">
                <div className="echoes-header-titles">
                    <span className="echoes-kicker">Celestial Tower · Chapter One · The Sunken Court</span>
                    <h1>Echoes of War</h1>
                    {subline ? <p className="echoes-sub">The tower keeps the memories of the fallen, not their souls. Finish the Showdowns they never got, and the pattern of the Hollow Gate begins to surface across the centuries.</p> : null}
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
                                <button onClick={() => playScene(selected, "victory", {})}>Replay Conclusion</button>
                            ) : null}
                        </div>
                    </div>
                    </div>
                </section>
            </div>
        );
    }

    // ── The tower ladder ─────────────────────────────────────────────────────
    return (
        <div className="echoes-shell">
            {veilOverlay}
            {heroHeader(true, onBack, "← Celestial Tower")}
            {resume ? (
                <section className="echoes-panel echoes-resume-note">
                    <p>An interrupted Showdown is still on the table.</p>
                    <button className="echoes-primary" onClick={() => setSelectedId(resume.encounterId)}>Continue</button>
                </section>
            ) : null}
            <ol className="echoes-ladder" style={{ "--echoes-progress": `${Math.max(6, (completed / ECHOES_OPPONENTS.length) * 100)}%` } as CSSProperties}>
                {[...ECHOES_OPPONENTS].reverse().map((opponent) => {
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
                })}
            </ol>
            <p className="echoes-footnote">Chronicle Points buy the Basic Card Pack in the Card Shop. Losses cost nothing except the climb back down.</p>
        </div>
    );
}
