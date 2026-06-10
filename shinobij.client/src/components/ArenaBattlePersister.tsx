/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect } from "react";
import { ARENA_SAVE_TTL_MS } from "../lib/battle-save";

type ArenaBattlePersisterProps = {
    characterName: string;
    battleStarted: boolean;
    battleEnded: boolean;
    isPvpFight: boolean;
    opponentName?: string;
    pendingStoryKind?: string;
    playerHp: number; enemyHp: number;
    enemyChakra: number; enemyStamina: number;
    ap: number; enemyAp: number;
    turn: number;
    activeActor: "player" | "enemy";
    actionsThisTurn: number;
    playerStatuses: unknown[]; enemyStatuses: unknown[];
    barrierTiles: { tile: number; rounds: number }[];
    cooldowns: Record<string, number>;
    jutsuCooldowns: Record<string, number>;
    enemyJutsuCooldowns: Record<string, number>;
    playerShield: number; enemyShield: number;
    playerPos: number; enemyPos: number;
    battleHistory: unknown[];
    summonedPetId: string;
    rankedBattleActive: boolean;
    clanWarPointsActive: number;
    onRestore: (saved: SavedArenaBattle) => void;
};
type SavedArenaBattle = {
    savedAt: number;
    opponentName?: string;
    pendingStoryKind?: string;
    battleStarted: boolean;
    playerHp: number; enemyHp: number;
    enemyChakra: number; enemyStamina: number;
    ap: number; enemyAp: number;
    turn: number;
    activeActor: "player" | "enemy";
    actionsThisTurn: number;
    playerStatuses: unknown[]; enemyStatuses: unknown[];
    barrierTiles: { tile: number; rounds: number }[];
    cooldowns: Record<string, number>;
    jutsuCooldowns: Record<string, number>;
    enemyJutsuCooldowns: Record<string, number>;
    playerShield: number; enemyShield: number;
    playerPos: number; enemyPos: number;
    battleHistory: unknown[];
    summonedPetId: string;
    rankedBattleActive: boolean;
    clanWarPointsActive: number;
};
export function ArenaBattlePersister(props: ArenaBattlePersisterProps) {
    const key = `arena.battle.v3.${props.characterName}`;
    // SAVE — fires on turn boundary or battle end. Reads state via the
    // closure of `props`. Deps array tiny (4 items) so React can stably
    // schedule the effect.
    useEffect(() => {
        if (!props.battleStarted || props.battleEnded || props.isPvpFight) {
            try { localStorage.removeItem(key); } catch { /* ignore */ }
            return;
        }
        try {
            const snapshot: SavedArenaBattle = {
                savedAt: Date.now(),
                opponentName: props.opponentName,
                pendingStoryKind: props.pendingStoryKind,
                battleStarted: props.battleStarted,
                playerHp: props.playerHp, enemyHp: props.enemyHp,
                enemyChakra: props.enemyChakra, enemyStamina: props.enemyStamina,
                ap: props.ap, enemyAp: props.enemyAp,
                turn: props.turn,
                activeActor: props.activeActor,
                actionsThisTurn: props.actionsThisTurn,
                playerStatuses: props.playerStatuses, enemyStatuses: props.enemyStatuses,
                barrierTiles: props.barrierTiles,
                cooldowns: props.cooldowns,
                jutsuCooldowns: props.jutsuCooldowns,
                enemyJutsuCooldowns: props.enemyJutsuCooldowns,
                playerShield: props.playerShield, enemyShield: props.enemyShield,
                playerPos: props.playerPos, enemyPos: props.enemyPos,
                battleHistory: props.battleHistory,
                summonedPetId: props.summonedPetId,
                rankedBattleActive: props.rankedBattleActive,
                clanWarPointsActive: props.clanWarPointsActive,
            };
            localStorage.setItem(key, JSON.stringify(snapshot));
        } catch { /* quota — ignore */ }
         
    }, [props.turn, props.battleStarted, props.battleEnded, props.isPvpFight]);

    // RESTORE — one-shot on mount. No useRef needed — the component only
    // mounts once per Arena entry, so a single useEffect with [] deps
    // is enough.
    useEffect(() => {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return;
            const saved = JSON.parse(raw) as SavedArenaBattle;
            if (!saved?.battleStarted) return;
            if (Date.now() - (saved.savedAt ?? 0) > ARENA_SAVE_TTL_MS) {
                localStorage.removeItem(key);
                return;
            }
            // Encounter signature validation — opponent + story kind must
            // match, otherwise an old story-boss save could pour into a
            // fresh ambush.
            if (saved.pendingStoryKind !== props.pendingStoryKind) return;
            if (props.opponentName && saved.opponentName !== props.opponentName) return;
            props.onRestore(saved);
        } catch {
            try { localStorage.removeItem(key); } catch { /* ignore */ }
        }
         
    }, []);

    return null;
}
