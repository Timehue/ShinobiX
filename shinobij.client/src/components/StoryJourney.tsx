/*
 * Story Hall archive. This deliberately returns completed story beats only:
 * no future chapter names, level gates, waiting interludes, or live choices are
 * put in the DOM. Replays are transcripts, so opening one cannot grant rewards,
 * change a lane, or start another boss encounter.
 */

import { useId, useMemo, useState } from "react";
import type { Character } from "../types/character";
import { applyVnTextVars, vnTextVarsFor } from "../lib/vn";
import { buildCompletedStoryArchive } from "../lib/story-archive";

export function StoryJourney({ character }: { character: Character }) {
    const [openId, setOpenId] = useState<string | null>(null);
    const archiveHeadingId = useId();
    const textVars = useMemo(() => vnTextVarsFor(character), [character]);
    const archive = useMemo(() => buildCompletedStoryArchive(character), [character]);

    if (archive.length === 0) {
        return (
            <section className="story-archive story-archive-empty" aria-labelledby={archiveHeadingId}>
                <div className="story-archive-heading">
                    <div>
                        <p className="act-label">VILLAGE CHRONICLE</p>
                        <h2 id={archiveHeadingId}>Completed stories</h2>
                    </div>
                    <span className="story-archive-count">0 archived</span>
                </div>
                <p>Your first completed chapter will be preserved here. Unfinished and future storylines remain off the shelf.</p>
            </section>
        );
    }

    return (
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
                                <span className="story-archive-icon" aria-hidden="true">{entry.icon}</span>
                                <span className="story-archive-label">
                                    <small>{entry.eyebrow}</small>
                                    <strong>{entry.title}</strong>
                                </span>
                                <span className="story-archive-action" aria-hidden="true">{open ? "Close" : "Read"}</span>
                            </button>
                            {open && (
                                <div id={panelId} className="story-archive-replay">
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
                                    {entry.chosen && (
                                        <div className="story-archive-choice">
                                            <small>Your recorded choice</small>
                                            <strong>{applyVnTextVars(entry.chosen.text, textVars)}</strong>
                                            {entry.chosen.conclusion && <p>{applyVnTextVars(entry.chosen.conclusion, textVars)}</p>}
                                        </div>
                                    )}
                                </div>
                            )}
                        </article>
                    );
                })}
            </div>
        </section>
    );
}
