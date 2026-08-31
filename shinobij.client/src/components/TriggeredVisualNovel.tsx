/*
 * TriggeredVisualNovel — the full vnPages visual-novel reader for creator /
 * story / aura-sphere trigger events. Renders the multi-page scene UI with
 * portrait slots, dialogue, branching choices, and a finale panel. Extracted
 * verbatim from App.tsx; pure presentational leaf (native HTML only). Its event
 * contract comes directly from types/vn so isolated reader checks never pull
 * the App monolith or unrelated screen code into the type graph.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Character } from "../types/character";
import type { CreatorEvent } from "../types/vn";
import { AURA_SPHERE_VN_ID } from "../constants/game";
import { rewardSummary } from "../lib/currency";
import { applyVnTextVars, vnTextVarsFor, defaultVnPortrait, defaultVnScene, hidePlayerPortraitDuringNarration, isChoiceAvailable, resolveVnActorBaseImage, resolveVnAuthoredActorImage, splitDialogueLine } from "../lib/vn";
import { claimVnAction } from "../lib/vn-action-gate";
import { biomeLabel } from "../data/world";
import { isLowEndMobile, prefersReducedMotion } from "../lib/device-tier";
import { resolveCinematicActorImage, resolveVnPresentation } from "../lib/vn-presentation";
import { CinematicVisualNovelStage } from "./CinematicVisualNovelStage";

type VnChoice = NonNullable<NonNullable<CreatorEvent["vnPages"]>[number]["choices"]>[number];

function initialClassicReader(): boolean {
    if (typeof window === "undefined") return false;
    try {
        return window.localStorage.getItem("vnReaderMode.v1") === "classic";
    } catch {
        return false;
    }
}

export function TriggeredVisualNovel({ event, character, pageIndex, lineIndex, setPageIndex, setLineIndex, onCancel, onComplete, onBattle, onChoice, sharedImages, surface = "immersive", readOnlyReplay = false }: { event: CreatorEvent; character: Character; pageIndex: number; lineIndex: number; setPageIndex: (index: number | ((index: number) => number)) => void; setLineIndex: (index: number | ((index: number) => number)) => void; onCancel: () => void; onComplete: () => void; onBattle: (event: CreatorEvent, battle?: NonNullable<NonNullable<CreatorEvent["vnPages"]>[number]["choices"]>[number]["battle"]) => void; onChoice?: (choice: VnChoice) => void; sharedImages?: Record<string, string>; surface?: "immersive" | "preview" | "classic"; /** Story Hall playback: presentation only, with every mutation/battle affordance removed by the caller. */ readOnlyReplay?: boolean }) {
    // The local character object can drift out of sync with the freshly-
    // uploaded avatar (server saves strip images and re-hydrate from the
    // shared image store). Resolve once via the same path the Tavern uses:
    // shared store first, then the character's own field.
    const playerAvatar =
        (sharedImages?.['avatar:' + character.name.trim().toLowerCase()]) ||
        character.avatarImage ||
        "";
    // %name / %pet substitution vars, resolved once per render.
    const textVars = vnTextVarsFor(character);
    const pages = event.vnPages && event.vnPages.length > 0 ? event.vnPages : [{ title: event.vnTitle || event.name, scene: event.vnScene || "", speaker: event.vnSpeaker || "Narrator", dialogue: event.dialogue, image: event.image }];
    const page = pages[Math.min(pageIndex, pages.length - 1)];
    const pageDialogue = page.dialogue.length > 0 ? page.dialogue : event.dialogue;
    const activeLine = pageDialogue[lineIndex] ?? pageDialogue[0] ?? page.scene ?? "The scene begins.";
    // Typed-dialogue storage: prefer a structured `lines[lineIndex]` when the page
    // has them; otherwise parse the legacy "Speaker: text" string. Existing VNs
    // carry no `lines`, so this resolves identically for them.
    const typedLine = page.lines?.[lineIndex];
    const { speaker, text: spoken } = typedLine ?? splitDialogueLine(activeLine, page.speaker || event.vnSpeaker || "Narrator");
    const pageImage = page.image || event.image || defaultVnScene(event.id, event.biome);
    const savedRightWasPlayer = (page.rightName ?? "").trim().toLowerCase() === "player";
    const leftName = savedRightWasPlayer ? "Player" : (page.leftName || "Player");
    const rightName = savedRightWasPlayer ? (page.leftName || page.speaker || event.vnSpeaker || speaker) : (page.rightName || page.speaker || event.vnSpeaker || speaker);
    // Speaker spotlight: dim whichever portrait isn't currently speaking. Match
    // the line's speaker to the resolved left/right name (case-insensitive); a
    // narrator line matches neither and dims no one — so it never mis-highlights.
    const speakerKey = speaker.trim().toLowerCase();
    const speakingSide = speakerKey && speakerKey === rightName.trim().toLowerCase() ? "right"
        : speakerKey && speakerKey === leftName.trim().toLowerCase() ? "left"
        : null;
    const leftInitials = leftName === "Narrator" ? "..." : leftName.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
    const rightInitials = rightName.toLowerCase() === "player" ? character.name.slice(0, 2).toUpperCase() : rightName.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
    const authoredLeftImage = savedRightWasPlayer
        ? ""
        : resolveVnAuthoredActorImage(event.id, leftName, page.leftImage);
    const authoredRightImage = resolveVnAuthoredActorImage(
        event.id,
        rightName,
        savedRightWasPlayer ? (page.leftImage || page.rightImage) : page.rightImage,
    );
    const baseLeftImage = savedRightWasPlayer
        ? playerAvatar
        : (authoredLeftImage || (leftName.toLowerCase() === "player" ? playerAvatar : defaultVnPortrait(leftName)));
    const baseRightImage = resolveVnActorBaseImage(
        event.id,
        rightName,
        authoredRightImage,
        event.avatarImage,
    );
    const canBack = lineIndex > 0 || pageIndex > 0;
    const isLastLine = pageIndex === pages.length - 1 && lineIndex >= pageDialogue.length - 1;
    // Trait-gated branching: a choice with requireTrait only shows if the player
    // has earned it; forbidTrait hides it once earned. Choices without either
    // field (i.e. every existing VN) are always shown — no behavior change.
    const playerTraits = character.storyTraits ?? [];
    const pageChoices = readOnlyReplay
        ? []
        : page.choices?.filter((c) => !!c.text && isChoiceAvailable(c, playerTraits));
    const isAtChoicePoint = lineIndex >= pageDialogue.length - 1 && !!pageChoices?.length;
    const choicePointKey = isAtChoicePoint ? `${event.id}:${pageIndex}:${lineIndex}` : "";
    const [armedChoiceKey, setArmedChoiceKey] = useState("");
    const [showFinale, setShowFinale] = useState(false);
    const [pendingChoice, setPendingChoice] = useState<{ conclusion: string; nextPage: number; battle?: VnChoice["battle"] } | null>(null);
    const [classicReader, setClassicReader] = useState(initialClassicReader);
    // React state updates are intentionally asynchronous. Without a synchronous
    // gate, two activations in the same frame can skip a line, record a choice
    // twice, or launch the same battle twice before the component re-renders.
    const actionLocked = useRef(false);
    function beginAction() {
        return claimVnAction(actionLocked);
    }
    useEffect(() => {
        actionLocked.current = false;
    }, [event.id, pageIndex, lineIndex, pendingChoice, showFinale]);
    // A rapid "Next, Next, Next" sequence used to land on a choice as soon as
    // it replaced the Next button, selecting whichever option occupied that
    // screen position. Give deliberate choices a short arm delay instead.
    useEffect(() => {
        if (!choicePointKey) return;
        const id = window.setTimeout(() => setArmedChoiceKey(choicePointKey), 650);
        return () => window.clearTimeout(id);
    }, [choicePointKey]);
    const choicesArmed = !!choicePointKey && armedChoiceKey === choicePointKey;
    const isAuraSphereEvent = event.id === AURA_SPHERE_VN_ID;
    const isStoryChapterEvent = event.id.startsWith("story-");
    // Rift VNs (lib/hollow-rifts): the wandering giver's report and the
    // at-the-rift scene. Accepting and descending leave the scene through
    // onChoice; declining and abandoning play out here, and neither has a
    // finale to show — they close back to the sector instead (see
    // advanceAfterChoice).
    const isRiftEvent = event.id.startsWith("rift-giver-") || event.id.startsWith("rift-descend-");
    // Story reckonings ("story-reckoning-*", lib/story-reckonings): roadside
    // character scenes. They start with "story-" so they used to fall into the
    // CHAPTER branch and promise "Continue to Story Hall" / a chapter reward —
    // copy that lies for a road conversation. They belong to the pure-VN family.
    const isStoryReckoningEvent = event.id.startsWith("story-reckoning-");
    // The Chronicle Scribe's traveler's-codex event (lib/chronicle-scribe).
    const isScribeEvent = event.id === "chronicle-scribe";
    // Catch-all for pure conversation scenes: a zero-reward visualNovel event
    // has nothing to claim, and its "free battle" would pay that same nothing —
    // on such events both footer buttons are traps, not affordances. Story
    // chapters are excluded: their reward rides the chapter boss, so they keep
    // their own labels.
    const isZeroRewardVn = !isStoryChapterEvent
        && event.eventKind === "visualNovel"
        // `xpReward` is deliberately NOT part of this check any more: character
        // XP is retired, so a scene carrying only an xpReward now pays literally
        // nothing — counting it would show a "Claim Reward" button that hands
        // over an empty reward line.
        && !event.ryoReward && !event.staminaReward && !event.currencyRewards;
    // Story interludes ("story-interlude-*") and road events ("story-road-*"):
    // VN-only story scenes — no free battle, no XP/ryo (road-event fights come
    // only from choices). The choice itself is the payoff, recorded server-side,
    // so the free-battle affordances are hidden and the finale copy changes.
    // 2026-07 pass widens the family to reckonings, the scribe, and any other
    // zero-reward VN so no pure conversation ever grows the generic footer.
    const isStoryInterlude = readOnlyReplay || event.id.startsWith("story-interlude-") || event.id.startsWith("story-road-") || isRiftEvent || isStoryReckoningEvent || isScribeEvent || isZeroRewardVn;
    // Post-finale ending epilogues ("story-epilogue-*", lib/story-epilogue.ts):
    // pure goodbye scenes — no battle, no reward, never re-offered.
    const isStoryEpilogue = event.id.startsWith("story-epilogue-");
    // The Wandering Sage's Legacy offer (lib/legacy-sage-vn.ts): no battle, no
    // reward — completing hands off to the offer sheet, so the finale must
    // never route into the generic "Enter Battle" dead-end.
    const isSageEvent = event.id === "legacy-sage-offer";
    const eventLabel = readOnlyReplay
        ? "Story Replay"
        : event.id.startsWith("story-road-")
            ? "Road Story"
            : isStoryEpilogue
                ? "Epilogue"
                : isStoryInterlude
                    ? "Story Interlude"
                    : isStoryChapterEvent
                        ? "Village Chronicle"
                        : "Story Event";
    const spokenText = applyVnTextVars(spoken, textVars);
    const presentation = resolveVnPresentation({
        event,
        page,
        pageIndex,
        lineIndex,
        speaker,
        speakingSide,
        pageImage,
        reducedMotion: prefersReducedMotion(),
        liteFx: isLowEndMobile(),
    });
    const leftImage = resolveCinematicActorImage(
        event.id,
        leftName,
        baseLeftImage,
        presentation.leftActorPose,
        authoredLeftImage,
    );
    const rightImage = resolveCinematicActorImage(
        event.id,
        rightName,
        baseRightImage,
        presentation.rightActorPose,
        authoredRightImage,
    );
    // Hide a portrait slot entirely when there is genuinely nothing to show
    // (the Narrator or an NPC without a configured image AND no /portraits/<slug>.png
    // on disk). The dialogue's <speaker> label already tells the player who's talking.
    const hideLeft = hidePlayerPortraitDuringNarration(speaker, leftName, authoredLeftImage)
        || (!leftImage && leftName.trim().toLowerCase() === "narrator");
    const hideRight = hidePlayerPortraitDuringNarration(speaker, rightName, authoredRightImage)
        || (!rightImage && rightName.trim().toLowerCase() === "narrator");
    const upcomingPageIndex = lineIndex < pageDialogue.length - 1 ? pageIndex : pageIndex + 1;
    const upcomingLineIndex = lineIndex < pageDialogue.length - 1 ? lineIndex + 1 : 0;
    const upcomingPage = pages[upcomingPageIndex];
    const upcomingPageDialogue = upcomingPage
        ? (upcomingPage.dialogue.length > 0 ? upcomingPage.dialogue : event.dialogue)
        : [];
    const upcomingRawLine = upcomingPageDialogue[upcomingLineIndex]
        ?? upcomingPageDialogue[0]
        ?? upcomingPage?.scene
        ?? "";
    const upcomingTypedLine = upcomingPage?.lines?.[upcomingLineIndex];
    const upcomingSpeaker = upcomingPage
        ? (upcomingTypedLine ?? splitDialogueLine(upcomingRawLine, upcomingPage.speaker || event.vnSpeaker || "Narrator")).speaker
        : "";
    const upcomingPageImage = upcomingPage
        ? (upcomingPage.image || event.image || defaultVnScene(event.id, event.biome))
        : "";
    const upcomingPresentation = upcomingPage
        ? resolveVnPresentation({
            event,
            page: upcomingPage,
            pageIndex: upcomingPageIndex,
            lineIndex: upcomingLineIndex,
            speaker: upcomingSpeaker,
            speakingSide: null,
            pageImage: upcomingPageImage,
            reducedMotion: prefersReducedMotion(),
            liteFx: isLowEndMobile(),
        })
        : null;
    const upcomingSavedRightWasPlayer = (upcomingPage?.rightName ?? "").trim().toLowerCase() === "player";
    const upcomingLeftName = upcomingPage
        ? (upcomingSavedRightWasPlayer ? "Player" : (upcomingPage.leftName || "Player"))
        : "";
    const upcomingRightName = upcomingPage
        ? (upcomingSavedRightWasPlayer
            ? (upcomingPage.leftName || upcomingPage.speaker || event.vnSpeaker || upcomingSpeaker)
            : (upcomingPage.rightName || upcomingPage.speaker || event.vnSpeaker || upcomingSpeaker))
        : "";
    const upcomingAuthoredLeftImage = upcomingPage && !upcomingSavedRightWasPlayer
        ? resolveVnAuthoredActorImage(event.id, upcomingLeftName, upcomingPage.leftImage)
        : "";
    const upcomingAuthoredRightImage = upcomingPage
        ? resolveVnAuthoredActorImage(
            event.id,
            upcomingRightName,
            upcomingSavedRightWasPlayer
                ? (upcomingPage.leftImage || upcomingPage.rightImage)
                : upcomingPage.rightImage,
        )
        : "";
    const upcomingBaseLeftImage = upcomingPage
        ? (upcomingSavedRightWasPlayer
            ? playerAvatar
            : (upcomingAuthoredLeftImage || (upcomingLeftName.toLowerCase() === "player"
                ? playerAvatar
                : defaultVnPortrait(upcomingLeftName))))
        : "";
    const upcomingBaseRightImage = upcomingPage
        ? resolveVnActorBaseImage(
            event.id,
            upcomingRightName,
            upcomingAuthoredRightImage,
            event.avatarImage,
        )
        : "";
    const upcomingLeftImage = upcomingPage && upcomingPresentation
        ? resolveCinematicActorImage(
            event.id,
            upcomingLeftName,
            upcomingBaseLeftImage,
            upcomingPresentation.leftActorPose,
            upcomingAuthoredLeftImage,
        )
        : "";
    const upcomingRightImage = upcomingPage && upcomingPresentation
        ? resolveCinematicActorImage(
            event.id,
            upcomingRightName,
            upcomingBaseRightImage,
            upcomingPresentation.rightActorPose,
            upcomingAuthoredRightImage,
        )
        : "";
    const preloadImageKey = [
        upcomingPresentation?.backgroundImage,
        upcomingLeftImage,
        upcomingRightImage,
    ].filter(Boolean).join("|");
    useEffect(() => {
        for (const source of new Set(preloadImageKey.split("|").filter(Boolean))) {
            const image = new Image();
            image.decoding = "async";
            image.src = source;
        }
    }, [preloadImageKey]);
    function useClassicReader() {
        setClassicReader(true);
        try { window.localStorage.setItem("vnReaderMode.v1", "classic"); } catch { /* private mode */ }
    }
    function useCinematicReader() {
        setClassicReader(false);
        try { window.localStorage.setItem("vnReaderMode.v1", "cinematic"); } catch { /* private mode */ }
    }
    const readerUsesClassic = surface === "classic" || (surface === "immersive" && classicReader);
    function previousLine() { if (!canBack || !beginAction()) return; setArmedChoiceKey(""); if (lineIndex > 0) return setLineIndex((index) => index - 1); if (pageIndex > 0) { const previousPage = pages[pageIndex - 1]; setPageIndex((index) => index - 1); setLineIndex(Math.max(0, ((previousPage.dialogue.length || 1) - 1))); } }
    function nextLine() { if (isAtChoicePoint || !beginAction()) return; setArmedChoiceKey(""); if (lineIndex < pageDialogue.length - 1) return setLineIndex((index) => index + 1); if (pageIndex < pages.length - 1) { setPageIndex((index) => index + 1); setLineIndex(0); return; } setShowFinale(true); }
    function chooseOption(choice: VnChoice) {
        if (readOnlyReplay || !choicesArmed || !beginAction()) return;
        // Record the trait this choice grants (additive, deduped) before doing
        // anything else, so it persists even when the choice leads to a battle.
        onChoice?.(choice);
        const target = Math.max(0, Math.min(pages.length - 1, choice.nextPage));
        // Conclusions render for battle choices too (they used to be dead there):
        // show the aftermath beat, then launch the battle from Continue.
        if (choice.conclusion?.trim()) { setPendingChoice({ conclusion: choice.conclusion.trim(), nextPage: target, battle: choice.battle }); return; }
        if (choice.battle) { onBattle(event, choice.battle); return; }
        advanceAfterChoice(target);
    }
    // A non-battle choice pointing at its own page has no forward content — the
    // scene concludes there (interludes end this way) instead of re-looping the
    // choice list forever.
    function advanceAfterChoice(target: number) {
        if (target === pageIndex) {
            // Turning a rift giver down ends the scene where the player was
            // standing. The finale would promise a fight the rift never offers
            // and claim a choice was recorded when saying no records nothing.
            // The caller already holds the action lock, so complete directly.
            // The scribe ends the same way: Ihara speaks her own goodbye in the
            // choice conclusion, so a SCENE COMPLETE panel after it is filler.
            if (isRiftEvent || isScribeEvent) { onComplete(); return; }
            setShowFinale(true);
            return;
        }
        setPageIndex(target); setLineIndex(0);
    }
    function confirmPendingChoice() {
        if (!pendingChoice || !beginAction()) return;
        const { nextPage, battle } = pendingChoice;
        setPendingChoice(null);
        if (battle) { onBattle(event, battle); return; }
        advanceAfterChoice(nextPage);
    }
    // Deliberately NOT gated on the action lock: Skip/Leave is the escape
    // hatch, and an escape hatch a held lock can disable is no hatch at all
    // (the lock is held legitimately for a moment after Enter Battle, and was
    // held forever by the pre-expiry wedge). onCancel is idempotent in every
    // host — a double-fire just clears an already-cleared event.
    function cancelScene() { onCancel(); }
    function completeScene() { if (beginAction()) onComplete(); }
    function startBattle(battle?: VnChoice["battle"]) { if (!readOnlyReplay && beginAction()) onBattle(event, battle); }
    function replayScene() {
        if (pageIndex === 0 && lineIndex === 0 && !pendingChoice) return;
        if (!beginAction()) return;
        setPageIndex(0);
        setLineIndex(0);
        setPendingChoice(null);
        setShowFinale(false);
    }
    const finaleText = readOnlyReplay
        ? "The preserved scene reaches its end. Nothing has been changed or claimed; this is the road exactly as the Chronicle remembers it."
        : isAuraSphereEvent
            ? "The elder places the Aura Sphere in your hands. It waits in your inventory until you equip it in your aura slot."
            : isSageEvent
                ? "The Sage falls silent, watching you. The paths he named still hang in the air, and only one of them can ever be yours."
                : isStoryEpilogue
                    ? "The last page of this village's story turns. What the village becomes next, it becomes with you in it."
                    : isStoryInterlude
                        ? "The road moves on. What you chose here is written down somewhere that matters."
                        : isStoryChapterEvent
                            ? "The scene settles into silence. Your village story continues. The chapter's guardian is waiting."
                            : `The scene fades. A shinobi challenger steps from the shadows of ${biomeLabel(event.biome)}.`;
    if (showFinale && !readerUsesClassic && presentation.mode === "cinematic") return (
        <CinematicVisualNovelStage
            eventId={event.id}
            eventLabel="Scene Complete"
            pageTitle={event.name}
            scene={page.scene || event.vnScene || "The scene reaches its end."}
            speaker="Chronicle"
            spoken={finaleText}
            pageIndex={pages.length - 1}
            pageCount={pages.length}
            lineIndex={0}
            lineCount={1}
            left={{ name: leftName, image: leftImage, initials: leftInitials, hidden: hideLeft || (leftName.toLowerCase() === "player" && !leftImage), player: leftName.toLowerCase() === "player" }}
            right={{ name: rightName, image: rightImage, initials: rightInitials, hidden: hideRight || (rightName.toLowerCase() === "player" && !rightImage), player: rightName.toLowerCase() === "player" }}
            presentation={{ ...presentation, titleCard: false, cue: "none", tone: "elegy", backgroundMotion: "drift" }}
            surface={surface}
            allowStageAdvance={false}
            onUseClassicReader={surface === "immersive" ? useClassicReader : undefined}
            onAdvance={() => {}}
            onCancel={cancelScene}
            renderFooter={(typingDone) => typingDone ? (
                <div className="vn-controls">
                    {!isAuraSphereEvent && !isStoryChapterEvent && !isSageEvent && !isStoryInterlude ? (
                        <>
                            <button className="admin-button" onClick={() => startBattle()}>Enter Battle</button>
                            <button onClick={cancelScene}>Leave - No Reward</button>
                        </>
                    ) : (
                        <button onClick={completeScene}>
                            {isAuraSphereEvent ? "Claim Aura Sphere" : isSageEvent ? "Hear the Sage's Offer" : isStoryInterlude ? "Continue" : "Continue to Story Hall"}
                        </button>
                    )}
                </div>
            ) : null}
        />
    );
    const stageStyle = pageImage
        ? ({
            backgroundImage: `linear-gradient(180deg, rgba(7,12,27,.18), rgba(7,12,27,.78)), url(${pageImage})`,
            "--vn-page-image": `url(${pageImage})`,
        } as CSSProperties)
        : undefined;
    if (showFinale) return (
        <div className="card cinematic-card vn-finale-panel">
            <div className="vn-finale-header">
                <p className="act-label">SCENE COMPLETE</p>
                <h2>{event.name}</h2>
            </div>
            <div className="vn-finale-body">
                <p className="vn-scene-card">
                    {readOnlyReplay
                        ? "The preserved scene reaches its end. Nothing has been changed or claimed; this is the road exactly as the Chronicle remembers it."
                        : isAuraSphereEvent
                        ? "The elder places the Aura Sphere in your hands. It waits in your inventory until you equip it in your aura slot."
                        : isSageEvent
                            ? "The Sage falls silent, watching you. The paths he named still hang in the air — and only one of them can ever be yours."
                            : isStoryEpilogue
                                ? <>The last page of this village's story turns. What the village becomes next, it becomes with you in it.</>
                                : isStoryInterlude
                                    ? <>The road moves on. What you chose here is written down somewhere that matters.</>
                                    : isStoryChapterEvent
                                        ? <>The scene fades. Your village story continues — face the chapter boss when you are ready.</>
                                        : <>The scene fades — a shinobi challenger steps from the shadows of <strong>{biomeLabel(event.biome)}</strong>. The fight is not over.</>}
                </p>
            </div>
            <div className="menu">
                {!isAuraSphereEvent && !isStoryChapterEvent && !isSageEvent && !isStoryInterlude ? (
                    <>
                        <button className="admin-button" onClick={() => startBattle()}>
                            Enter Battle — {biomeLabel(event.biome)}
                        </button>
                        {/* No free "skip & claim": combat continuation happens only after
                            the canonical server fight reports a verified win. Leaving here
                            dismisses the event with no reward. */}
                        <button onClick={cancelScene}>
                            Leave — No Reward
                        </button>
                    </>
                ) : (
                    <button onClick={completeScene}>
                        {isAuraSphereEvent ? "Claim Aura Sphere" : isSageEvent ? "Hear the Sage's Offer" : isStoryInterlude ? "Continue" : "Continue to Story Hall"}
                    </button>
                )}
            </div>
            <div className="vn-reward-strip">
                <span>
                    {readOnlyReplay
                        ? "Read-only Story Hall replay · no rewards or decisions can be changed"
                        : isAuraSphereEvent
                        ? "Reward: Aura Sphere item"
                        : isSageEvent
                            ? "One Legacy, forever. Turning him down is always free."
                            : isStoryEpilogue
                                ? "Your reckoning is written. The village remembers what you chose."
                                : isStoryInterlude
                                    ? "Your choice is recorded. The story remembers."
                                    : isStoryChapterEvent
                                        ? "Defeat the chapter boss in Story Hall to earn stat points and ryo."
                                        : `Reward: ${rewardSummary(event.ryoReward, event.staminaReward, event.currencyRewards)}`}
                </span>
            </div>
        </div>
    );
    if (!readerUsesClassic && presentation.mode === "cinematic") return (
        <CinematicVisualNovelStage
            eventId={event.id}
            eventLabel={eventLabel}
            pageTitle={page.title || event.vnTitle || event.name}
            scene={page.scene || event.vnScene || "An event interrupts your path."}
            speaker={speaker}
            spoken={spokenText}
            pageIndex={pageIndex}
            pageCount={pages.length}
            lineIndex={lineIndex}
            lineCount={Math.max(1, pageDialogue.length)}
            left={{
                name: leftName,
                image: leftImage,
                initials: leftInitials,
                hidden: hideLeft || (leftName.toLowerCase() === "player" && !leftImage),
                speaking: speakingSide === "left",
                player: leftName.toLowerCase() === "player",
            }}
            right={{
                name: rightName,
                image: rightImage,
                initials: rightInitials,
                hidden: hideRight || (rightName.toLowerCase() === "player" && !rightImage),
                speaking: speakingSide === "right",
                player: rightName.toLowerCase() === "player",
            }}
            presentation={presentation}
            surface={surface}
            allowStageAdvance={!pendingChoice && !isAtChoicePoint}
            decisionPoint={isAtChoicePoint && !pendingChoice}
            onUseClassicReader={surface === "immersive" ? useClassicReader : undefined}
            onAdvance={nextLine}
            onCancel={cancelScene}
            renderFooter={(typingDone) => {
                if (!typingDone) return null;
                if (pendingChoice) return (
                    <div className="vn-conclusion">
                        <p className="vn-conclusion-text">{applyVnTextVars(pendingChoice.conclusion, textVars)}</p>
                        <div className="vn-controls">
                            <button onClick={confirmPendingChoice}>Continue</button>
                        </div>
                    </div>
                );
                if (isAtChoicePoint) return (
                    <div className="vn-choices">
                        {pageChoices!.map((choice, index) => (
                            <button
                                key={index}
                                className="vn-choice-btn"
                                disabled={!choicesArmed}
                                title={!choicesArmed ? "Choices unlock in a moment to prevent an accidental selection" : undefined}
                                onClick={() => chooseOption(choice)}
                            >
                                {applyVnTextVars(choice.text, textVars)}
                            </button>
                        ))}
                        {!choicesArmed && <span className="hint">Choices unlock in a moment&hellip;</span>}
                    </div>
                );
                return (
                    <div className="vn-controls">
                        <button disabled={!canBack} onClick={previousLine}>Back</button>
                        <button onClick={nextLine}>{isLastLine ? (isSageEvent || isStoryInterlude || isStoryEpilogue ? "Continue" : "Begin Battle") : "Next"}</button>
                    </div>
                );
            }}
        />
    );
    return (
        <div className="card cinematic-card">
            <div className="visual-novel admin-vn-play">
                <div className="vn-header">
                    <div>
                        <p className="act-label">{event.id.startsWith("story-road-") ? "ROAD STORY" : isStoryEpilogue ? "EPILOGUE" : isStoryInterlude ? "STORY INTERLUDE" : "TRIGGERED STORY EVENT"}</p>
                        <h2>{page.title || event.vnTitle || event.name}</h2>
                    </div>
                    <div className="vn-header-actions">
                        <div className="vn-progress">Page {pageIndex + 1}/{pages.length} | Line {lineIndex + 1}/{Math.max(1, pageDialogue.length)}</div>
                        {surface === "immersive" && classicReader && presentation.mode === "cinematic" && (
                            <button type="button" className="vn-skip-button" onClick={useCinematicReader}>Cinematic Mode</button>
                        )}
                        <button type="button" className="vn-skip-button" onClick={cancelScene} aria-label="Skip visual novel scene">Skip Scene</button>
                    </div>
                </div>
                <div className={"vn-stage vn-biome-" + event.biome + (pageImage ? " vn-has-image" : "")} style={stageStyle}>
                    {/* Scene picture (backdrop + portraits + narration). On mobile
                        this becomes a fixed-height block and the dialogue stacks
                        BELOW it (vn-picture display:contents on desktop = no change). */}
                    <div className="vn-picture">
                    <div className="vn-backdrop"><span className="vn-village-silhouette"></span></div>
                    {!hideLeft && (
                        <div className={"vn-character mentor-character" + (speakingSide === "left" ? " vn-speaking" : speakingSide === "right" ? " vn-dimmed" : "")}>
                            {leftImage
                                ? <img src={leftImage} alt={leftName} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                                : null}
                            <span className="vn-character-initials">{leftInitials}</span>
                        </div>
                    )}
                    {!hideRight && (
                        <div className={"vn-character hero-character" + (speakingSide === "right" ? " vn-speaking" : speakingSide === "left" ? " vn-dimmed" : "")}>
                            {rightImage
                                ? <img src={rightImage} alt={rightName} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                                : null}
                            <span className="vn-character-initials">{rightInitials}</span>
                        </div>
                    )}
                    <div className="vn-scene-card">{page.scene || event.vnScene || "An event interrupts your path."}</div>
                    </div>{/* end vn-picture */}
                    <div className="vn-dialogue">
                        <div className="vn-speaker">{speaker}</div>
                        <p>{applyVnTextVars(spoken, textVars)}</p>
                        {pendingChoice ? (
                            <div className="vn-conclusion">
                                <p className="vn-conclusion-text">{applyVnTextVars(pendingChoice.conclusion, textVars)}</p>
                                <div className="vn-controls">
                                    <button onClick={confirmPendingChoice}>Continue</button>
                                </div>
                            </div>
                        ) : isAtChoicePoint ? (
                            <div className="vn-choices">
                                {pageChoices!.map((choice, i) => (
                                    <button
                                        key={i}
                                        className="vn-choice-btn"
                                        disabled={!choicesArmed}
                                        title={!choicesArmed ? "Choices unlock in a moment to prevent an accidental selection" : undefined}
                                        onClick={() => chooseOption(choice)}
                                    >
                                        {applyVnTextVars(choice.text, textVars)}
                                    </button>
                                ))}
                                {!choicesArmed && <span className="hint">Choices unlock in a moment&hellip;</span>}
                            </div>
                        ) : (
                            <div className="vn-controls">
                                <button disabled={!canBack} onClick={previousLine}>Back</button>
                                <button onClick={nextLine}>{isLastLine ? (isSageEvent || isStoryInterlude || isStoryEpilogue ? "Continue" : "Begin Battle") : "Next"}</button>
                            </div>
                        )}
                    </div>
                </div>
                <div className="vn-choice-row">
                    <button onClick={replayScene}>Replay Scene</button>
                    {/* Story chapters must fight through a lane CHOICE (which seals the
                        real reward + the reckoning) — the free battle would pay the
                        zeroed event reward and skip both. */}
                    {!isSageEvent && !isStoryInterlude && !isStoryChapterEvent && <button onClick={() => startBattle()}>Battle in {biomeLabel(event.biome)}</button>}
                    {!isStoryChapterEvent && (
                        <button onClick={completeScene}>{isSageEvent ? "Skip to the Offer" : isStoryInterlude ? "Continue" : "Claim Reward + Continue"}</button>
                    )}
                </div>
                {!isSageEvent && !isStoryInterlude && !isStoryEpilogue && (
                    <div className="vn-reward-strip">
                        {isStoryChapterEvent
                            ? <span>Chapter reward: paid when the boss falls — choose your answer above.</span>
                            : <>
                                <span>Trigger: {event.trigger === "firstBattleArena" ? "First Battle Arena click" : "First Village exit"}</span>
                                <span>Reward: {rewardSummary(event.ryoReward, event.staminaReward, event.currencyRewards)}</span>
                            </>}
                    </div>
                )}
            </div>
        </div>
    );
}
