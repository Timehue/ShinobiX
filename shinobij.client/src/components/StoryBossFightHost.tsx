import { Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Character } from "../types/character";
import type { TowerSession } from "../lib/towers-api";
import { lazyWithRetry } from "../lib/lazyWithRetry";
import { startStoryBossCombat, settleStoryBossCombat, type StoryBossSettleResult } from "../lib/story-combat-api";
import { onStoryBossFightRequest, type StoryFightTheme } from "../lib/story-fight-theme";

// BattleTowerFight is the full sealed-combat screen (~76 KB minified). Every other
// importer of it is a lazy screen; this host is the one exception — App mounts it
// eagerly so its request-bus listener is always live — so a static import here
// dragged the whole combat screen onto the boot-critical entry chunk. Code-split
// it: the host stays eager and light (just the bus listener), and the heavy screen
// loads only when a story boss fight actually starts. The chunk is warmed on the
// fight request (below), in parallel with the start-combat network call, so it is
// resident by the time the session opens — no visible load gap.
const BattleTowerFight = lazyWithRetry(() => import("../screens/BattleTowerFight").then((m) => ({ default: m.BattleTowerFight })));

/*
 * The single host for sealed story-boss fights (api/story/boss-start), mounted
 * once in App. Both story lanes — the Story Hall chapter screen and the
 * auto-trigger VN chapter battles — launch through the story-fight-theme bus,
 * so there is exactly one client path onto the server session and one settle
 * path off it. Renders in a body portal (full-screen overlay pattern: nav and
 * side rails must never paint over a fight — see the overlay portal notes).
 */
export function StoryBossFightHost({
    character,
    sharedImages,
    onSettled,
}: {
    character: Character | null;
    sharedImages: Record<string, string>;
    onSettled: (result: StoryBossSettleResult) => void;
}) {
    const [fight, setFight] = useState<{ theme: StoryFightTheme; runId: string; session: TowerSession } | null>(null);
    const [result, setResult] = useState<StoryBossSettleResult | null>(null);
    const startingRef = useRef(false);
    const playerName = character?.name ?? "";

    useEffect(() => {
        if (!playerName) return;
        return onStoryBossFightRequest((theme) => {
            if (startingRef.current) return;
            startingRef.current = true;
            // Warm the code-split combat chunk alongside the start-combat network
            // round-trip so BattleTowerFight is ready the moment the session opens.
            void import("../screens/BattleTowerFight");
            startStoryBossCombat({ playerName, bossName: theme.bossName })
                .then((started) => setFight({ theme, runId: started.runId, session: started.session }))
                .catch((error) => alert(error instanceof Error ? error.message : "The story battle could not start."))
                .finally(() => { startingRef.current = false; });
        });
    }, [playerName]);

    if (!fight || !character) return null;

    async function settle(runId: string, settlingPlayer: string): Promise<unknown> {
        const settled = await settleStoryBossCombat({ playerName: settlingPlayer, runId });
        onSettled(settled);
        setResult(settled);
        return settled;
    }

    function closeFight() {
        setFight(null);
        setResult(null);
    }

    return createPortal(
        <div className="story-fight-portal">
            <Suspense fallback={null}>
                <BattleTowerFight
                    character={character}
                    runId={fight.runId}
                    initialSession={fight.session}
                    sharedImages={sharedImages}
                    settleFn={settle}
                    storyTheme={fight.theme}
                    onExit={closeFight}
                />
            </Suspense>
            {result && (
                <div className="story-fight-complete" role="dialog" aria-label="Chapter complete">
                    <div className="story-fight-complete-card">
                        <p className="story-fight-complete-kicker">{result.finale ? "Village Story Complete" : "Chapter Complete"}</p>
                        <h2>{fight.theme.chapterLabel ?? fight.theme.bossName}</h2>
                        <p className="story-fight-complete-boss">{fight.theme.bossName} has fallen.</p>
                        {result.replayed
                            ? <p className="story-fight-complete-rewards">This story reward was already collected.</p>
                            : (
                                <p className="story-fight-complete-rewards">
                                    +{result.xp} XP · +{result.ryo} ryo · +{result.auraDust} Aura Dust
                                    {result.title ? <span className="story-fight-complete-title">Title earned: {result.title}</span> : null}
                                    {result.finale && !result.replayed ? <span className="story-fight-complete-title">The Hollow Gate Key is yours.</span> : null}
                                </p>
                            )}
                        <button onClick={closeFight}>Continue</button>
                    </div>
                </div>
            )}
        </div>,
        document.body,
    );
}
