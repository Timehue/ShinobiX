"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rankBand = rankBand;
exports.extractPvpLegacyDeltas = extractPvpLegacyDeltas;
const RE_HEAL = /^Heal: (.+) restores (\d+) HP\.$/;
const RE_SHIELD = /^Shield: (.+) gains (\d+) shield\.$/;
const RE_BLOCKED = /^(\d+) absorbed by (.+)'s shield\.$/;
const RE_DAMAGE = /^(\d+) damage to (.+)\.$/;
const RE_WOUND_TICK = /^(.+) bleeds (\d+) \(Wound\)\.$/;
const STYLE_STATS = {
    Ninjutsu: { kills: 'ninjutsuKills', damage: 'ninjutsuDamage' },
    Genjutsu: { kills: 'genjutsuKills', damage: 'genjutsuDamage' },
    Taijutsu: { kills: 'taijutsuKills', damage: 'taijutsuDamage' },
    Bukijutsu: { kills: 'bukijutsuKills', damage: 'bukijutsuDamage' },
};
function rankBand(level) {
    if (level >= 80)
        return 4; // Special Jonin
    if (level >= 50)
        return 3; // Jonin
    if (level >= 30)
        return 2; // Chunin
    if (level >= 15)
        return 1; // Genin
    return 0; // Academy
}
/** Extract both fighters' legacy deltas from a finished session. */
function extractPvpLegacyDeltas(session, winnerName, loserName) {
    const winner = session.p1.name === winnerName ? session.p1 : session.p2;
    const loser = session.p1.name === winnerName ? session.p2 : session.p1;
    // Per-fighter tallies from the log.
    const healing = {};
    const shieldCasts = {};
    const blocked = {};
    const damageDealt = {};
    const other = (name) => (name === session.p1.name ? session.p2.name : session.p1.name);
    for (const line of session.log ?? []) {
        let m = RE_HEAL.exec(line);
        if (m) {
            healing[m[1]] = (healing[m[1]] ?? 0) + Number(m[2]);
            continue;
        }
        m = RE_SHIELD.exec(line);
        if (m) {
            shieldCasts[m[1]] = (shieldCasts[m[1]] ?? 0) + 1;
            continue;
        }
        m = RE_BLOCKED.exec(line);
        if (m) {
            blocked[m[2]] = (blocked[m[2]] ?? 0) + Number(m[1]);
            continue;
        }
        m = RE_DAMAGE.exec(line);
        if (m) {
            const dealer = other(m[2]);
            damageDealt[dealer] = (damageDealt[dealer] ?? 0) + Number(m[1]);
            continue;
        }
        m = RE_WOUND_TICK.exec(line);
        if (m) {
            const dealer = other(m[1]);
            damageDealt[dealer] = (damageDealt[dealer] ?? 0) + Number(m[2]);
            continue;
        }
    }
    const winnerLevel = Number(winner.character?.level ?? 0) || 0;
    const loserLevel = Number(loser.character?.level ?? 0) || 0;
    const winnerComeback = winner.maxHp > 0 && winner.hp / winner.maxHp <= 0.15;
    const winnerDeltas = {
        pvpWins: 1,
        pvpKills: 1,
        ...(session.ranked ? { rankedWins: 1 } : {}),
    };
    const style = STYLE_STATS[String(winner.character?.specialty ?? '')];
    if (style) {
        winnerDeltas[style.kills] = 1;
        const dmg = damageDealt[winner.name] ?? 0;
        if (dmg > 0)
            winnerDeltas[style.damage] = dmg;
    }
    if ((healing[winner.name] ?? 0) > 0)
        winnerDeltas.healingDone = healing[winner.name];
    if ((shieldCasts[winner.name] ?? 0) > 0)
        winnerDeltas.shieldsApplied = shieldCasts[winner.name];
    if ((blocked[winner.name] ?? 0) > 0)
        winnerDeltas.damageBlocked = blocked[winner.name];
    if (winnerComeback)
        winnerDeltas.comebackWins = 1;
    if (loserLevel - winnerLevel >= 5)
        winnerDeltas.higherLevelWins = 1;
    if (rankBand(winnerLevel) === rankBand(loserLevel))
        winnerDeltas.sameRankWins = 1;
    // The loser still banked their support play; losses reset streaks upstream.
    const loserDeltas = { pvpLosses: 1 };
    if ((healing[loser.name] ?? 0) > 0)
        loserDeltas.healingDone = healing[loser.name];
    if ((shieldCasts[loser.name] ?? 0) > 0)
        loserDeltas.shieldsApplied = shieldCasts[loser.name];
    if ((blocked[loser.name] ?? 0) > 0)
        loserDeltas.damageBlocked = blocked[loser.name];
    const loserStyle = STYLE_STATS[String(loser.character?.specialty ?? '')];
    if (loserStyle) {
        const dmg = damageDealt[loser.name] ?? 0;
        if (dmg > 0)
            loserDeltas[loserStyle.damage] = dmg;
    }
    return { winnerDeltas, loserDeltas, winnerComeback };
}
