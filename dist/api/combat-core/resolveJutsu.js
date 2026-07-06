"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveJutsu = resolveJutsu;
function resolveJutsu(args) {
    const { self, opponent, formulaSelf = self, formulaOpponent = opponent, jutsu, wMult, biome, round, masteryLevel, healBoost, phases, } = args;
    // The phase order is load-bearing: formula copies feed damage, while status
    // and post-damage phases thread their mutated fighter copies forward.
    const base = phases.resolveBaseDamage(formulaSelf, formulaOpponent, jutsu, wMult, biome, round, masteryLevel);
    const status = phases.resolveTagStatuses(self, opponent, jutsu, round, masteryLevel, base.baseDmg, healBoost);
    let s = status.s;
    let o = status.o;
    const logLines = status.lines;
    const hitFx = [];
    const damage = phases.resolveDamageNumber(self, opponent, jutsu, round, masteryLevel, base.offStats, status.damage, status.pierce, base.effectiveDR);
    if (damage > 0) {
        const post = phases.resolvePostDamage(s, o, jutsu, round, damage, status.pierce, healBoost);
        s = post.s;
        o = post.o;
        logLines.push(...post.lines);
        hitFx.push(...post.fx);
    }
    if (status.healing > 0) {
        s = phases.applyHealing(s, status.healing);
        const fx = phases.makeHitFx?.('self', status.healing, 'heal');
        if (fx)
            hitFx.push(fx);
    }
    if (status.shieldGain > 0) {
        s = phases.applyShield(s, status.shieldGain);
    }
    return {
        self: s,
        opponent: o,
        logLines,
        hitFx,
        metadata: {
            damage,
            baseDamage: base.baseDmg,
            effectiveDR: base.effectiveDR,
            pierce: status.pierce,
            healing: status.healing,
            shieldGain: status.shieldGain,
            masteryLevel,
        },
    };
}
