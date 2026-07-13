/*
 * JourneyGuide — the village's top-left first-session panel. During the
 * Academy tutorial it renders the starter COMPANION's guided-step checklist
 * (the same 9 beats the OnboardingCoach speech bubble walks through), so the
 * two never give competing instructions: the panel is the status roadmap, the
 * bubble carries the current instruction + action button.
 *
 * The old objective-list Journey Guide (lib/journey-guide.ts buildJourneyGuide)
 * only ever showed during the tutorial, so this replaces its render entirely;
 * the lib builder stays as the tested spec for logbook/daily-briefing parity.
 * After the tutorial ("done") the panel hides, as before.
 */
import { useState } from "react";
import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import { buildCompanionSteps } from "../lib/journey-guide";
import { petPoseImage } from "../lib/pet-battle-anim";
import { GameIcon } from "./icons/GameIcon";

function readCollapsed(key: string): boolean {
    try {
        const stored = localStorage.getItem(key);
        if (stored === "1") return true;
        if (stored === "0") return false;
        // No saved preference: default COLLAPSED on phones, where the coach
        // speech bubble already carries the current step + action and the full
        // roadmap would otherwise overlap it. Expanded by default on desktop.
        return typeof window !== "undefined" && window.innerWidth <= 800;
    } catch {
        return false;
    }
}

function writeCollapsed(key: string, collapsed: boolean) {
    try {
        // Store the explicit choice both ways so it sticks past the mobile
        // default (an expand on mobile must not re-collapse on the next mount).
        localStorage.setItem(key, collapsed ? "1" : "0");
    } catch {
        // Storage can be disabled; the guide still works for this session.
    }
}

export function JourneyGuide({
    character,
}: {
    character: Character;
    setScreen: (screen: Screen) => void;
}) {
    const storageKey = `journeyGuideCollapsed:${character.name}`;
    const [collapsed, setCollapsedState] = useState(() => readCollapsed(storageKey));
    const steps = buildCompanionSteps(character);

    if (!steps) return null;

    const setCollapsed = (next: boolean) => {
        setCollapsedState(next);
        writeCollapsed(storageKey, next);
    };
    const guidePet = character.pets.find((p) => p.id === character.activePetId) ?? character.pets[0] ?? null;
    const guideArt = guidePet ? petPoseImage(guidePet, {}) : "";
    const doneCount = steps.filter((s) => s.state === "done").length;
    const current = steps.find((s) => s.state === "now");

    const petBadge = guideArt && (
        <img
            src={guideArt}
            alt=""
            style={{ width: 44, height: 44, objectFit: "contain", flexShrink: 0, filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.5))" }}
            onError={(e) => { e.currentTarget.style.display = "none"; }}
        />
    );

    if (collapsed) {
        return (
            <aside className="journey-guide journey-guide-collapsed" aria-label="Companion guidance">
                <div>
                    <strong><GameIcon name="target" size={15} /> {guidePet?.name ?? "Academy Guide"}</strong>
                    <span>{current?.title ?? "Academy Training"}</span>
                </div>
                <button type="button" className="journey-guide-icon-btn" onClick={() => setCollapsed(false)} aria-label="Show companion guidance details">
                    +
                </button>
            </aside>
        );
    }

    return (
        <aside className="journey-guide" aria-label="Companion guidance">
            <div className="journey-guide-header">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {petBadge}
                    <div>
                        <span className="journey-guide-kicker">Your Companion's Guidance</span>
                        <h2>{guidePet ? `${guidePet.name}'s Path` : "Academy Path"}</h2>
                    </div>
                </div>
                <button type="button" className="journey-guide-icon-btn" onClick={() => setCollapsed(true)} aria-label="Collapse companion guidance">
                    -
                </button>
            </div>
            <p className="journey-guide-arrival">
                Welcome to {character.village}. {guidePet ? `${guidePet.name} will walk you through each step below.` : "Your guide will walk you through each step below."}
            </p>
            <div className="journey-guide-progress" aria-label={`${doneCount} of ${steps.length} training steps complete`}>
                <span>{doneCount}/{steps.length} complete</span>
                <div>
                    <i style={{ width: `${Math.round((doneCount / steps.length) * 100)}%` }} />
                </div>
            </div>
            <ol className="journey-guide-list">
                {steps.map((step) => (
                    <li className={step.state === "done" ? "complete" : step.state === "now" ? "active" : ""} key={step.id}>
                        <span className="journey-guide-check" aria-hidden="true">
                            {step.state === "done" ? "Done" : step.state === "now" ? "Now" : "Next"}
                        </span>
                        <div>
                            <strong>{step.title}</strong>
                        </div>
                    </li>
                ))}
            </ol>
            <div className="journey-guide-footer">
                <span>Follow {guidePet?.name ?? "your guide"}&apos;s speech bubble below — it always points at the next step.</span>
            </div>
        </aside>
    );
}
