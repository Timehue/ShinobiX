import { useState } from "react";
import type { Character } from "../types/character";
import type { GameItem, Jutsu, SavedBloodline } from "../types/combat";
import type { EndlessMutationResult } from "../lib/endless-api";
import type { EndlessServerFight } from "../lib/use-endless-tower-actions";
import { soloPveArenaTransport, soloPveSessionForArena } from "../lib/solo-pve-arena-adapter";
import { MissionArenaFight } from "./MissionArenaFight";

export function EndlessTowerFight({
    character,
    fight,
    sharedImages,
    savedBloodlines,
    creatorJutsus,
    creatorItems,
    settle,
    onNext,
    onBank,
    onClose,
    onHospital,
}: {
    character: Character;
    fight: EndlessServerFight;
    sharedImages?: Record<string, string>;
    savedBloodlines?: SavedBloodline[];
    creatorJutsus?: Jutsu[];
    creatorItems?: GameItem[];
    settle: (runId: string, playerName: string) => Promise<EndlessMutationResult>;
    onNext: () => Promise<void>;
    onBank: () => Promise<void>;
    onClose: () => void;
    onHospital: () => void;
}) {
    const [transitioning, setTransitioning] = useState(false);

    return (
        <MissionArenaFight
            key={fight.runId}
            character={character}
            runId={fight.runId}
            initialSession={soloPveSessionForArena(fight.session)}
            transport={soloPveArenaTransport}
            missionName={`Endless Tower · Wave ${fight.wave}`}
            sharedImages={sharedImages}
            savedBloodlines={savedBloodlines}
            creatorJutsus={creatorJutsus}
            creatorItems={creatorItems}
            settleFn={settle}
            settleOnAnyDone
            onExit={onClose}
            renderResult={({ won, settleState, settleResult, retry }) => {
                const result = settleResult as EndlessMutationResult | null;
                if (!won) {
                    return (
                        <div className="story-fight-complete" role="dialog" aria-label="Endless Tower run ended">
                            <div className="story-fight-complete-card">
                                <p className="story-fight-complete-kicker">Run ended</p>
                                <h2>Wave {fight.wave}</h2>
                                <p className="story-fight-complete-boss">{settleState === "failed"
                                    ? "Your result could not be confirmed. Press Retry to check the run and your recovery status."
                                    : settleState !== "settled" || !result
                                        ? "Confirming your result and recovery status…"
                                        : "This run ended without cashing out. Its unclaimed ryo was lost. You keep milestone rewards already received."}</p>
                                {settleState === "failed" && <button onClick={retry}>Retry</button>}
                                {/* A failed settle keeps an exit: the lobby's Resume reopens this
                                    sealed wave to settle it, and once the wave expires Retreat ends
                                    the run (api/endless/run.ts cashout). */}
                                <button disabled={settleState !== "failed" && (settleState !== "settled" || !result)} onClick={() => {
                                    onClose();
                                    if (result?.character?.hospitalized) onHospital();
                                }}>
                                    {result?.character?.hospitalized ? "Go to Hospital" : "Leave Tower"}
                                </button>
                            </div>
                        </div>
                    );
                }
                return (
                    <div className="story-fight-complete" role="dialog" aria-label={`Endless Tower wave ${fight.wave} cleared`}>
                        <div className="story-fight-complete-card">
                            <p className="story-fight-complete-kicker">Wave Clear</p>
                            <h2>Wave {fight.wave}</h2>
                            {settleState === "failed"
                                ? <><p>Your wave reward could not be confirmed. Press Retry to check it, or leave and resume the run from the lobby.</p><div className="menu"><button onClick={retry}>Retry</button><button onClick={onClose}>Leave for now</button></div></>
                                : settleState !== "settled" || !result
                                    ? <p>Verifying the wave…</p>
                                    : (
                                        <>
                                            <p className="story-fight-complete-rewards">+{result.reward?.ryo ?? 0} ryo added to this run&apos;s unclaimed total. Choose Bank &amp; leave to keep it; losing a later wave forfeits unclaimed ryo.</p>
                                            <div className="menu">
                                                <button disabled={transitioning} onClick={() => { setTransitioning(true); void onNext().finally(() => setTransitioning(false)); }}>
                                                    {transitioning ? "Opening…" : "Next wave"}
                                                </button>
                                                <button disabled={transitioning} onClick={() => { setTransitioning(true); void onBank().finally(() => setTransitioning(false)); }}>
                                                    Bank & leave
                                                </button>
                                            </div>
                                        </>
                                    )}
                        </div>
                    </div>
                );
            }}
        />
    );
}
