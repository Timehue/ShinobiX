import { questItem } from "../../../shared/quest-items";
import { COAST_MIN_LEVEL } from "../../../shared/world-maps";
import { coastStoryArt, coastRewardArt } from "../lib/coast-journal-art";
/*
 * Quest lines: the long one-time quests (api/quests/lines.ts).
 *
 * One component, shown three ways:
 *   - "journal": the World Quests tab. Every quest, what it asks next and where.
 *   - "sector":  inside a sector. Only what can be done standing here.
 *   - "sage":    in the Wandering Sage's dialog. What he has noticed.
 *
 * It draws what the server says and sends back a quest and an action. Whether
 * the player is in the right place, holds enough, or won the fight is decided
 * on the server every time; a button here is only a way to ask.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Character } from "../types/character";
import { requestAiFight } from "../lib/ai-fight-request";
import type { CreatorEvent } from "../types/vn";
import {
    loadQuestLines, questLineAction, questRefusal,
    type QuestAction, type QuestLine, type QuestLinesList, type QuestRecipe,
} from "../lib/quest-lines-api";
import { castPortrait, coastSceneEvent, coastSceneSeen, markCoastSceneSeen } from "../lib/coast-quest-scene";
import { CoastQuestScene } from "./CoastQuestScene";
import "./QuestLinesPanel.css";

export type QuestLinesPanelProps = Readonly<{
    playerName: string;
    mode: "journal" | "sector" | "sage";
    /** The sector the player stands in. Null in a town. */
    sector: number | null;
    onVersionedCharacter: (character: Character, saveVersion: unknown) => boolean | void;
    /** Told whenever the list is read, so a map can show the boat or a site. */
    onLoaded?: (list: QuestLinesList) => void;
    /** Bump to read the list again, such as after a gathering attempt. */
    refreshKey?: number;
    /** With the character, a quest's offer, choice, boss and closing play as scenes (CoastQuestScene). Without, they stay text. */
    character?: Character;
    sharedImages?: Record<string, string>;
}>;

const STAGE_VERB: Record<string, string> = { speak: "Speak", reach: "Mark this place", enter: "Go in", deliver: "Hand it over", gather: "That is enough" };

function here(place: { sector: number } | undefined, sector: number | null): boolean {
    return !!place && sector !== null && place.sector === sector;
}
function placeLine(place: { sectorName: string; name?: string } | undefined): string {
    if (!place) return "";
    // A site often carries its sector's own name; say it once.
    return place.name && place.name !== place.sectorName ? `${place.name}, ${place.sectorName}` : place.sectorName;
}

function QuestIcon({ id }: { id: string }) {
    const image = questItem(id)?.image;
    return image ? <img src={image} alt="" width="32" height="32" loading="lazy" /> : null;
}

function Recipe({ recipe }: { recipe: QuestRecipe }) {
    return (
        <ul className="quest-line-recipe">
            {recipe.inputs.map(input => (
                <li key={input.itemId} className={input.have >= input.count ? "is-met" : undefined}>
                    <QuestIcon id={input.itemId} /> {input.name} <span>{Math.min(input.have, input.count)} / {input.count}</span>
                </li>
            ))}
            <li className="quest-line-recipe-out"><QuestIcon id={recipe.output.itemId} /> Makes {recipe.output.count} {recipe.output.name}</li>
        </ul>
    );
}

type Playing = { event: CreatorEvent; pick: boolean; then: (optionKey?: string) => void };

export function QuestLinesPanel({ playerName, mode, sector, onVersionedCharacter, onLoaded, refreshKey = 0, character, sharedImages }: QuestLinesPanelProps) {
    const [scene, setScene] = useState<Playing | null>(null);
    const playing = useRef<Playing | null>(null);
    const [list, setList] = useState<QuestLinesList | null>(null);
    const [failed, setFailed] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);
    const [note, setNote] = useState<{ id: string; text: string; good?: boolean; reason?: string } | null>(null);
    const alive = useRef(true);
    const onLoadedRef = useRef(onLoaded);
    useLayoutEffect(() => { onLoadedRef.current = onLoaded; }, [onLoaded]);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

    const take = useCallback((next: QuestLinesList | null) => {
        if (!alive.current) return;
        setFailed(!next);
        if (next) { setList(next); onLoadedRef.current?.(next); }
    }, []);
    const reload = useCallback(async () => take(await loadQuestLines(playerName)), [playerName, take]);
    useEffect(() => { void loadQuestLines(playerName).then(take); }, [playerName, refreshKey, take]);

    /** Resolves true when the server did what was asked. */
    async function act(line: QuestLine, action: QuestAction, extra: { optionKey?: string; stageKey?: string } = {}) {
        if (busy) return false;
        setBusy(line.id);
        setNote(null);
        const reply = await questLineAction(playerName, action, line.id, extra);
        if (!alive.current) return reply.ok;
        if (reply.character) onVersionedCharacter(reply.character, reply._saveVersion);
        if (!reply.ok) setNote({ id: line.id, text: questRefusal(reply), reason: reply.reason });
        else if (action === "claim" && !reply.replayed) setNote({ id: line.id, good: true, text: typeof reply.earned === "string" ? reply.earned : "The quest is finished." });
        await reload();
        if (alive.current) setBusy(null);
        return reply.ok;
    }

    /** True when the fight was launched. */
    function fight(line: QuestLine) {
        const foe = line.stage?.fight;
        if (!foe || sector === null) return false;
        const launched = requestAiFight({
            opponentId: line.id, opponentLevel: foe.level, battleKind: "world", opponentName: foe.name, enemyAvatar: castPortrait(foe.face),
            sector, returnScreen: "worldMap",
            // The server builds the fight from the stored quest stage; this names the quest and nothing else.
            worldEncounter: { kind: "quest-line", sourceId: line.id, sector },
        });
        if (!launched) setNote({ id: line.id, text: "The fight could not start. Try again in a moment." });
        return launched;
    }

    // A quest's key moments play once each as a scene, on this device. Rounds are task lists and stay text.
    const sceneKey = (line: QuestLine) => `${playerName}.${line.id}.${line.stage?.index ?? line.state}`;
    const hasScene = (line: QuestLine) => !!character && !!line.talk?.length && line.series !== "coast-rounds" && !coastSceneSeen(sceneKey(line));
    /**
     * Plays what the quest is saying, then does what was asked. Skipping the
     * scene still does it. `then` answers whether it went through: a scene is
     * spent only then, so one that led to a refusal (three quests already under
     * way, a full backpack, a fight that would not start) plays again. A choice
     * is spent as it opens, so leaving it puts its answers on the card.
     */
    function play(line: QuestLine, then: (optionKey?: string) => boolean | Promise<boolean>) {
        if (playing.current) return;
        if (!hasScene(line)) return void then();
        const key = sceneKey(line);
        const pick = !!line.stage?.choice;
        if (pick) markCoastSceneSeen(key);
        playing.current = {
            event: coastSceneEvent(line, playerName, line.stage?.choice?.place || placeLine(line.stage?.place ?? line.offerAt) || line.title), pick,
            then: optionKey => void Promise.resolve(then(optionKey)).then(done => { if (done) markCoastSceneSeen(key); }),
        };
        setScene(playing.current);
    }
    /** A scene that asks for an answer does nothing when it is left without one; the answers then wait on the card. */
    function endScene(optionKey?: string) {
        const ended = playing.current;
        playing.current = null;
        setScene(null);
        if (ended && (optionKey || !ended.pick)) ended.then(optionKey);
    }

    /** A finished quest told again from its first line (the server's `recall`). It asks nothing and changes nothing. */
    async function recall(line: QuestLine) {
        if (busy || playing.current) return;
        setBusy(line.id);
        const reply = await questLineAction(playerName, "recall", line.id);
        if (!alive.current) return;
        setBusy(null);
        if (!reply.ok) return setNote({ id: line.id, text: questRefusal(reply) });
        playing.current = { event: coastSceneEvent({ ...line, ...reply } as QuestLine, playerName, line.title), pick: false, then: () => {} };
        setScene(playing.current);
    }

    if (failed) return <p role="status" className="hint">Your quests could not be read. <button type="button" onClick={() => void reload()}>Try again</button></p>;
    if (!list) return null;

    const shown = list.lines.filter(line => {
        if (mode === "sage") return line.state === "open" && line.giver === "wandering-sage";
        if (mode === "journal") return note?.id === line.id || line.state !== "locked" || line.reason === "level" || line.reason === "quests" || line.reason === "marks";
        // A quest claimed a moment ago stays, so what it paid can be read before it leaves the list.
        if (line.state === "ready" || note?.id === line.id) return true;
        if (line.state === "open") return here(line.offerAt, sector);
        // A quest under way is always shown out in the world: either it can be done here, or it says where.
        return line.state === "active";
    });
    if (!shown.length) return mode === "journal" && list.coast.level >= COAST_MIN_LEVEL
        ? <p className="hint">No quest is open to you right now.</p> : null;

    const category = (line: QuestLine) => line.series === "coast-rounds" ? "Rounds" : line.series === "coast-tales" ? "Side tales" : "Quests";
    const groups = mode === "journal" ? ["Quests", "Rounds", "Side tales"].map(title => ({ title, rows: shown.filter(line => category(line) === title) })).filter(group => group.rows.length) : [{ title: "", rows: shown }];
    return (
        <div className={`quest-lines quest-lines--${mode}`}>
            {mode === "journal" && list.marks > 0 && <p className="hint">Coast Record: <strong>{list.marks}</strong> {list.marks === 1 ? "mark" : "marks"}.</p>}
            {groups.map(({ title, rows }) => <section key={title} aria-label={title || undefined} className="quest-line-group">
                {title && <h3>{title}</h3>}
                {rows.map(line => {
                    const painting = mode === "journal" && coastStoryArt(line.art);
                    // While a scene is open its card stays put behind it; in the classic reader the buttons there are still focusable.
                    const stage = line.stage, waiting = busy === line.id || !!scene, atStage = here(stage?.place, sector);
                    const foe = stage?.fight;
                    const holds = foe?.hold ? [foe.hold, ...(foe.thenHolds ?? [])] : [];
                    return (
                        <div key={line.id} className={`mh-fetch-card quest-line-card${line.state === "ready" ? " mh-fetch-complete" : ""}`}>
                            {painting && <img className="quest-line-scene" loading="lazy" src={painting} alt="" />}
                            <div className="mh-fetch-info">
                                <strong>{line.title}</strong>
                                {line.state === "active" && stage && <span className="mh-fetch-meta">Step {stage.index + 1} of {line.stages}</span>}
                                {/* Where the quest stands when it is not under way, worded by the server (questStateNote). */}
                                {line.note && <span className="mh-fetch-meta">{line.note}</span>}
                                {line.talk?.map((say, i) => <span key={i} className="mh-fetch-meta quest-line-text">{say.speaker && <b>{say.speaker}: </b>}{say.text}</span>)}
                                {stage && <span className="mh-fetch-meta quest-line-text">{stage.choice?.prompt ?? stage.text}</span>}
                                {stage?.place && !atStage && <span className="mh-fetch-meta">Where: {placeLine(stage.place)}</span>}
                            </div>

                            {stage?.need && (
                                <div className="mh-fetch-progress-wrap">
                                    <div className="mh-fetch-progress-label"><span><QuestIcon id={stage.need.itemId} /> {Math.min(stage.need.have, stage.need.count)} / {stage.need.count} {stage.need.name}</span></div>
                                    <div className="mission-progress"><span style={{ width: `${Math.min(100, (stage.need.have / Math.max(1, stage.need.count)) * 100)}%` }} /></div>
                                </div>
                            )}
                            {mode === "journal" && !!line.gearChance && <span className="mh-fetch-meta">{line.gearChance}% chance of a gear piece</span>}
                            {mode === "journal" && line.rewardArtKeys?.map(key => {
                                const artwork = coastRewardArt(key);
                                return artwork && <img key={key} src={artwork.image} alt={artwork.name} title={artwork.name} width="48" height="48" loading="lazy" />;
                            })}
                            {stage?.recipe && <Recipe recipe={stage.recipe} />}
                            {holds.map((hold, i) => <span className="hint" key={i}>{holds.length > 1 ? "Hold " + (i + 1) + " of " + holds.length + " · " : ""}{hold.name} requires {hold.tool}. You hold {hold.have}.</span>)}
                            {line.remake && (
                                <>
                                    <span className="hint">You can make {line.remake.output.name} again at {placeLine(line.remake.place)}.</span>
                                    {here(line.remake.place, sector) && <Recipe recipe={line.remake} />}
                                </>
                            )}
                            {note?.id === line.id && <p role="status" className={note.good ? "quest-line-note is-good" : "quest-line-note"}>{note.text}</p>}

                            <div className="quest-line-actions">
                                {line.state === "open" && (mode === "sage" || here(line.offerAt, sector)) && <button type="button" disabled={waiting} onClick={() => play(line, () => act(line, "accept"))}>Take the quest</button>}
                                {line.state === "ready" && <button type="button" disabled={waiting} onClick={() => play(line, () => act(line, "claim"))}>Claim reward</button>}
                                {line.state === "done" && mode === "journal" && character && line.talk && <button type="button" disabled={waiting} onClick={() => void recall(line)}>Hear it again</button>}
                                {stage?.kind === "choice" && stage.choice && hasScene(line)
                                    && <button type="button" disabled={waiting} onClick={() => play(line, optionKey => act(line, "choose", { optionKey }))}>Give your answer</button>}
                                {stage && stage.kind === "choice" && !hasScene(line) && stage.choice?.options.map(option => (
                                    <button key={option.key} type="button" className="quest-line-option" disabled={waiting} onClick={() => void act(line, "choose", { optionKey: option.key })}>
                                        <strong>{option.label}</strong><span>{option.blurb}</span>
                                    </button>
                                ))}
                                {/* A step found inside a building moves on by itself once its last clue is found there. */}
                                {!!stage?.clues?.length && <span className="hint">Found {stage.clues.filter(clue => clue.found).length} of {stage.clues.length} inside.</span>}
                                {stage && STAGE_VERB[stage.kind] && !stage.clues?.length && (stage.kind === "gather" ? (stage.need?.have ?? 0) >= (stage.need?.count ?? 1) : atStage)
                                    && <button type="button" disabled={waiting} onClick={() => void act(line, "advance")}>{STAGE_VERB[stage.kind]}</button>}
                                {stage?.kind === "make" && atStage && <button type="button" disabled={waiting} onClick={() => void act(line, "make")}>Make it</button>}
                                {line.remake && here(line.remake.place, sector)
                                    && <button type="button" disabled={waiting} onClick={() => void act(line, "make", { stageKey: line.remake!.stageKey })}>Make it again</button>}
                                {foe && atStage && mode === "sector" && <button type="button" disabled={waiting} onClick={() => play(line, () => fight(line))}>Fight {foe.name}</button>}
                                {((mode === "journal" && line.state === "active" && !line.committed)
                                    || (note?.id === line.id && note.reason === "clan-left" && (line.state === "active" || line.state === "ready")))
                                    && <button type="button" className="danger-button" disabled={waiting} onClick={() => void act(line, "abandon")}>Abandon</button>}
                            </div>
                        </div>
                    );
                })}
            </section>)}
            {scene && character && <CoastQuestScene event={scene.event} character={character} sharedImages={sharedImages} onChoice={endScene} onDone={() => endScene()} onClose={() => endScene()} />}
        </div>
    );
}

export default QuestLinesPanel;
