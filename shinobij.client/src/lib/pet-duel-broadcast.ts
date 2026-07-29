import { DUEL_TPS, type DuelActorSnap, type DuelResult } from "./pet-duel-sim";

export type DuelBroadcastSide = {
    hp: number;
    maxHp: number;
    percent: number;
    alive: number;
};

export type DuelBroadcastRead = {
    player: DuelBroadcastSide;
    enemy: DuelBroadcastSide;
    elapsedSeconds: number;
    lead: "player" | "enemy" | "even";
    call: "You have the edge" | "Dead even" | "Under pressure";
};

export type DuelRecap = {
    durationSeconds: number;
    playerClashWins: number;
    enemyClashWins: number;
    clashDeadlocks: number;
    playerDamage: number;
    enemyDamage: number;
    winnerHpPercent: number;
};

const EMPTY_SIDE: DuelBroadcastSide = { hp: 0, maxHp: 0, percent: 0, alive: 0 };

function summarize(actors: readonly DuelActorSnap[], team: "player" | "enemy"): DuelBroadcastSide {
    const teamActors = actors.filter((actor) => actor.team === team);
    if (teamActors.length === 0) return EMPTY_SIDE;
    const hp = teamActors.reduce((sum, actor) => sum + Math.max(0, actor.hp), 0);
    const maxHp = teamActors.reduce((sum, actor) => sum + Math.max(0, actor.maxHp), 0);
    return {
        hp,
        maxHp,
        percent: maxHp > 0 ? Math.max(0, Math.min(100, (hp / maxHp) * 100)) : 0,
        alive: teamActors.filter((actor) => actor.hp > 0).length,
    };
}

export function petDuelBroadcastRead(duel: DuelResult, tick: number): DuelBroadcastRead {
    const index = Math.min(duel.snapshots.length - 1, Math.max(0, Math.floor(tick)));
    const actors = index >= 0 ? duel.snapshots[index]?.actors ?? [] : [];
    const player = summarize(actors, "player");
    const enemy = summarize(actors, "enemy");
    const delta = player.percent - enemy.percent;
    const lead = delta > 6 ? "player" : delta < -6 ? "enemy" : "even";
    return {
        player,
        enemy,
        elapsedSeconds: Math.max(0, Math.floor(tick / DUEL_TPS)),
        lead,
        call: lead === "player" ? "You have the edge" : lead === "enemy" ? "Under pressure" : "Dead even",
    };
}

export function petDuelRecap(duel: DuelResult): DuelRecap {
    const finalActors = duel.snapshots[duel.snapshots.length - 1]?.actors ?? [];
    const winnerTeam = duel.winner === "player" || duel.winner === "enemy" ? duel.winner : null;
    const winner = winnerTeam ? summarize(finalActors, winnerTeam) : EMPTY_SIDE;
    const deadlockTicks = new Set<number>();
    let playerClashWins = 0;
    let enemyClashWins = 0;
    let playerDamage = 0;
    let enemyDamage = 0;

    for (const event of duel.events) {
        if (event.type === "hit") {
            const damage = Math.max(0, event.dmg ?? 0);
            if (event.side === "player") playerDamage += damage;
            else if (event.side === "enemy") enemyDamage += damage;
            if (event.move === "Clash Break") {
                if (event.side === "player") playerClashWins += 1;
                else if (event.side === "enemy") enemyClashWins += 1;
            }
        } else if (event.type === "stagger" && event.move === "Clash") {
            deadlockTicks.add(event.t);
        }
    }

    return {
        durationSeconds: Math.max(1, Math.ceil(duel.ticks / DUEL_TPS)),
        playerClashWins,
        enemyClashWins,
        clashDeadlocks: deadlockTicks.size,
        playerDamage,
        enemyDamage,
        winnerHpPercent: Math.round(winner.percent),
    };
}
