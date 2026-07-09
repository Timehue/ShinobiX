/*
 * StoryJourney — the "story so far" replay panel in the Story Hall (owner
 * decision 6, docs/fable-5-story-rebuild.md §11): milestone chapters and
 * VN-only interludes merged into one level-ordered timeline. Read-only —
 * completed interludes replay their pages and show the choice actually made
 * (derived from character.storyTraits, the client mirror of the server story
 * record). Nothing here re-opens choices or grants anything.
 */

import { useState } from "react";
import type { Character } from "../types/character";
import { storylines } from "../data/storylines";
import { storyInterludesByVillage, type StoryInterlude } from "../data/story-interludes";

type JourneyEntry =
    | { kind: "chapter"; level: number; title: string; bossName: string; bossIcon: string; done: boolean }
    | { kind: "interlude"; level: number; interlude: StoryInterlude; done: boolean; chosen?: { text: string; conclusion: string } };

function buildJourney(character: Character): JourneyEntry[] {
    const village = character.storyVillage || character.village;
    const traits = character.storyTraits ?? [];
    const chapters = (storylines[village] ?? []).map((step, index): JourneyEntry => ({
        kind: "chapter",
        level: step.levelReq,
        title: step.title,
        bossName: step.bossName,
        bossIcon: step.bossIcon,
        done: (character.storyProgress ?? 0) > index,
    }));
    const interludes = (storyInterludesByVillage[village] ?? []).map((interlude): JourneyEntry => {
        const choices = interlude.pages[interlude.pages.length - 1].choices ?? [];
        const picked = choices.find((choice) => traits.includes(choice.trait));
        return {
            kind: "interlude",
            level: interlude.levelReq,
            interlude,
            done: !!picked,
            chosen: picked ? { text: picked.text, conclusion: picked.conclusion } : undefined,
        };
    });
    return [...chapters, ...interludes].sort((a, b) => a.level - b.level);
}

export function StoryJourney({ character }: { character: Character }) {
    const [openId, setOpenId] = useState<string | null>(null);
    const journey = buildJourney(character);
    const doneCount = journey.filter((entry) => entry.done).length;
    if (doneCount === 0) return null; // nothing lived yet — no empty shelf

    return (
        <div className="summary-box story-journey">
            <h3>The Story So Far — {doneCount}/{journey.length} beats</h3>
            <div className="story-journey-list">
                {journey.map((entry) => {
                    if (entry.kind === "chapter") {
                        return (
                            <div key={`ch-${entry.level}`} className={"story-journey-row" + (entry.done ? "" : " story-journey-locked")}>
                                <span className="tile-icon">{entry.done ? entry.bossIcon : "🔒"}</span>
                                <span>
                                    <strong>{entry.title}</strong>
                                    <small> — Chapter, level {entry.level}{entry.done ? ` · ${entry.bossName} defeated` : ""}</small>
                                </span>
                            </div>
                        );
                    }
                    const { interlude } = entry;
                    if (!entry.done) {
                        const eligible = character.level >= interlude.levelReq && (character.storyProgress ?? 0) >= interlude.minProgress;
                        return (
                            <div key={interlude.id} className="story-journey-row story-journey-locked">
                                <span className="tile-icon">{eligible ? "📜" : "🔒"}</span>
                                <span>
                                    <strong>{eligible ? interlude.title : "???"}</strong>
                                    <small> — {eligible ? "a scene is waiting for you" : `level ${interlude.levelReq}`}</small>
                                </span>
                            </div>
                        );
                    }
                    const open = openId === interlude.id;
                    return (
                        <div key={interlude.id} className="story-journey-row story-journey-done">
                            <button className="story-journey-toggle" onClick={() => setOpenId(open ? null : interlude.id)}>
                                <span className="tile-icon">📜</span>
                                <span>
                                    <strong>{interlude.title}</strong>
                                    <small> — level {interlude.levelReq} · {open ? "close" : "replay"}</small>
                                </span>
                            </button>
                            {open && (
                                <div className="story-journey-replay">
                                    <img
                                        src={`/scenes/story/${interlude.id}.webp`}
                                        alt=""
                                        className="story-journey-scene"
                                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                                    />
                                    {interlude.pages.map((page, pageIndex) => (
                                        <div key={pageIndex} className="story-journey-page">
                                            <em>{page.scene}</em>
                                            {page.dialogue.map((line, lineIndex) => (
                                                <p key={lineIndex}><strong>{page.speaker}:</strong> {line}</p>
                                            ))}
                                        </div>
                                    ))}
                                    {entry.chosen && (
                                        <div className="story-journey-choice">
                                            <p><strong>You chose:</strong> {entry.chosen.text}</p>
                                            <p>{entry.chosen.conclusion}</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
