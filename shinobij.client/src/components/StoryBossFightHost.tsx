import { Suspense, useEffect, useRef, useState } from "react";
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
    const [fight, setFight] = useState<{ theme: StoryFightTheme; runId: string; session: SoloPveSession } | null>(null);
    const startingRef = useRef(false);
    const playerName = character?.name ?? "";

    useEffect(() => {
        if (!playerName) return;
        return onStoryBossFightRequest((theme) => {
            if (startingRef.current) return;
            startingRef.current = true;
            // Warm the code-split combat chunk alongside the start-combat network
            // round-trip so MissionArenaFight is ready the moment the session opens.
            void import("../screens/MissionArenaFight");
            const start = theme.kind === "academySpar"
                ? startAcademySparCombat({ playerName })
                : startStoryBossCombat({ playerName });
            start
                .then((started) => setFight({ theme, runId: started.runId, session: started.session }))
                .catch((error) => alert(error instanceof Error ? error.message : "The story battle could not start."))
                .finally(() => { startingRef.current = false; });
        });
    }, [playerName]);

    // Announced from an effect, not from render, and with a cleanup so an
    // unmount mid-fight still closes it out.
    const open = !!fight;
    useEffect(() => {
        onFightOpenChange?.(open);
        return () => { if (open) onFightOpenChange?.(false); };
    }, [open, onFightOpenChange]);

    if (!fight || !character) return null;
    const theme = fight.theme;
    const isSpar = theme.kind === "academySpar";

    // Settle the sealed run server-side (pays the chapter reward from the completed,
    // winning session — the client never attests the outcome). The resolved reward
    // row is handed back to MissionArenaFight's renderResult for the reward card.
    async function settle(runId: string, settlingPlayer: string): Promise<StoryBossSettleResult> {
        const settled = isSpar
            ? await settleAcademySparCombat({ playerName: settlingPlayer, runId })
            : await settleStoryBossCombat({ playerName: settlingPlayer, runId });
        onSettled(settled);
        return settled;
    }

    // The fight's physical cost. Fires on any resolution and on a forfeit exit —
    // a chapter boss that beat you must not leave you at full HP.
    //
    // A WON spar reports too — the server, which owns the session, is what
    // declines to overwrite the scripted post-spar HP (see
    // sparSettlementOwnsHp in api/missions/_ai-fight-outcome.ts). The client
    // never gates this call: doing so is how a lost fight stops costing anything.
    async function reportOutcome(runId: string, settlingPlayer: string) {
        const applied = await reportPveFightOutcome(runId, settlingPlayer);
        if (applied?.character) onOutcome?.(applied.character, applied._saveVersion);
        return applied;
    }

    function closeFight() {
        setFight(null);
    }

    return (
        <Suspense fallback={null}>
            <MissionArenaFight
                character={character}
                runId={fight.runId}
                initialSession={soloPveSessionForArena(fight.session)}
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
                renderResult={({ won, settleState, settleResult }) => {
                    // The tutorial spar gets its own plain-language card: a new
                    // player has no chapter context yet, and the loss path has to
                    // point at the Hospital (the OnboardingCoach's recovery step)
                    // rather than at a Story Hall they have not seen.
                    if (isSpar) {
                        const result = settleResult as StoryBossSettleResult | null;
                        return (
                            <div className="story-fight-complete" role="dialog" aria-label={won ? "Sparring match won" : "Sparring match lost"}>
                                <div className="story-fight-complete-card">
                                    <p className="story-fight-complete-kicker">{won ? "First Win" : "Knocked Down"}</p>
                                    <h2>Academy Sparring Match</h2>
                                    {won
                                        ? (settleState !== "settled" || !result
                                            ? <p className="story-fight-complete-rewards">{settleState === "failed" ? "The sparring reward could not be verified — reload and try the spar again." : "Sealing your reward…"}</p>
                                            : result.replayed
                                                ? <p className="story-fight-complete-rewards">This sparring reward was already collected.</p>
                                                : <p className="story-fight-complete-rewards">+{result.statPoints ?? 20} stat points · +{result.ryo} ryo</p>)
                                        : <p className="story-fight-complete-boss">The dummy got the better of you. Patch up at the Hospital and step back onto the mat.</p>}
                                    <button onClick={closeFight}>Continue</button>
                                </div>
                            </div>
                        );
                    }
                    // WIN — the chapter-complete reward card. Its entrance is delayed a
                    // beat (see .story-fight-complete) so the boss's final authored bark
                    // lands first. Reward numbers come from the server settle response.
                    if (won) {
                        const result = settleResult as StoryBossSettleResult | null;
                        return (
                            <div className="story-fight-complete" role="dialog" aria-label="Chapter complete">
                                <div className="story-fight-complete-card">
                                    <p className="story-fight-complete-kicker">{result?.finale ? "Village Story Complete" : "Chapter Complete"}</p>
                                    <h2>{theme.chapterLabel ?? theme.bossName}</h2>
                                    <p className="story-fight-complete-boss">{theme.bossName} has fallen.</p>
                                    {settleState !== "settled" || !result
                                        ? <p className="story-fight-complete-rewards">{settleState === "failed" ? "The reward could not be verified — reload and retry from the Story Hall." : "Sealing your reward…"}</p>
                                        : result.replayed
                                            ? <p className="story-fight-complete-rewards">This story reward was already collected.</p>
                                            : (
                                                <p className="story-fight-complete-rewards">
                                                    +{result.statPoints ?? 0} stat points · +{result.ryo} ryo · +{result.auraDust} Aura Dust
                                                    {result.title ? <span className="story-fight-complete-title">Title earned: {result.title}</span> : null}
                                                    {result.finale && !result.replayed ? <span className="story-fight-complete-title">The Hollow Gate Key is yours.</span> : null}
                                                </p>
                                            )}
                                    <button onClick={closeFight}>Continue</button>
                                </div>
                            </div>
                        );
                    }
                    // LOSS / DRAW — themed defeat card (no reward; try again from the Story Hall).
                    return (
                        <div className="story-fight-complete" role="dialog" aria-label="Chapter failed">
                            <div className="story-fight-complete-card">
                                <p className="story-fight-complete-kicker">Chapter Held</p>
                                <h2>{theme.chapterLabel ?? theme.bossName}</h2>
                                <p className="story-fight-complete-boss">{theme.bossName} stands firm. No progress was made — recover and try again.</p>
                                <button onClick={closeFight}>Return to Story</button>
                            </div>
                        </div>
                    );
                }}
            />
        </Suspense>
    );
}
