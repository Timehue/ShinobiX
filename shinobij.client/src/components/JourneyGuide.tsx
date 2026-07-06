import { useState } from "react";
import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import { buildJourneyGuide } from "../lib/journey-guide";
import { GameIcon } from "./icons/GameIcon";

function readCollapsed(key: string): boolean {
    try {
        return localStorage.getItem(key) === "1";
    } catch {
        return false;
    }
}

function writeCollapsed(key: string, collapsed: boolean) {
    try {
        if (collapsed) localStorage.setItem(key, "1");
        else localStorage.removeItem(key);
    } catch {
        // Storage can be disabled; the guide still works for this session.
    }
}

export function JourneyGuide({
    character,
    setScreen,
}: {
    character: Character;
    setScreen: (screen: Screen) => void;
}) {
    const storageKey = `journeyGuideCollapsed:${character.name}`;
    const [collapsed, setCollapsedState] = useState(() => readCollapsed(storageKey));
    const guide = buildJourneyGuide(character);

    if (!guide.shouldShow || !guide.primaryObjective) return null;

    const setCollapsed = (next: boolean) => {
        setCollapsedState(next);
        writeCollapsed(storageKey, next);
    };
    const primary = guide.primaryObjective;

    if (collapsed) {
        return (
            <aside className="journey-guide journey-guide-collapsed" aria-label="Journey Guide">
                <div>
                    <strong><GameIcon name="target" size={15} /> Journey Guide</strong>
                    <span>{primary.title}</span>
                </div>
                <button type="button" onClick={() => setScreen(primary.screen)}>
                    {primary.actionLabel}
                </button>
                <button type="button" className="journey-guide-icon-btn" onClick={() => setCollapsed(false)} aria-label="Show Journey Guide details">
                    +
                </button>
            </aside>
        );
    }

    return (
        <aside className="journey-guide" aria-label="Journey Guide">
            <div className="journey-guide-header">
                <div>
                    <span className="journey-guide-kicker">First Steps</span>
                    <h2>Journey Guide</h2>
                </div>
                <button type="button" className="journey-guide-icon-btn" onClick={() => setCollapsed(true)} aria-label="Collapse Journey Guide">
                    -
                </button>
            </div>
            <p className="journey-guide-arrival">
                Welcome to {character.village}. Train your body, take rookie missions, and earn your place in the village.
            </p>
            <div className="journey-guide-progress" aria-label={`${guide.completedCount} of ${guide.totalCount} first steps complete`}>
                <span>{guide.completedCount}/{guide.totalCount} complete</span>
                <div>
                    <i style={{ width: `${Math.round((guide.completedCount / guide.totalCount) * 100)}%` }} />
                </div>
            </div>
            <ol className="journey-guide-list">
                {guide.objectives.map((objective) => (
                    <li className={objective.complete ? "complete" : objective.id === primary.id ? "active" : ""} key={objective.id}>
                        <span className="journey-guide-check" aria-hidden="true">{objective.complete ? "Done" : "Next"}</span>
                        <div>
                            <strong>{objective.title}</strong>
                            <small>{objective.detail}</small>
                        </div>
                        {!objective.complete && (
                            <button type="button" onClick={() => setScreen(objective.screen)}>
                                {objective.actionLabel}
                            </button>
                        )}
                    </li>
                ))}
            </ol>
            <div className="journey-guide-footer">
                <button type="button" className="start-primary-btn" onClick={() => setScreen(primary.screen)}>
                    {primary.actionLabel}
                </button>
                <span>Rewards come from the existing mission, training, and Logbook claims.</span>
            </div>
        </aside>
    );
}
