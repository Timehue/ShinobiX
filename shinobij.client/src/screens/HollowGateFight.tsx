import { useCallback, useRef } from "react";
import type { Character, BattleHistoryEntry } from "../types/character";
import type { GameItem, Jutsu, SavedBloodline } from "../types/combat";
import type { HollowGateCombatSettleResult, HollowGateServerFight } from "../lib/hollow-gate-combat-api";
import { formatHollowGateCombatReward } from "../lib/hollow-gate-pve";
import { soloPveArenaTransport, soloPveSessionForArena } from "../lib/solo-pve-arena-adapter";
import { MissionArenaFight } from "./MissionArenaFight";

export function HollowGateFight({
    character,
    fight,
    sharedImages,
    savedBloodlines,
    creatorJutsus,
    creatorItems,
    settle,
    onResolved,
    onRecordBattle,
}: {
    character: Character;
    fight: HollowGateServerFight;
    sharedImages?: Record<string, string>;
    savedBloodlines?: SavedBloodline[];
    creatorJutsus?: Jutsu[];
    creatorItems?: GameItem[];
    settle: (runId: string, playerName: string) => Promise<HollowGateCombatSettleResult>;
    onResolved: (result: HollowGateCombatSettleResult) => void;
    onRecordBattle?: (entry: BattleHistoryEntry) => void;
}) {
    const resultRef = useRef<HollowGateCombatSettleResult | null>(null);
    const pendingRef = useRef<Promise<HollowGateCombatSettleResult> | null>(null);
    const settleFight = useCallback((runId: string, playerName: string) => {
        if (pendingRef.current) return pendingRef.current;
        pendingRef.current = settle(runId, playerName).then((result) => {
            resultRef.current = result;
            return result;
        }).catch((error) => {
            pendingRef.current = null;
            throw error;
        });
        return pendingRef.current;
    }, [settle]);
    const finish = useCallback(() => {
        if (resultRef.current) onResolved(resultRef.current);
    }, [onResolved]);

    return (
        <MissionArenaFight
            key={fight.runId}
            character={character}
            runId={fight.runId}
            initialSession={soloPveSessionForArena(fight.session)}
            transport={soloPveArenaTransport}
            missionName={`Hollow Gate · Floor ${fight.floor}`}
            sharedImages={sharedImages}
            savedBloodlines={savedBloodlines}
            creatorJutsus={creatorJutsus}
            creatorItems={creatorItems}
            settleFn={settleFight}
            outcomeFn={settleFight}
            settleOnAnyDone
            onExit={finish}
            onRecordBattle={onRecordBattle}
            recordMode="Hollow Gate"
            hollowGate={{ floor: fight.floor, kind: fight.kind }}
            retreatSealed={fight.session.encounter.metadata?.noRetreat === true}
            enemyAvatarOverride={sharedImages?.["hollow-gate:hound:combat"] || "/hollow-gate/hollow-hound-idle.webp"}
            renderResult={({ settleState, settleResult, retry }) => {
                const result = settleResult as HollowGateCombatSettleResult | null;
                const title = result?.won ? "Seal Broken" : result?.escaped ? "Withdrawn" : result?.revived ? "Second Wind" : "Run Ended";
                const detail = result?.won
                    ? formatHollowGateCombatReward(result) || "The Gate verified the victory."
                    : result?.escaped
                        ? "The escape was verified. Threat returns to zero."
                        : result?.revived
                            ? "Second Wind restored you at half health."
                            : "The Hollow Hound ended this dive.";
                return (
                    <div className="story-fight-complete" role="dialog" aria-label="Hollow Gate combat result">
                        <div className="story-fight-complete-card">
                            <p className="story-fight-complete-kicker">Hollow Gate</p>
                            <h2>{title}</h2>
                            {settleState === "failed"
                                ? <button onClick={retry}>Retry settlement</button>
                                : settleState !== "settled" || !result
                                    ? <p>Verifying the sealed encounter…</p>
                                    : <><p className="story-fight-complete-rewards">{detail}</p><button onClick={finish}>Continue</button></>}
                        </div>
                    </div>
                );
            }}
        />
    );
}
