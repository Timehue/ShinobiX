import { Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Character } from "../types/character";
import type { SoloPveSession } from "../lib/solo-pve-api";
import type { SavedBloodline, Jutsu, GameItem } from "../types/combat";
import { lazyWithRetry } from "../lib/lazyWithRetry";
import {
    startStoryBossCombat,
    settleStoryBossCombat,
    startAcademySparCombat,
    settleAcademySparCombat,
    type StoryBossSettleResult,
} from "../lib/story-combat-api";
import { onStoryBossFightRequest, type StoryFightTheme } from "../lib/story-fight-theme";
import { reportPveFightOutcome } from "../lib/pve-outcome-api";
import { soloPveArenaTransport, soloPveSessionForArena } from "../lib/solo-pve-arena-adapter";

// Story-boss fights render through MissionArenaFight — the SAME server-authoritative
// arena shell combat missions use (a sealed solo-PvE session and intent-only actions,
// CombatSideHud dossiers + the 12×10 hex board). A story fight is a plain solo
// encounter, structurally identical to a combat mission, so they share
// the screen; the only story-specific bits are the display-only `storyTheme`
// (backdrop / chapter label / boss barks) and the settle endpoint (/api/story/settle),
// both passed in below. This screen used to be BattleTowerFight (the tower/spire tactical
// rail), which is why story fights looked like tower floors ("Floor 9200 · defeat boss").
//
// MissionArenaFight is the full sealed-combat screen. App mounts THIS host eagerly so its
// request-bus listener is always live, so we code-split the screen and warm it on the
// fight request (in parallel with the start-combat network round-trip) — resident by the
// time the session opens, so there is no visible load gap.
const MissionArenaFight = lazyWithRetry(() => import("../screens/MissionArenaFight").then((m) => ({ default: m.MissionArenaFight })));

type ActiveStoryFight = {
    theme: StoryFightTheme;
    runId: string;
    session: SoloPveSession;
    originatingPlayerName: string;
    requestId: number;
};

const storyFightPlayerKey = (name: string): string => name.trim().toLowerCase();

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
 * authored 2.2s final-bark beat owned by `.story-fight-complete`. This local
 * boundary therefore supplies the same essentials after that animation lands:
 * background inerting, focus containment, and focus placement. Escape is
 * deliberately consumed because closing an unsettled win would discard the
 * only in-memory run id that can retry its authoritative reward.
 */
function RequiredStoryResultDialog({
    label,
    focusVersion,
    children,
}: {
    label: string;
    focusVersion: string;
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
            className="story-fight-complete"
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

/*
 * The single host for sealed story-boss fights (api/story/boss-start), mounted
 * once in App. Both story lanes — the Story Hall chapter screen and the
 * auto-trigger VN chapter battles — launch through the story-fight-theme bus,
 * so there is exactly one client path onto the server session and one settle
 * path off it. The fight itself renders in a body portal (MissionArenaFight's own
 * full-screen overlay), so nav and side rails never paint over it.
 */
export function StoryBossFightHost({
    character,
    sharedImages,
    savedBloodlines,
    creatorJutsus,
    creatorItems,
    onSettled,
    onOutcome,
    onFightOpenChange,
}: {
    character: Character | null;
    sharedImages: Record<string, string>;
    /** The player's own jutsu/item/bloodline catalogs — the SEALED session carries
     *  combat fields but NO art, so card thumbnails resolve from these by id. */
    savedBloodlines?: SavedBloodline[];
    creatorJutsus?: Jutsu[];
    creatorItems?: GameItem[];
    onSettled: (result: StoryBossSettleResult) => void;
    /**
     * Fires when a sealed fight opens and again when it closes.
     *
     * The fight is a body portal, so App's `screen` never changes and anything
     * keyed off the screen stays mounted UNDER it. That is fine for nav chrome,
     * which the portal simply covers — but not for the OnboardingCoach's spar
     * modal, which carries a live r3f companion canvas with no demand frameloop.
     * Left mounted it renders a second WebGL context behind an opaque fullscreen
     * fight for the whole tutorial battle, on the phone of a brand-new player.
     */
    onFightOpenChange?: (open: boolean) => void;
    /** Adopt the character the fight's PHYSICAL cost was written onto (surviving
     *  HP, or the hospital stay on a defeat). Separate from onSettled, which
     *  carries the chapter REWARD and only fires on a win. */
    onOutcome?: (character: Character, saveVersion?: number) => void;
}) {
    const [fight, setFight] = useState<ActiveStoryFight | null>(null);
    const startingRef = useRef(false);
    const activeFightRef = useRef(false);
    const startRequestIdRef = useRef(0);
    const mountedRef = useRef(false);
    const returnFocusRef = useRef<HTMLElement | null>(null);
    const playerName = character?.name ?? "";
    const activePlayerKeyRef = useRef(storyFightPlayerKey(playerName));

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            startRequestIdRef.current += 1;
            startingRef.current = false;
            activeFightRef.current = false;
        };
    }, []);

    useLayoutEffect(() => {
        const nextPlayerKey = storyFightPlayerKey(playerName);
        if (activePlayerKeyRef.current === nextPlayerKey) return;
        activePlayerKeyRef.current = nextPlayerKey;
        startRequestIdRef.current += 1;
        startingRef.current = false;
        activeFightRef.current = false;
        returnFocusRef.current = null;
        setFight((current) => current
            && storyFightPlayerKey(current.originatingPlayerName) !== nextPlayerKey
            ? null
            : current);
    }, [playerName]);

    useEffect(() => {
        const originatingPlayerName = playerName;
        const originatingPlayerKey = storyFightPlayerKey(originatingPlayerName);
        if (!originatingPlayerKey) return;
        return onStoryBossFightRequest((theme) => {
            if (activePlayerKeyRef.current !== originatingPlayerKey
                || startingRef.current
                || activeFightRef.current) return;
            startingRef.current = true;
            const requestId = ++startRequestIdRef.current;
            returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            // Warm the code-split combat chunk alongside the start-combat network
            // round-trip so MissionArenaFight is ready the moment the session opens.
            void import("../screens/MissionArenaFight");
            const start = theme.kind === "academySpar"
                ? startAcademySparCombat({ playerName: originatingPlayerName })
                : startStoryBossCombat({ playerName: originatingPlayerName });
            start
                .then((started) => {
                    if (!mountedRef.current
                        || startRequestIdRef.current !== requestId
                        || activePlayerKeyRef.current !== originatingPlayerKey) return;
                    activeFightRef.current = true;
                    setFight({
                        theme,
                        runId: started.runId,
                        session: started.session,
                        originatingPlayerName,
                        requestId,
                    });
                })
                .catch((error) => {
                    if (mountedRef.current
                        && startRequestIdRef.current === requestId
                        && activePlayerKeyRef.current === originatingPlayerKey) {
                        alert(error instanceof Error ? error.message : "The story battle could not start.");
                    }
                })
                .finally(() => {
                    if (startRequestIdRef.current === requestId) startingRef.current = false;
                });
        });
    }, [playerName]);

    const activeFight = fight
        && storyFightPlayerKey(fight.originatingPlayerName) === storyFightPlayerKey(playerName)
        ? fight
        : null;

    // Announced from an effect, not from render, and with a cleanup so an
    // unmount mid-fight still closes it out.
    const open = !!activeFight;
    useEffect(() => {
        onFightOpenChange?.(open);
        return () => { if (open) onFightOpenChange?.(false); };
    }, [open, onFightOpenChange]);

    if (!activeFight || !character) return null;
    const currentFight: ActiveStoryFight = activeFight;
    const theme = currentFight.theme;
    const isSpar = theme.kind === "academySpar";
    const originatingPlayerName = currentFight.originatingPlayerName;
    const originatingPlayerKey = storyFightPlayerKey(originatingPlayerName);

    // Settle the sealed run server-side (pays the chapter reward from the completed,
    // winning session — the client never attests the outcome). The resolved reward
    // row is handed back to MissionArenaFight's renderResult for the reward card.
    async function settle(runId: string, _settlingPlayer: string): Promise<StoryBossSettleResult> {
        if (activePlayerKeyRef.current !== originatingPlayerKey) {
            throw new Error("This story battle belongs to a previous account.");
        }
        const settled = isSpar
            ? await settleAcademySparCombat({ playerName: originatingPlayerName, runId })
            : await settleStoryBossCombat({ playerName: originatingPlayerName, runId });
        if (mountedRef.current && activePlayerKeyRef.current === originatingPlayerKey) onSettled(settled);
        return settled;
    }

    // The fight's physical cost. Fires on any resolution and on a forfeit exit —
    // a chapter boss that beat you must not leave you at full HP.
    //
    // A WON spar reports too — the server, which owns the session, is what
    // declines to overwrite the scripted post-spar HP (see
    // sparSettlementOwnsHp in api/missions/_ai-fight-outcome.ts). The client
    // never gates this call: doing so is how a lost fight stops costing anything.
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

    function closeFight() {
        const returnFocus = returnFocusRef.current;
        returnFocusRef.current = null;
        activeFightRef.current = false;
        setFight((current) => current?.requestId === currentFight.requestId ? null : current);
        window.requestAnimationFrame(() => {
            if (activePlayerKeyRef.current === originatingPlayerKey && returnFocus?.isConnected) returnFocus.focus();
        });
    }

    return (
        <Suspense fallback={null}>
            <MissionArenaFight
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
                coach={isSpar ? "academySpar" : undefined}
                enemyAvatarOverride={theme.bossPortrait}
                onExit={closeFight}
                renderResult={({ won, settleState, settleResult, retry }) => {
                    // The tutorial spar gets its own plain-language card: a new
                    // player has no chapter context yet, and the loss path has to
                    // point at the Hospital (the OnboardingCoach's recovery step)
                    // rather than at a Story Hall they have not seen.
                    if (isSpar) {
                        const result = settleResult as StoryBossSettleResult | null;
                        return (
                            <RequiredStoryResultDialog
                                label={won ? "Sparring match won" : "Sparring match lost"}
                                focusVersion={`${won ? "won" : "lost"}-${settleState}-${result ? "ready" : "waiting"}`}
                            >
                                <div className="story-fight-complete-card">
                                    <p className="story-fight-complete-kicker">{won ? "First Win" : "Knocked Down"}</p>
                                    <h2>Academy Sparring Match</h2>
                                    {won
                                        ? (settleState !== "settled" || !result
                                            ? <p className="story-fight-complete-rewards">{settleState === "failed" ? "The sparring reward could not be verified. Your win is still open — retry the reward now." : "Sealing your reward…"}</p>
                                            : result.replayed
                                                ? <p className="story-fight-complete-rewards">This sparring reward was already collected.</p>
                                                : <p className="story-fight-complete-rewards">+{result.statPoints ?? 20} stat points · +{result.ryo} ryo</p>)
                                        : <p className="story-fight-complete-boss">The dummy got the better of you. Patch up at the Hospital and step back onto the mat.</p>}
                                    {won && settleState === "failed"
                                        ? <button onClick={retry}>Retry Reward</button>
                                        : <button disabled={won && (settleState !== "settled" || !result)} onClick={closeFight}>Continue</button>}
                                </div>
                            </RequiredStoryResultDialog>
                        );
                    }
                    // WIN — the chapter-complete reward card. Its entrance is delayed a
                    // beat (see .story-fight-complete) so the boss's final authored bark
                    // lands first. Reward numbers come from the server settle response.
                    if (won) {
                        const result = settleResult as StoryBossSettleResult | null;
                        return (
                            <RequiredStoryResultDialog
                                label="Chapter complete"
                                focusVersion={`${settleState}-${result ? "ready" : "waiting"}`}
                            >
                                <div className="story-fight-complete-card">
                                    <p className="story-fight-complete-kicker">{result?.finale ? "Village Story Complete" : "Chapter Complete"}</p>
                                    <h2>{theme.chapterLabel ?? theme.bossName}</h2>
                                    <p className="story-fight-complete-boss">{theme.bossName} has fallen.</p>
                                    {settleState !== "settled" || !result
                                        ? <p className="story-fight-complete-rewards">{settleState === "failed" ? "The reward could not be verified. Your victory is still open — retry the reward now." : "Sealing your reward…"}</p>
                                        : result.replayed
                                            ? <p className="story-fight-complete-rewards">This story reward was already collected.</p>
                                            : (
                                                <p className="story-fight-complete-rewards">
                                                    +{result.statPoints ?? 0} stat points · +{result.ryo} ryo · +{result.auraDust} Aura Dust
                                                    {result.title ? <span className="story-fight-complete-title">Title earned: {result.title}</span> : null}
                                                    {result.finale && !result.replayed ? <span className="story-fight-complete-title">The Hollow Gate Key is yours.</span> : null}
                                                    {result.chronicleCards?.length ? (
                                                        <span className="story-fight-complete-title">
                                                            Living Chronicle · Ihara records the witnessed fall of {theme.bossName} as {result.chronicleCards.length === 1 ? "a new card" : `${result.chronicleCards.length} new cards`}.
                                                        </span>
                                                    ) : null}
                                                </p>
                                            )}
                                    {settleState === "failed"
                                        ? <button onClick={retry}>Retry Reward</button>
                                        : <button disabled={settleState !== "settled" || !result} onClick={closeFight}>Continue</button>}
                                </div>
                            </RequiredStoryResultDialog>
                        );
                    }
                    // LOSS / DRAW — themed defeat card (no reward; try again from the Story Hall).
                    return (
                        <RequiredStoryResultDialog label="Chapter failed" focusVersion="failed">
                            <div className="story-fight-complete-card">
                                <p className="story-fight-complete-kicker">Chapter Held</p>
                                <h2>{theme.chapterLabel ?? theme.bossName}</h2>
                                <p className="story-fight-complete-boss">{theme.bossName} stands firm. No progress was made — recover and try again.</p>
                                <button onClick={closeFight}>Return to Story</button>
                            </div>
                        </RequiredStoryResultDialog>
                    );
                }}
            />
        </Suspense>
    );
}
