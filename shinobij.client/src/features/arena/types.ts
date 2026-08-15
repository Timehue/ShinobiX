import type { CombatVfxSpec } from "../../lib/combat-vfx";

export type ArenaCombatStatus = {
    name: string;
    rounds: number;
    activeRound?: number;
    amount?: number;
    percent?: number;
    discipline?: string;
    kind: "positive" | "negative";
};

export type ArenaBattleActor = "player" | "enemy";

export type ArenaBattleActionEntry = {
    round: number;
    actor: string;
    actorRole: ArenaBattleActor;
    actionId: string;
    description: string;
    actionNumber: number;
    createdAt: number;
};

export type ArenaSelectedCombatAction = "move" | undefined;

export type BattleArenaLobbyTab = "spar" | "bounty";

export type ArenaDistrictTab = "clanWar" | "tournaments" | "ranked" | "spectate" | "petBattles";

export type ArenaCombatVfx = {
    id: number;
    points: Array<{ x: number; y: number }>;
    spec: CombatVfxSpec;
};

export type ArenaHitFx = {
    id: string;
    x: number;
    y: number;
    amount: number;
    kind: "damage" | "heal";
};
