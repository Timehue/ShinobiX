/*
 * Story Hall archive. This deliberately returns completed story beats only:
 * no future chapter names, level gates, waiting interludes, or live choices are
 * put in the DOM. Replays use a branch-resolved, reward-free event plus an
 * accessible transcript, so revisiting one cannot grant rewards, change a lane,
 * or start another boss encounter.
 */

import { useId, useMemo, useState } from "react";
import type { Character } from "../types/character";
import { applyVnTextVars, vnTextVarsFor } from "../lib/vn";
import { buildCompletedStoryArchive, storyArchiveGuidance, type CompletedStoryArchiveEntry } from "../lib/story-archive";
import { isStoryContentVillage } from "../lib/story-content-contract";
import { readStoryContent } from "../lib/story-content-loader";
import { TriggeredVisualNovel } from "./TriggeredVisualNovel";
import { GameIcon, type GameIconName } from "./icons/GameIcon";
import "../styles/story-archive-guidance.css";

/* The archive entry icons live in the LOCKED story data as each village's
   element emoji. Rendering maps them onto the matching village glyphs from the
   icon package (the no-emoji-icon rule); an icon the map doesn't know renders
   as authored, so custom content keeps whatever it declared. */
const ARCHIVE_ICON_GLYPH: Record<string, GameIconName> = {
    "⚡": "bolt",
    "❄": "snow",
    "🌙": "moon",
    "🌿": "leaf",
};

function ArchiveIcon({ icon }: { icon: string }) {
    const glyph = ARCHIVE_ICON_GLYPH[icon];
    return glyph ? <GameIcon name={glyph} size={18} /> : <>{icon}</>;
}

export function StoryJourney({ character, onReturnToVillage }: { character: Character; onReturnToVillage?: () => void }) {
    const village = character.storyVillage || character.village;
    if (!isStoryContentVillage(village)) throw new Error(`No story content is published for ${village || "this village"}.`);
    const content = readStoryContent(village);
    const [openId, setOpenId] = useState<string | null>(null);
    const [replayEntry, setReplayEntry] = useState<CompletedStoryArchiveEntry | null>(null);
    const [replayPage, setReplayPage] = useState(0);
    const [replayLine, setReplayLine] = useState(0);
    const archiveHeadingId = useId();
    const guidanceHeadingId = useId();
    const textVars = useMemo(() => vnTextVarsFor(character), [character]);
    const archive = useMemo(() => buildCompletedStoryArchive(character, content), [character, content]);
    const guidance = storyArchiveGuidance(character, content);

    function openCinematicReplay(entry: CompletedStoryArchiveEntry) {
        setReplayPage(0);
        setReplayLine(0);
        setReplayEntry(entry);
    }

    function closeCinematicReplay() {
        setReplayEntry(null);
        setReplayPage(0);
        setReplayLine(0);
    }

    const cinematicReplay = replayEntry ? (
        <TriggeredVisualNovel
            event={replayEntry.replayEvent}
            character={character}
            pageIndex={replayPage}
            lineIndex={replayLine}
            setPageIndex={setReplayPage}
            setLineIndex={setReplayLine}
            onCancel={closeCinematicReplay}
            onComplete={closeCinematicReplay}
            onBattle={closeCinematicReplay}
            readOnlyReplay
        />
    ) : null;

    const guidancePanel = (
        <aside className={`story-archive-guidance is-${guidance.state}`} aria-labelledby={guidanceHeadingId}>
            <div>
                <p className="story-archive-guidance__kicker">{guidance.kicker}</p>
                <h3 id={guidanceHeadingId}>{guidance.title}</h3>
                <p>{guidance.body}</p>
                {guidance.state !== "complete" && (
                    <p className="story-archive-guidance__recovery">
                        Unfinished chapters are never consumed or archived. If a battle or reward seal was interrupted, reload and the current chapter can be offered again.
                    </p>
                )}
            </div>
            {guidance.actionLabel && onReturnToVillage ? (
                <button type="button" onClick={onReturnToVillage}>{guidance.actionLabel}</button>
            ) : null}
        </aside>
    );

    if (archive.length === 0) {
        return (
            <>
                {cinematicReplay}
                <section className="story-archive story-archive-empty" aria-labelledby={archiveHeadingId}>
                    <div className="story-archive-heading">
                        <div>
                            <p className="act-label">VILLAGE CHRONICLE</p>
                            <h2 id={archiveHeadingId}>Completed stories</h2>
                        </div>
                        <span className="story-archive-count">0 archived</span>
                    </div>
                    {guidancePanel}
                    <p>Your first completed chapter will be preserved here. Unfinished and future storylines remain off the shelf.</p>
                </section>
            </>
        );
    }

    return (
        <>
        {cinematicReplay}
        <section className="story-archive" aria-labelledby={archiveHeadingId}>
            <div className="story-archive-heading">
                <div>
                    <p className="act-label">VILLAGE CHRONICLE</p>
                    <h2 id={archiveHeadingId}>Completed stories</h2>
                </div>
                <span className="story-archive-count">{archive.length} archived</span>
            </div>
            <p className="story-archive-intro">
                A permanent, read-only record of the chapters and choices you have finished.
            </p>
            {guidancePanel}
            <div className="story-archive-list">
                {archive.map((entry) => {
                    const open = openId === entry.id;
                    const panelId = `${archiveHeadingId}-${entry.id}`;
                    return (
                        <article key={entry.id} className={`story-archive-entry is-${entry.kind}`}>
                            <button
                                type="button"
                                className="story-archive-toggle"
                                aria-expanded={open}
                                aria-controls={panelId}
                                onClick={() => setOpenId(open ? null : entry.id)}
                            >
                                <span className="story-archive-icon" aria-hidden="true"><ArchiveIcon icon={entry.icon} /></span>
                                <span className="story-archive-label">
                                    <small>{entry.eyebrow}</small>
                                    <strong>{entry.title}</strong>
                                </span>
                                <span className="story-archive-action" aria-hidden="true">{open ? "Close" : "Read"}</span>
                            </button>
                            {open && (
                                <div id={panelId} className="story-archive-replay">
                                    <div className="story-archive-replay-actions">
                                        <button type="button" onClick={() => openCinematicReplay(entry)}>
                                            <span aria-hidden="true">▶</span> Watch cinematic replay
                                        </button>
                                        <span>Read-only · follows your recorded path</span>
                                    </div>
                                    {entry.pages.map((page, pageIndex) => (
                                        <section key={`${entry.id}-${pageIndex}`} className="story-archive-page">
                                            {page.image && (
                                                <img
                                                    src={page.image}
                                                    alt=""
                                                    loading="lazy"
                                                    decoding="async"
                                                    onError={(event) => { event.currentTarget.style.display = "none"; }}
                                                />
                                            )}
                                            <div className="story-archive-copy">
                                                <h4>{page.title}</h4>
                                                <p className="story-archive-scene">{applyVnTextVars(page.scene, textVars)}</p>
                                                <div className="story-archive-transcript">
                                                    {page.lines.map((line, lineIndex) => (
                                                        <p key={lineIndex}>
                                                            <strong>{line.speaker}</strong>
                                                            <span>{applyVnTextVars(line.text, textVars)}</span>
                                                        </p>
                                                    ))}
                                                </div>
                                            </div>
                                        </section>
                                    ))}
                                    {entry.decisions.length > 0 && (
                                        <div className="story-archive-choice">
                                            <small>Your recorded {entry.decisions.length === 1 ? "decision" : "decisions"}</small>
                                            <div className="story-archive-decisions">
                                                {entry.decisions.map((decision, decisionIndex) => (
                                                    <div key={`${entry.id}-decision-${decisionIndex}`}>
                                                        <strong>{applyVnTextVars(decision.text, textVars)}</strong>
                                                        {decision.conclusion && <p>{applyVnTextVars(decision.conclusion, textVars)}</p>}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </article>
                    );
                })}
            </div>
        </section>
        </>
    );
}
