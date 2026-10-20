import { HOLLOW_GATE_LEGACY_SHINOBI_ROUND_LIMIT } from '../../../shared/hollow-gate-round-limit';
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
            enemyAvatarOverride={typeof fight.session.enemy.character.avatarImage === "string" ? fight.session.enemy.character.avatarImage : fight.session.enemy.character.visual === "hollow-hound" ? sharedImages?.["hollow-gate:hound:combat"] || "/hollow-gate/hollow-hound-idle.webp" : undefined}
            renderResult={({ settleState, settleResult, retry }) => {
                const result = settleResult as HollowGateCombatSettleResult | null;
                const title = !result ? "Battle ended" : result.won ? "Victory" : result.escaped ? "Escaped" : result.revived ? "Second Wind" : "Run ended";
                const detail = result?.won
                    ? formatHollowGateCombatReward(result) || "Victory confirmed. No direct reward from this encounter."
                    : result?.escaped
                        ? "The escape was verified. Threat returns to zero."
                        : result?.revived
                            ? "Second Wind restored you at half health."
                            : result?.terminalReason === 'round-limit'
                                ? `The ${result.roundLimit ?? HOLLOW_GATE_LEGACY_SHINOBI_ROUND_LIMIT}-round limit expired before ${result.opponentName || fight.session.enemy.name} was defeated. This dive has ended.`
                                : `You were defeated by ${result?.opponentName || fight.session.enemy.name}. Your Hollow Gate run has ended.`;
                return (
                    <div className="story-fight-complete" role="dialog" aria-label="Hollow Gate combat result">
                        <div className="story-fight-complete-card">
                            <p className="story-fight-complete-kicker">Hollow Gate</p>
                            <h2>{title}</h2>
                            {settleState === "failed"
                                ? <><p>Your battle result could not be confirmed. Press Retry to check it.</p><button onClick={retry}>Retry</button></>
                                : settleState !== "settled" || !result
                                    ? <p>Confirming your battle result…</p>
                                    : <><p className="story-fight-complete-rewards">{detail}</p><button onClick={finish}>Continue</button></>}
                        </div>
                    </div>
                );
            }}
        />
    );
}
