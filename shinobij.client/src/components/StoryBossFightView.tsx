import { Suspense, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import type { Character } from "../types/character";
import { companionCoachName, firstFightLessonForStory } from "../lib/first-fight-coach";
import { aiFightLeftLabel } from "../lib/ai-fight-result";
import type { SoloPveSession } from "../lib/solo-pve-api";
import type { SavedBloodline, Jutsu, GameItem } from "../types/combat";
import type { StoryBossSettleResult } from "../lib/story-combat-api";
import type { StoryFightTheme } from "../lib/story-fight-theme";
import type { StoryFightParts } from "./StoryBossFightHost";
import { reportPveFightOutcome } from "../lib/pve-outcome-api";
import { soloPveArenaTransport, soloPveSessionForArena } from "../lib/solo-pve-arena-adapter";

/*
 * What a sealed story fight draws once it is open: the arena, the settle and
 * outcome calls, and the required result dialog. StoryBossFightHost holds the
 * request-bus listener and the fight's state, and must be live from the first
 * render, so it loads with the game. This part is needed only once a fight has
 * started, so it loads with the fight (the host warms it on the request,
 * alongside MissionArenaFight), and is not part of what every player downloads
 * before the first screen. The code-split screens it draws are declared once, in
 * the host, and handed over as `parts`: declaring them here as well would repeat
 * their preload lists in this chunk.
 */

export type ActiveStoryFight = {
    theme: StoryFightTheme;
    runId: string;
    session: SoloPveSession;
    originatingPlayerName: string;
    requestId: number;
};

const storyFightPlayerKey =(name: string): string => name.trim().toLowerCase();

const STORY_RESULT_FOCUSABLE = [
    "button:not([disabled])",
    "[href]",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Required-choice result dialog for a sealed story run.
 *
 * The canonical Modal cannot wrap this presentation without bypassing the
 * authored 2.2s final-bark beat owned by the cinematic result modifier. This local
 * boundary therefore supplies the same essentials after that animation lands:
 * background inerting, focus containment, and focus placement. Escape is
 * deliberately consumed because closing an unsettled win would discard the
 * only in-memory run id that can retry its authoritative reward.
 */
function RequiredStoryResultDialog({
    label,
    focusVersion,
    cinematic = false,
    children,
}: {
    label: string;
    focusVersion: string;
    /** Delay only a chapter victory whose authored final bark is still landing. */
    cinematic?: boolean;
    children: ReactNode;
}) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const revealedRef = useRef(false);
    const [revealed, setRevealed] = useState(false);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const parent = dialog.parentElement;
        const combatRoot = dialog.closest<HTMLElement>(".combat-instance");
        // The fight itself is portaled beside the application root. Isolating
        // only the dialog's siblings hides the combat HUD but still leaves the
        // entire app available to a screen reader's virtual cursor. Snapshot
        // both layers, de-duplicated, and inert them only after the authored
        // final-bark reveal finishes.
        const backgroundElements = new Set<HTMLElement>([
            ...Array.from(parent?.children ?? [])
                .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== dialog),
            ...Array.from(document.body.children)
                .filter((element): element is HTMLElement => element instanceof HTMLElement
                    && element !== combatRoot
                    && !element.contains(dialog)),
        ]);
        const background = [...backgroundElements]
            .map((element) => ({
                element,
                inert: element.inert,
                ariaHidden: element.getAttribute("aria-hidden"),
            }));
        let backgroundInerted = false;
        const inertBackground = () => {
            if (backgroundInerted) return;
            backgroundInerted = true;
            for (const snapshot of background) {
                snapshot.element.inert = true;
                snapshot.element.setAttribute("aria-hidden", "true");
            }
        };

        const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>(STORY_RESULT_FOCUSABLE));
        const focusDialog = () => (focusables()[0] ?? dialog).focus();
        const reveal = () => {
            if (revealedRef.current) return;
            revealedRef.current = true;
            inertBackground();
            setRevealed(true);
            window.requestAnimationFrame(focusDialog);
        };
        const onAnimationEnd = (event: AnimationEvent) => {
            if (event.target === dialog) reveal();
        };
        const revealFallback = window.setTimeout(reveal, 3_000);

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopImmediatePropagation();
                return;
            }
            if (event.key !== "Tab") return;
            const items = focusables();
            if (!revealedRef.current || items.length === 0) {
                event.preventDefault();
                if (revealedRef.current) dialog.focus();
                return;
            }
            const first = items[0];
            const last = items[items.length - 1];
            if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
                event.preventDefault();
                first.focus();
            }
        };
        const onFocusIn = (event: FocusEvent) => {
            if (revealedRef.current && !dialog.contains(event.target as Node)) focusDialog();
        };

        dialog.addEventListener("animationend", onAnimationEnd);
        window.addEventListener("keydown", onKeyDown, true);
        document.addEventListener("focusin", onFocusIn, true);
        return () => {
            window.clearTimeout(revealFallback);
            dialog.removeEventListener("animationend", onAnimationEnd);
            window.removeEventListener("keydown", onKeyDown, true);
            document.removeEventListener("focusin", onFocusIn, true);
            if (backgroundInerted) {
                for (const snapshot of background) {
                    snapshot.element.inert = snapshot.inert;
                    if (snapshot.ariaHidden === null) snapshot.element.removeAttribute("aria-hidden");
                    else snapshot.element.setAttribute("aria-hidden", snapshot.ariaHidden);
                }
            }
        };
    }, []);

    useEffect(() => {
        if (!revealed) return;
        const frame = window.requestAnimationFrame(() => {
            const dialog = dialogRef.current;
            const first = dialog?.querySelector<HTMLElement>(STORY_RESULT_FOCUSABLE);
            (first ?? dialog)?.focus();
        });
        return () => window.cancelAnimationFrame(frame);
    }, [focusVersion, revealed]);

    return (
        <div
            ref={dialogRef}
            className={`story-fight-complete${cinematic ? " story-fight-complete--cinematic" : ""}`}
            role={revealed ? "dialog" : undefined}
            aria-modal={revealed ? "true" : undefined}
            aria-label={revealed ? label : undefined}
            aria-hidden={revealed ? undefined : "true"}
            tabIndex={-1}
        >
            {children}
        </div>
    );
}

export type StoryBossFightViewProps = {
    fight: ActiveStoryFight;
    character: Character;
    sharedImages: Record<string, string>;
    savedBloodlines?: SavedBloodline[];
    creatorJutsus?: Jutsu[];
    creatorItems?: GameItem[];
    onSettled: (result: StoryBossSettleResult) => void;
    onOutcome?: (character: Character, saveVersion?: number) => void;
    committedReward: { requestId: number; result: StoryBossSettleResult } | null;
    setCommittedReward: (reward: { requestId: number; result: StoryBossSettleResult } | null) => void;
    /** The host's own refs: a reply is used only while the host is mounted, on the same account, for the same request. */
    mountedRef: MutableRefObject<boolean>;
    activePlayerKeyRef: MutableRefObject<string>;
    startRequestIdRef: MutableRefObject<number>;
    onExit: () => void;
    parts: StoryFightParts;
};

export default function StoryBossFightView({
    fight: currentFight, character, sharedImages, savedBloodlines, creatorJutsus, creatorItems,
    onSettled, onOutcome, committedReward, setCommittedReward, mountedRef, activePlayerKeyRef, startRequestIdRef, onExit: closeFight,
    parts: { SoloStoryFight, TwinStoryFight, StoryRewardSummary, loadStoryCombatApi },
}: StoryBossFightViewProps) {
    const MissionArenaFight = currentFight.session.huntCombat?.purpose ? TwinStoryFight : SoloStoryFight;
    const theme = currentFight.theme;
    const isSpar = theme.kind === "academySpar";
    const originatingPlayerName = currentFight.originatingPlayerName;
    const originatingPlayerKey = storyFightPlayerKey(originatingPlayerName);

    // Settle the sealed run server-side (pays the chapter reward from the completed,
    // winning session — the client never attests the outcome). The resolved reward
    // row is handed back to MissionArenaFight's renderResult for the reward card.
    async function settle(runId: string, _settlingPlayer: string): Promise<StoryBossSettleResult> {
        const { settleAcademySparCombat, settleStoryBossCombat, StorySettlementDeliveryError } = await loadStoryCombatApi();
        if (activePlayerKeyRef.current !== originatingPlayerKey) {
            throw new Error("This story battle belongs to a previous account.");
        }
        try {
            const settled = isSpar
                ? await settleAcademySparCombat({ playerName: originatingPlayerName, runId })
                : await settleStoryBossCombat({ playerName: originatingPlayerName, runId });
            if (mountedRef.current && activePlayerKeyRef.current === originatingPlayerKey
                && startRequestIdRef.current === currentFight.requestId) onSettled(settled);
            return settled;
        } catch (error) {
            if (error instanceof StorySettlementDeliveryError && mountedRef.current
                && activePlayerKeyRef.current === originatingPlayerKey
                && startRequestIdRef.current === currentFight.requestId) {
                setCommittedReward({ requestId: currentFight.requestId, result: error.settlement });
                onSettled(error.settlement);
            }
            throw error;
        }
    }

    // The fight's physical cost. Fires on any resolution and on a forfeit exit —
    // a chapter boss that beat you must not leave you at full HP.
    //
    // The spar reports too — the server, which owns the session, is what
    // declines to write a spar's physical outcome (settlementOwnsHpOnWin and
    // sessionIsSpar in api/missions/_ai-fight-outcome.ts). The client never
    // gates this call: doing so is how a lost chapter fight stops costing anything.
    async function reportOutcome(runId: string, _settlingPlayer: string) {
        if (activePlayerKeyRef.current !== originatingPlayerKey) {
            throw new Error("This story battle belongs to a previous account.");
        }
        const applied = await reportPveFightOutcome(runId, originatingPlayerName);
        if (applied?.character
            && mountedRef.current
            && activePlayerKeyRef.current === originatingPlayerKey) {
            onOutcome?.(applied.character, applied._saveVersion);
        }
        return applied;
    }

    return (
        <Suspense fallback={null}>
            <MissionArenaFight
                sealedSession={currentFight.session}
                character={character}
                runId={currentFight.runId}
                initialSession={soloPveSessionForArena(currentFight.session)}
                transport={soloPveArenaTransport}
                sharedImages={sharedImages}
                savedBloodlines={savedBloodlines}
                creatorJutsus={creatorJutsus}
                creatorItems={creatorItems}
                settleFn={settle}
                // A chapter boss that beat you has to cost something. `settle`
                // only runs on a win (the story settle refuses a losing run), so
                // without this a defeat left the player at full HP, free to walk
                // straight back in — and the defeat card already tells them to
                // "recover and try again".
                outcomeFn={reportOutcome}
                // The spar deliberately gets NO storyTheme. It is the chapter
                // presentation layer: passing it would fire the chapter-seal
                // sting when a training dummy walks on, the story victory sting
                // when it falls, and the chapter backdrop treatment — all for a
                // tutorial bout with no chapter, no barks and no boss. The
                // portrait and the result card are separate props, so the spar
                // keeps both.
                storyTheme={isSpar ? undefined : theme}
                coach={isSpar ? "academySpar" : firstFightLessonForStory(character)}
                coachSpeaker={companionCoachName(character)}
                enemyAvatarOverride={theme.bossPortrait}
                onExit={closeFight}
                renderResult={({ won, draw, terminalReason, settleState, settleResult, retry }) => {
                    const result = (settleResult as StoryBossSettleResult | null)
                        ?? (committedReward?.requestId === currentFight.requestId ? committedReward.result : null);
                    const left = aiFightLeftLabel(terminalReason, character.hospitalized);
                    // The tutorial spar gets its own plain-language card: a new
                    // player has no chapter context yet. A lost spar costs no HP
                    // and no hospital stay (spars never do — api/missions/
                    // _ai-fight-outcome.ts sessionIsSpar), so the loss path sends
                    // them straight back to the mat, not to a Story Hall they
                    // have not seen.
                    if (isSpar) {
                        return (
                            <RequiredStoryResultDialog
                                label={won ? "Sparring match won" : draw ? "Sparring match drawn" : "Sparring match lost"}
                                focusVersion={`${won ? "won" : "lost"}-${settleState}-${result ? "ready" : "waiting"}`}
                            >
                                <div className="story-fight-complete-card">
                                    <p className="story-fight-complete-kicker">{won ? "First Win" : draw ? "Draw" : left ?? "Spar lost"}</p>
                                    <h2>Academy Sparring Match</h2>
                                    {won
                                        ? (!result
                                            ? <p className="story-fight-complete-rewards">{settleState === "failed" ? "The sparring reward could not be verified. The fight ended in a win, but your Academy progress and reward are not confirmed yet. Press Retry reward." : "Saving your reward…"}</p>
                                            : <Suspense fallback={<p role="status">Reward received.</p>}><StoryRewardSummary result={result} /></Suspense>)
                                        : <p className="story-fight-complete-boss">{draw ? "The spar ended in a draw." : left ? "You stepped out of the spar." : "The dummy won this spar."} There is no hospital stay for this practice fight. Try again when you are ready.</p>}
                                    {/* escape-hatch-exempt — deliberate, unlike the PvP and AI-fight
                                        result screens. Those two keep a DURABLE handle on an unsettled
                                        reward (a 48h server receipt, or a retained token plus an active
                                        pointer), so leaving them is free. A story run's id lives only in
                                        memory, so an exit here silently destroys the reward it was
                                        offering to retry. ⚠ The trade-off is real but not free: a
                                        deterministic settle failure still leaves Retry as the only
                                        control. The fix is to persist the run id the way the PvP
                                        completion marker does, and THEN add the exit — not to add the
                                        exit on its own. */}
                                    {won && settleState === "failed"
                                        ? <button onClick={retry}>{result ? 'Retry saving progress' : 'Retry reward'}</button>
                                        : <button disabled={won && (settleState !== "settled" || !result)} onClick={closeFight}>Continue</button>}
                                </div>
                            </RequiredStoryResultDialog>
                        );
                    }
                    // WIN — the chapter-complete reward card. Its entrance is delayed a
                    // beat (see .story-fight-complete--cinematic) so the boss's final authored bark
                    // lands first. Reward numbers come from the server settle response.
                    if (won) {
                        return (
                            <RequiredStoryResultDialog
                                label={result ? "Chapter complete" : "Battle won"}
                                focusVersion={`${settleState}-${result ? "ready" : "waiting"}`}
                                cinematic
                            >
                                <div className="story-fight-complete-card">
                                    <p className="story-fight-complete-kicker">{result?.finale ? "Village Story Complete" : result ? "Chapter Complete" : "Battle Won"}</p>
                                    <h2>{theme.chapterLabel ?? theme.bossName}</h2>
                                    <p className="story-fight-complete-boss">You defeated {theme.bossName}.</p>
                                    {!result
                                        ? <p className="story-fight-complete-rewards">{settleState === "failed" ? "The reward could not be verified. The fight ended in a win, but chapter completion and rewards are not confirmed yet. Press Retry reward." : "Saving your reward…"}</p>
                                        : <Suspense fallback={<p role="status">Reward received.</p>}><StoryRewardSummary result={result} /></Suspense>}
                                    {/* escape-hatch-exempt — same in-memory run id as the branch above;
                                        see that comment for why leaving is destructive here and what
                                        the real fix is. */}
                                    {settleState === "failed"
                                        ? <button onClick={retry}>{result ? 'Retry saving progress' : 'Retry reward'}</button>
                                        : <button disabled={settleState !== "settled" || !result} onClick={closeFight}>Continue</button>}
                                </div>
                            </RequiredStoryResultDialog>
                        );
                    }
                    // LOSS / DRAW — themed defeat card (no reward; try again from the Story Hall).
                    const pending = !!currentFight.session.huntCombat?.purpose && settleState !== 'settled';
                    return (
                        <RequiredStoryResultDialog label={draw ? "Story battle drawn" : left ? "Story battle left" : "Story battle lost"} focusVersion={settleState}>
                            <div className="story-fight-complete-card">
                                <p className="story-fight-complete-kicker">{draw ? "Draw" : left ?? "Defeat"}</p>
                                <h2>{theme.chapterLabel ?? theme.bossName}</h2>
                                <p className="story-fight-complete-boss">You did not defeat {theme.bossName}. This chapter is still open. Recover if needed, then try again.</p>
                                {pending && settleState === 'failed' && <p role="alert">Battle result not saved. Retry to continue.</p>}
                                {pending && settleState !== 'failed' ? <p role="status">Saving battle result…</p>
                                    : <button onClick={pending ? retry : closeFight}>{pending ? 'Retry saving result' : 'Return to story'}</button>}
                            </div>
                        </RequiredStoryResultDialog>
                    );
                }}
            />
        </Suspense>
    );
}
