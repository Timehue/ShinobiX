import { Suspense, useEffect, useRef, useState } from "react";
import type { Character } from "../types/character";
import type { TowerSession } from "../lib/towers-api";
import type { SavedBloodline, Jutsu, GameItem } from "../types/combat";
import { lazyWithRetry } from "../lib/lazyWithRetry";
import { startStoryBossCombat, settleStoryBossCombat, type StoryBossSettleResult } from "../lib/story-combat-api";
import { onStoryBossFightRequest, type StoryFightTheme } from "../lib/story-fight-theme";

// Story-boss fights render through MissionArenaFight — the SAME server-authoritative
// arena shell combat missions use (a sealed tower:<runId> session, /api/towers/action
// moves, CombatSideHud dossiers + the 12×10 hex board). A story fight is a plain solo
// defeat-boss TowerSession, structurally identical to a combat mission, so they share
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
}: {
    character: Character | null;
    sharedImages: Record<string, string>;
    /** The player's own jutsu/item/bloodline catalogs — the SEALED session carries
     *  combat fields but NO art, so card thumbnails resolve from these by id. */
    savedBloodlines?: SavedBloodline[];
    creatorJutsus?: Jutsu[];
    creatorItems?: GameItem[];
    onSettled: (result: StoryBossSettleResult) => void;
}) {
    const [fight, setFight] = useState<{ theme: StoryFightTheme; runId: string; session: TowerSession } | null>(null);
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
            startStoryBossCombat({ playerName, bossName: theme.bossName })
                .then((started) => setFight({ theme, runId: started.runId, session: started.session }))
                .catch((error) => alert(error instanceof Error ? error.message : "The story battle could not start."))
                .finally(() => { startingRef.current = false; });
        });
    }, [playerName]);

    if (!fight || !character) return null;
    const theme = fight.theme;

    // Settle the sealed run server-side (pays the chapter reward from the completed,
    // winning session — the client never attests the outcome). The resolved reward
    // row is handed back to MissionArenaFight's renderResult for the reward card.
    async function settle(runId: string, settlingPlayer: string): Promise<StoryBossSettleResult> {
        const settled = await settleStoryBossCombat({ playerName: settlingPlayer, runId });
        onSettled(settled);
        return settled;
    }

    function closeFight() {
        setFight(null);
    }

    return (
        <Suspense fallback={null}>
            <MissionArenaFight
                character={character}
                runId={fight.runId}
                initialSession={fight.session}
                sharedImages={sharedImages}
                savedBloodlines={savedBloodlines}
                creatorJutsus={creatorJutsus}
                creatorItems={creatorItems}
                settleFn={settle}
                storyTheme={theme}
                enemyAvatarOverride={theme.bossPortrait}
                onExit={closeFight}
                renderResult={({ won, settleState, settleResult }) => {
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
