import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Character } from "../types/character";
import type { SavedBloodline, Jutsu, GameItem } from "../types/combat";
import { lazyWithRetry, retryDynamicImport } from "../lib/lazyWithRetry";
import type { StoryBossSettleResult } from "../lib/story-combat-api";
import { onStoryBossFightRequest } from "../lib/story-fight-theme";
import type { ActiveStoryFight } from "./StoryBossFightView";

// Ordinary story-boss fights render through MissionArenaFight — the SAME server-authoritative
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
// time the session opens, so there is no visible load gap. What the open fight draws (the
// settle and outcome calls, the result dialog and the first-fight coach) lives in
// StoryBossFightView, split and warmed the same way, so none of it is in the startup
// download every player waits for. The screens below are declared here, once, and handed
// to the view as `parts`.
const SoloStoryFight = lazyWithRetry(() => import("../screens/MissionArenaFight").then(m => ({ default: m.MissionArenaFight })));
const TwinStoryFight = lazyWithRetry(() => import("../screens/StoryTwinFight"));
// Select the multi-actor grid for paired trials and authored groups;
// their commands and chapter rewards still use the same Solo-PvE lifecycle.
// Result details are needed only after a story battle, not during initial boot.
const StoryRewardSummary = lazyWithRetry(() => import("./StoryRewardSummary").then((m) => ({ default: m.StoryRewardSummary })));
const loadStoryCombatApi = () => retryDynamicImport(() => import("../lib/story-combat-api"));
const STORY_FIGHT_PARTS = { SoloStoryFight, TwinStoryFight, StoryRewardSummary, loadStoryCombatApi };
export type StoryFightParts = typeof STORY_FIGHT_PARTS;
const StoryBossFightView = lazyWithRetry(() => import("./StoryBossFightView"));

const storyFightPlayerKey = (name: string): string => name.trim().toLowerCase();

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
    const [committedReward, setCommittedReward] = useState<{ requestId: number; result: StoryBossSettleResult } | null>(null);
    // Mirrors startingRef into render so the host can announce itself engaged from
    // the moment it ACCEPTS a request. The sealed start is a network round-trip, and
    // the caller closes its launch UI immediately — announcing only once `fight`
    // lands leaves that whole window looking like "no fight in progress".
    const [starting, setStarting] = useState(false);
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
            onFightOpenChange?.(false);
        };
    }, [onFightOpenChange]);

    useLayoutEffect(() => {
        const nextPlayerKey = storyFightPlayerKey(playerName);
        if (activePlayerKeyRef.current === nextPlayerKey) return;
        activePlayerKeyRef.current = nextPlayerKey;
        startRequestIdRef.current += 1;
        startingRef.current = false;
        setStarting(false);
        activeFightRef.current = false;
        onFightOpenChange?.(false);
        returnFocusRef.current = null;
        setCommittedReward(null);
        setFight((current) => current
            && storyFightPlayerKey(current.originatingPlayerName) !== nextPlayerKey
            ? null
            : current);
    }, [onFightOpenChange, playerName]);

    useEffect(() => {
        const originatingPlayerName = playerName;
        const originatingPlayerKey = storyFightPlayerKey(originatingPlayerName);
        if (!originatingPlayerKey) return;
        return onStoryBossFightRequest((theme) => {
            if (activePlayerKeyRef.current !== originatingPlayerKey
                || startingRef.current
                || activeFightRef.current) return false;
            startingRef.current = true;
            setStarting(true);
            // Claim the whole lifecycle synchronously. Waiting for the portal
            // fight state left one render where App could reopen the same VN
            // beneath a slow /boss-start request.
            onFightOpenChange?.(true);
            const requestId = ++startRequestIdRef.current;
            returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            // Warm the code-split combat chunk alongside the start-combat network
            // round-trip so MissionArenaFight is ready the moment the session opens.
            // A failed load resurfaces through the lazy MissionArenaFight above
            // (retries, then ErrorBoundary); the warm-up must not also escape unhandled.
            void import("../screens/MissionArenaFight").catch(() => {});
            void import("./StoryRewardSummary").catch(() => {});
            void import("./StoryBossFightView").catch(() => {});
            const start = loadStoryCombatApi().then(({ startAcademySparCombat, startStoryBossCombat }) => {
                if (!mountedRef.current || startRequestIdRef.current !== requestId
                    || activePlayerKeyRef.current !== originatingPlayerKey) {
                    throw new Error("This story battle belongs to a previous account.");
                }
                return theme.kind === "academySpar"
                    ? startAcademySparCombat({ playerName: originatingPlayerName })
                    : startStoryBossCombat({ playerName: originatingPlayerName });
            });
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
                        onFightOpenChange?.(false);
                    }
                })
                .finally(() => {
                    if (startRequestIdRef.current !== requestId) return;
                    startingRef.current = false;
                    setStarting(false);
                });
            return true;
        });
    }, [onFightOpenChange, playerName]);

    const activeFight = fight
        && storyFightPlayerKey(fight.originatingPlayerName) === storyFightPlayerKey(playerName)
        ? fight
        : null;

    // Announced from an effect, not from render, and with a cleanup so an
    // unmount mid-fight still closes it out. `starting` is part of it: a request
    // this host has accepted is already committed combat, and the caller has
    // already dismissed the UI it was launched from.
    const open = starting || !!activeFight;
    useEffect(() => {
        onFightOpenChange?.(open);
        return () => { if (open) onFightOpenChange?.(false); };
    }, [open, onFightOpenChange]);

    if (!activeFight || !character) return null;
    const currentFight: ActiveStoryFight = activeFight;
    const originatingPlayerKey = storyFightPlayerKey(currentFight.originatingPlayerName);

    function closeFight() {
        const returnFocus = returnFocusRef.current;
        returnFocusRef.current = null;
        setCommittedReward(null);
        activeFightRef.current = false;
        onFightOpenChange?.(false);
        setFight((current) => current?.requestId === currentFight.requestId ? null : current);
        window.requestAnimationFrame(() => {
            if (activePlayerKeyRef.current === originatingPlayerKey && returnFocus?.isConnected) returnFocus.focus();
        });
    }

    return (
        <Suspense fallback={null}>
            <StoryBossFightView
                fight={currentFight}
                character={character}
                sharedImages={sharedImages}
                savedBloodlines={savedBloodlines}
                creatorJutsus={creatorJutsus}
                creatorItems={creatorItems}
                onSettled={onSettled}
                onOutcome={onOutcome}
                committedReward={committedReward}
                setCommittedReward={setCommittedReward}
                mountedRef={mountedRef}
                activePlayerKeyRef={activePlayerKeyRef}
                startRequestIdRef={startRequestIdRef}
                onExit={closeFight}
                parts={STORY_FIGHT_PARTS}
            />
        </Suspense>
    );
}
