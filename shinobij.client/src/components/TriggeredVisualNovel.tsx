/*
 * TriggeredVisualNovel — the full vnPages visual-novel reader for creator /
 * story / aura-sphere trigger events. Renders the multi-page scene UI with
 * portrait slots, dialogue, branching choices, and a finale panel. Extracted
 * verbatim from App.tsx; pure presentational leaf (native HTML only). CreatorEvent
 * is type-imported from ../App (erased at compile time — no runtime cycle).
 */

import { useState } from "react";
import type { CreatorEvent } from "../App";
import type { Character } from "../types/character";
import { AURA_SPHERE_VN_ID } from "../constants/game";
import { rewardSummary } from "../lib/currency";
import { defaultVnPortrait, defaultVnScene, isChoiceAvailable, splitDialogueLine } from "../lib/vn";
import { biomeLabel } from "../data/world";

type VnChoice = NonNullable<NonNullable<CreatorEvent["vnPages"]>[number]["choices"]>[number];

export function TriggeredVisualNovel({ event, character, pageIndex, lineIndex, setPageIndex, setLineIndex, onCancel, onComplete, onBattle, onChoice, sharedImages }: { event: CreatorEvent; character: Character; pageIndex: number; lineIndex: number; setPageIndex: (index: number | ((index: number) => number)) => void; setLineIndex: (index: number | ((index: number) => number)) => void; onCancel: () => void; onComplete: () => void; onBattle: (event: CreatorEvent, battle?: NonNullable<NonNullable<CreatorEvent["vnPages"]>[number]["choices"]>[number]["battle"]) => void; onChoice?: (choice: VnChoice) => void; sharedImages?: Record<string, string> }) {
    // The local character object can drift out of sync with the freshly-
    // uploaded avatar (server saves strip images and re-hydrate from the
    // shared image store). Resolve once via the same path the Tavern uses:
    // shared store first, then the character's own field.
    const playerAvatar =
        (sharedImages?.['avatar:' + character.name.trim().toLowerCase()]) ||
        character.avatarImage ||
        "";
    const pages = event.vnPages && event.vnPages.length > 0 ? event.vnPages : [{ title: event.vnTitle || event.name, scene: event.vnScene || "", speaker: event.vnSpeaker || "Narrator", dialogue: event.dialogue, image: event.image }];
    const page = pages[Math.min(pageIndex, pages.length - 1)];
    const pageDialogue = page.dialogue.length > 0 ? page.dialogue : event.dialogue;
    const activeLine = pageDialogue[lineIndex] ?? pageDialogue[0] ?? page.scene ?? "The scene begins.";
    const { speaker, text: spoken } = splitDialogueLine(activeLine, page.speaker || event.vnSpeaker || "Narrator");
    const pageImage = page.image || event.image || defaultVnScene(event.id, event.biome);
    const savedRightWasPlayer = (page.rightName ?? "").trim().toLowerCase() === "player";
    const leftName = savedRightWasPlayer ? "Player" : (page.leftName || "Player");
    const rightName = savedRightWasPlayer ? (page.leftName || page.speaker || event.vnSpeaker || speaker) : (page.rightName || page.speaker || event.vnSpeaker || speaker);
    const leftInitials = leftName === "Narrator" ? "..." : leftName.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
    const rightInitials = rightName.toLowerCase() === "player" ? character.name.slice(0, 2).toUpperCase() : rightName.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
    const leftImage = savedRightWasPlayer
        ? playerAvatar
        : (page.leftImage || (leftName.toLowerCase() === "player" ? playerAvatar : "") || defaultVnPortrait(leftName));
    const rightImage = savedRightWasPlayer
        ? (page.leftImage || page.rightImage || event.avatarImage || "" || defaultVnPortrait(rightName))
        : (page.rightImage || event.avatarImage || "" || defaultVnPortrait(rightName));
    // Hide a portrait slot entirely when there is genuinely nothing to show
    // (the Narrator or an NPC without a configured image AND no /portraits/<slug>.png
    // on disk). The dialogue's <speaker> label already tells the player who's talking.
    const hideLeft  = !leftImage  && leftName.trim().toLowerCase() === "narrator";
    const hideRight = !rightImage && rightName.trim().toLowerCase() === "narrator";
    const canBack = lineIndex > 0 || pageIndex > 0;
    const isLastLine = pageIndex === pages.length - 1 && lineIndex >= pageDialogue.length - 1;
    // Trait-gated branching: a choice with requireTrait only shows if the player
    // has earned it; forbidTrait hides it once earned. Choices without either
    // field (i.e. every existing VN) are always shown — no behavior change.
    const playerTraits = character.storyTraits ?? [];
    const pageChoices = page.choices?.filter((c) => !!c.text && isChoiceAvailable(c, playerTraits));
    const isAtChoicePoint = lineIndex >= pageDialogue.length - 1 && !!pageChoices?.length;
    const [showFinale, setShowFinale] = useState(false);
    const [pendingChoice, setPendingChoice] = useState<{ conclusion: string; nextPage: number } | null>(null);
    const isAuraSphereEvent = event.id === AURA_SPHERE_VN_ID;
    const isStoryChapterEvent = event.id.startsWith("story-");
    function previousLine() { if (lineIndex > 0) return setLineIndex((index) => index - 1); if (pageIndex > 0) { const previousPage = pages[pageIndex - 1]; setPageIndex((index) => index - 1); setLineIndex(Math.max(0, ((previousPage.dialogue.length || 1) - 1))); } }
    function nextLine() { if (isAtChoicePoint) return; if (lineIndex < pageDialogue.length - 1) return setLineIndex((index) => index + 1); if (pageIndex < pages.length - 1) { setPageIndex((index) => index + 1); setLineIndex(0); return; } setShowFinale(true); }
    function chooseOption(choice: VnChoice) {
        // Record the trait this choice grants (additive, deduped) before doing
        // anything else, so it persists even when the choice leads to a battle.
        onChoice?.(choice);
        if (choice.battle) {
            onBattle(event, choice.battle);
            return;
        }
        const target = Math.max(0, Math.min(pages.length - 1, choice.nextPage));
        if (choice.conclusion?.trim()) { setPendingChoice({ conclusion: choice.conclusion.trim(), nextPage: target }); }
        else { setPageIndex(target); setLineIndex(0); }
    }
    function confirmPendingChoice() { if (!pendingChoice) return; setPageIndex(pendingChoice.nextPage); setLineIndex(0); setPendingChoice(null); }
    if (showFinale) return (
        <div className="card cinematic-card vn-finale-panel">
            <div className="vn-finale-header">
                <p className="act-label">SCENE COMPLETE</p>
                <h2>{event.name}</h2>
            </div>
            <div className="vn-finale-body">
                <p className="vn-scene-card">
                    {isAuraSphereEvent
                        ? "The elder places the Aura Sphere in your hands. It waits in your inventory until you equip it in your aura slot."
                        : isStoryChapterEvent
                            ? <>The scene fades. Your village story continues — face the chapter boss when you are ready.</>
                            : <>The scene fades — a shinobi challenger steps from the shadows of <strong>{biomeLabel(event.biome)}</strong>. The fight is not over.</>}
                </p>
            </div>
            <div className="menu">
                {!isAuraSphereEvent && !isStoryChapterEvent ? (
                    <>
                        <button className="admin-button" onClick={() => onBattle(event)}>
                            Enter Battle — {biomeLabel(event.biome)}
                        </button>
                        {/* No free "skip & claim": a combat event's reward is paid only on
                            WINNING the fight (completePendingArenaStoryBattle). Leaving here
                            dismisses the event with no reward. */}
                        <button onClick={onCancel}>
                            Leave — No Reward
                        </button>
                    </>
                ) : (
                    <button onClick={onComplete}>
                        {isAuraSphereEvent ? "Claim Aura Sphere" : "Continue to Story Hall"}
                    </button>
                )}
            </div>
            <div className="vn-reward-strip">
                <span>
                    {isAuraSphereEvent
                        ? "Reward: Aura Sphere item"
                        : isStoryChapterEvent
                            ? "Defeat the chapter boss in Story Hall to earn XP and ryo."
                            : `Reward: ${rewardSummary(event.xpReward, event.ryoReward, event.staminaReward, event.currencyRewards)}`}
                </span>
            </div>
        </div>
    );
    return (
        <div className="card cinematic-card">
            <button onClick={onCancel}>Skip Scene</button>
            <div className="visual-novel admin-vn-play">
                <div className="vn-header">
                    <div>
                        <p className="act-label">TRIGGERED STORY EVENT</p>
                        <h2>{page.title || event.vnTitle || event.name}</h2>
                    </div>
                    <div className="vn-progress">Page {pageIndex + 1}/{pages.length} | Line {lineIndex + 1}/{Math.max(1, pageDialogue.length)}</div>
                </div>
                <div className={"vn-stage vn-biome-" + event.biome + (pageImage ? " vn-has-image" : "")} style={pageImage ? { backgroundImage: `linear-gradient(180deg, rgba(7,12,27,.18), rgba(7,12,27,.78)), url(${pageImage})` } : undefined}>
                    <div className="vn-backdrop"><span className="vn-village-silhouette"></span></div>
                    {!hideLeft && (
                        <div className="vn-character mentor-character">
                            {leftImage
                                ? <img src={leftImage} alt={leftName} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                                : null}
                            <span className="vn-character-initials">{leftInitials}</span>
                        </div>
                    )}
                    {!hideRight && (
                        <div className="vn-character hero-character">
                            {rightImage
                                ? <img src={rightImage} alt={rightName} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                                : null}
                            <span className="vn-character-initials">{rightInitials}</span>
                        </div>
                    )}
                    <div className="vn-scene-card">{page.scene || event.vnScene || "An event interrupts your path."}</div>
                    <div className="vn-dialogue">
                        <div className="vn-speaker">{speaker}</div>
                        <p>{spoken}</p>
                        {pendingChoice ? (
                            <div className="vn-conclusion">
                                <p className="vn-conclusion-text">{pendingChoice.conclusion}</p>
                                <div className="vn-controls">
                                    <button onClick={confirmPendingChoice}>Continue</button>
                                </div>
                            </div>
                        ) : isAtChoicePoint ? (
                            <div className="vn-choices">
                                {pageChoices!.map((choice, i) => (
                                    <button key={i} className="vn-choice-btn" onClick={() => chooseOption(choice)}>
                                        {choice.text}
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="vn-controls">
                                <button disabled={!canBack} onClick={previousLine}>Back</button>
                                <button onClick={nextLine}>{isLastLine ? "Begin Battle" : "Next"}</button>
                            </div>
                        )}
                    </div>
                </div>
                <div className="vn-choice-row">
                    <button onClick={() => { setPageIndex(0); setLineIndex(0); }}>Replay Scene</button>
                    <button onClick={() => onBattle(event)}>Battle in {biomeLabel(event.biome)}</button>
                    <button onClick={onComplete}>Claim Reward + Continue</button>
                </div>
                <div className="vn-reward-strip">
                    <span>Trigger: {event.trigger === "firstBattleArena" ? "First Battle Arena click" : "First Village exit"}</span>
                    <span>Reward: {rewardSummary(event.xpReward, event.ryoReward, event.staminaReward, event.currencyRewards)}</span>
                </div>
            </div>
        </div>
    );
}
