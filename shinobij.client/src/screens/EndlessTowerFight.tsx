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

    async function finishLoss() {
        if (transitioning) return;
        setTransitioning(true);
        try {
            const result = await settle(fight.runId, character.name);
            onClose();
            if (result.character?.hospitalized) onHospital();
        } finally {
            setTransitioning(false);
        }
    }

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
            outcomeFn={settle}
            onExit={onClose}
            renderResult={({ won, settleState, settleResult, retry }) => {
                const result = settleResult as EndlessMutationResult | null;
                if (!won) {
                    return (
                        <div className="story-fight-complete" role="dialog" aria-label="Endless Tower run ended">
                            <div className="story-fight-complete-card">
                                <p className="story-fight-complete-kicker">Tower Collapsed</p>
                                <h2>Wave {fight.wave}</h2>
                                <p className="story-fight-complete-boss">Your unbanked haul is lost. Recover before beginning another run.</p>
                                <button disabled={transitioning} onClick={() => { void finishLoss(); }}>
                                    {transitioning ? "Settling…" : "Leave Tower"}
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
                                ? <button onClick={retry}>Retry settlement</button>
                                : settleState !== "settled" || !result
                                    ? <p>Verifying the wave…</p>
                                    : (
                                        <>
                                            <p className="story-fight-complete-rewards">+{result.reward?.ryo ?? 0} banked ryo</p>
                                            <div className="menu">
                                                <button disabled={transitioning} onClick={() => { setTransitioning(true); void onNext().finally(() => setTransitioning(false)); }}>
                                                    {transitioning ? "Opening…" : "Next Wave"}
                                                </button>
                                                <button disabled={transitioning} onClick={() => { setTransitioning(true); void onBank().finally(() => setTransitioning(false)); }}>
                                                    Bank & Leave
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
