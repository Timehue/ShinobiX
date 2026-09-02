import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Character } from "../types/character";
import type { TileCard } from "../data/tile-cards";
import { getAllTileCards } from "../data/tile-cards";
import {
    buildChronicleDeck,
    chronicleAiAction,
    displayCardsById,
    startChronicleAi,
    type ChronicleAiDifficulty,
    type ChronicleAiResult,
    type ChronicleProjection,
    type EchoesSettleSummary,
} from "../lib/chronicle-duel";
import { chronicleDuelistAvatar } from "../lib/chronicle-duelist-art";
import { ChronicleDuelBoard } from "../components/ChronicleDuelBoard";
import "../styles/chronicle-duel.css";

// Same replay pacing the Card Hall uses: a full beat per logged Keeper move,
// a quiet beat for silent phase bookkeeping.
const AI_STEP_BEAT_MS = 1_250;
const AI_STEP_QUIET_MS = 650;

type TileDifficulty = "easy" | "normal" | "hard";
const ENCOUNTER_AI_DIFFICULTY: Record<TileDifficulty, ChronicleAiDifficulty> = {
    easy: "easy",
    normal: "medium",
    hard: "hard",
};

/** Echoes of War campaign binding: the server seals the real opponent deck,
 * difficulty and Chronicle Point reward from the encounter id — these fields
 * only shape the framing copy around the board. */
export type EchoesDuelBinding = {
    encounterId: string;
    floor: number;
    opponentName: string;
    opponentTitle: string;
    isBoss?: boolean;
    /** Resume an interrupted showdown instead of starting a fresh one. */
    resumeMatchId?: string;
};

/** Current-rules PvE host. Encounter callers retain ownership of their reward, HP,
 * torch and seal consequences; the showdown server owns every card-game decision. */
export function CardClashDuel({
    character, creatorCards, tileDifficulty = "normal", dungeonSceneImage,
    opponentAvatar, dungeonRunToken, echoes, onVersionedCharacter, onEchoesSettled, onMatchStarted,
    onDungeonWin, onDungeonLose, onDungeonDraw, onDungeonLeave,
}: {
    character: Character;
    creatorCards: TileCard[];
    tileDifficulty?: TileDifficulty;
    dungeonSceneImage?: string;
    opponentAvatar?: string;
    dungeonRunToken?: string;
    echoes?: EchoesDuelBinding;
    onVersionedCharacter?: (character: Character, saveVersion: number) => boolean;
    /** Fires once the server has committed an Echoes settlement (null on a
     * loss/draw settle). Settlement lands BEFORE the replay animation ends. */
    onEchoesSettled?: (summary: EchoesSettleSummary | null) => void;
    /** Fires with the live match id so hosts can persist a resume pointer. */
    onMatchStarted?: (matchId: string) => void;
    onDungeonWin: () => void;
    onDungeonLose?: () => void;
    onDungeonDraw?: () => void;
    onDungeonLeave: () => void;
}) {
    const cardsById = useMemo(() => displayCardsById(getAllTileCards(creatorCards)), [creatorCards]);
    const deck = useMemo(() => buildChronicleDeck(character.cardClashDeck ?? [], character.tileCards ?? []), [character.cardClashDeck, character.tileCards]);
    const [matchId, setMatchId] = useState("");
    const [duel, setDuel] = useState<ChronicleProjection | null>(null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(true);
    const [aiActing, setAiActing] = useState(false);
    const [dungeonTerminalReady, setDungeonTerminalReady] = useState(false);
    const [echoesSummary, setEchoesSummary] = useState<EchoesSettleSummary | null>(null);
    const started = useRef(false);
    const replayToken = useRef(0);
    useEffect(() => () => { replayToken.current += 1; }, []);

    /** Replay the Keeper's captured moves one beat at a time, then settle. */
    async function presentSession(result: ChronicleAiResult) {
        const final = result.session;
        if (!final) return false;
        if ((dungeonRunToken || echoes) && final.status === "complete") {
            const version = Number(result._saveVersion);
            if (!result.character || !Number.isSafeInteger(version) || version < 1) {
                setError(echoes
                    ? "The showdown result is not confirmed yet. Retry the final action — nothing is lost."
                    : "The Dungeon Card proof could not be reconciled. Retry the final action.");
                return false;
            }
            if (!onVersionedCharacter?.(result.character, version)) {
                setError(echoes
                    ? "The showdown result belongs to a no-longer-active save session."
                    : "The Dungeon Card proof belongs to a no-longer-active save session.");
                return false;
            }
            if (echoes) {
                const summary = result.reward?.echoes ?? null;
                setEchoesSummary(summary);
                onEchoesSettled?.(summary);
            }
            setDungeonTerminalReady(true);
        }
        const steps = result.aiSteps ?? [];
        const token = ++replayToken.current;
        if (steps.length > 0) {
            setAiActing(true);
            let previousLast = duel?.log.at(-1);
            for (const step of steps) {
                setDuel(step);
                const beat = step.log.at(-1) !== previousLast ? AI_STEP_BEAT_MS : AI_STEP_QUIET_MS;
                await new Promise<void>((resolve) => window.setTimeout(resolve, beat));
                if (replayToken.current !== token) return false;
                previousLast = step.log.at(-1);
            }
            setAiActing(false);
        }
        setDuel(final);
        return true;
    }

    useEffect(() => {
        if (started.current) return;
        started.current = true;
        // try/catch/finally so a throw from a parent callback (e.g.
        // onVersionedCharacter inside presentSession) can never strand
        // busy=true with the encounter unfinishable.
        void (async () => {
            try {
                const result = echoes?.resumeMatchId
                    ? await chronicleAiAction(echoes.resumeMatchId, { action: "state" })
                    : await startChronicleAi(
                        character.name,
                        deck,
                        ENCOUNTER_AI_DIFFICULTY[tileDifficulty],
                        !echoes,
                        dungeonRunToken,
                        echoes?.encounterId,
                    );
                if (!result.ok || !result.session) { setError(result.error ?? "Could not prepare the sealed showdown."); return; }
                const liveMatchId = echoes?.resumeMatchId ?? result.matchId ?? result.session.matchId;
                setMatchId(liveMatchId);
                if (result.session.status !== "complete") onMatchStarted?.(liveMatchId);
                let authoritative = result;
                if (dungeonRunToken && result.session.status === "complete" && (!result.character || !result._saveVersion)) {
                    authoritative = await chronicleAiAction(result.matchId!, { action: "state" });
                    if (!authoritative.ok || !authoritative.session) {
                        setError(authoritative.error ?? "The Dungeon Card proof could not be reconciled.");
                        return;
                    }
                }
                await presentSession(authoritative);
            } catch {
                setError("Could not prepare the sealed showdown.");
            } finally {
                setBusy(false);
            }
        })();
        // presentSession is stable for the one-shot start effect
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [character.name, deck, tileDifficulty]);

    async function act(intent: Parameters<typeof chronicleAiAction>[1]) {
        if (!matchId || busy) return;
        setBusy(true); setError("");
        try {
            const result = await chronicleAiAction(matchId, intent);
            if (!result.ok || !result.session) { setError(result.error ?? "That action was not legal."); return; }
            await presentSession(result);
        } catch {
            setError("That action could not be resolved. Try again.");
        } finally {
            setBusy(false);
        }
    }

    function resolve() {
        if ((dungeonRunToken || echoes) && !dungeonTerminalReady) {
            setError(echoes
                ? "The showdown result is still waiting for server confirmation."
                : "The Dungeon Card proof is still waiting for server confirmation.");
            return;
        }
        if (duel && duel.winner === duel.viewerSide) onDungeonWin();
        else if (duel?.winner === "draw") (onDungeonDraw ?? onDungeonLose ?? onDungeonLeave)();
        else (onDungeonLose ?? onDungeonLeave)();
    }

    const done = duel?.status === "complete";
    const won = Boolean(done && duel && duel.winner === duel.viewerSide);
    const draw = done && duel.winner === "draw";
    const sceneStyle = dungeonSceneImage ? { "--chronicle-scene": `url(${dungeonSceneImage})` } as CSSProperties : undefined;
    // Encounter hosts don't pass an avatar, so the Keeper resolves its own.
    const foeName = duel ? duel[duel.viewerSide === "p1" ? "p2" : "p1"].name : "";
    const headerSmall = echoes
        ? `Echoes of War · Floor ${echoes.floor} · ${echoes.opponentName}, ${echoes.opponentTitle}`
        : tileDifficulty === "hard" ? "Sealed Encounter · Hard" : tileDifficulty === "easy" ? "Sealed Encounter · Easy" : "Sealed Encounter · Medium";

    return <main className={`chronicle-shell chronicle-encounter ${duel?.status === "active" ? "chronicle-shell--duel-active" : ""}`} style={sceneStyle}>
        <header className="chronicle-header">
            {/* Never disabled: this is the only exit, and the server owns the
                match state — abandoning mid-request is always safe. */}
            <button onClick={onDungeonLeave}>Leave Showdown</button>
            <h1>Shinobi Chronicle Showdown<small>{headerSmall}</small></h1>
        </header>
        {busy && !duel ? <section className="chronicle-panel"><h2>Preparing the table</h2><p>The server is validating the 40-card decks.</p></section> : null}
        {error && !duel ? <section className="chronicle-panel"><div className="chronicle-error" role="alert">{error}</div><button onClick={onDungeonLeave}>Leave encounter</button></section> : null}
        {done && echoes ? (
            <section className="chronicle-panel echoes-result-panel" style={{ marginBottom: 12, textAlign: "center" }}>
                <h2>{won ? "Victory" : draw ? "Draw" : "Defeat"}</h2>
                {won && echoesSummary ? (
                    <div className="echoes-reward-lines">
                        <p><strong>+{echoesSummary.basePoints} Chronicle Points</strong></p>
                        {echoesSummary.firstClearBonus > 0 ? <p>First clear: <strong>+{echoesSummary.firstClearBonus} Chronicle Points</strong></p> : null}
                        {echoesSummary.bossBonus > 0 ? <p>Chapter completed: <strong>+{echoesSummary.bossBonus} Chronicle Points</strong></p> : null}
                        <p>Balance: <strong>{echoesSummary.balance}</strong> Chronicle Points</p>
                        {echoesSummary.unlockedFloor ? <p>Floor {echoesSummary.unlockedFloor} is now open.</p> : null}
                    </div>
                ) : won ? (
                    <p>The record is complete. No Chronicle Points this time — the win came too fast to enter the Chronicle.</p>
                ) : draw ? (
                    <p>A draw settles nothing. The record stays open.</p>
                ) : (
                    <p>No Chronicle Points are awarded for a loss. The memory will wait.</p>
                )}
                <button onClick={resolve}>Continue</button>
            </section>
        ) : done ? (
            <section className="chronicle-panel" style={{ marginBottom: 12, textAlign: "center" }}><h2>{won ? "Seal Claimed" : draw ? "Draw — Seal Holds" : "Seal Holds"}</h2><p>{won ? "You won the Chronicle Showdown." : draw ? "A draw is not enough to break the seal." : "The Chronicle Keeper won the showdown."}</p><button onClick={resolve}>Continue</button></section>
        ) : null}
        {duel ? <ChronicleDuelBoard key={matchId || "duel"} state={duel} cardsById={cardsById} playerAvatar={character.avatarImage} opponentAvatar={opponentAvatar ?? chronicleDuelistAvatar(foeName)} busy={busy} aiActing={aiActing} error={error} onExit={onDungeonLeave} exitLabel="Leave encounter" onAction={(intent) => void act(intent)} /> : null}
    </main>;
}
