// Controlled signature probes at full and wounded HP; no production tuning.
// Run: node --import tsx scripts/showdown-response-audit.mjs [--report path.json]
import { writeFileSync } from 'node:fs';
import { PET_CATALOG } from '../api/pet/_catalog.ts';
import { createShowdownSession, resolveShowdownRound } from '../api/_pet-showdown/engine.ts';

const args = process.argv.slice(2);
const option = (name, fallback) => {
    const index = args.indexOf(name);
    if (index < 0) return fallback;
    if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing value for ${name}`);
    return args[index + 1];
};
const levels = String(option('--levels', '1,25,50,100')).split(',').map(Number);
const seeds = Number(option('--seeds', 3));
if (!Number.isInteger(seeds) || seeds < 1 || !levels.length
    || levels.some(level => !Number.isInteger(level) || level < 1 || level > 100)) {
    throw new Error('Use levels 1..100 and seeds >= 1.');
}
const templates = Object.values(PET_CATALOG).filter(template => Array.isArray(template.jutsus));
if (!templates.length) throw new Error('No catalog templates to probe.');
const fixture = (template, id, level) => {
    const points = level - 1, each = Math.floor(points / 4);
    return {
        ...template, id, templateId: template.id, level, trait: undefined, loadout: undefined,
        growthBaseStats: { hp: template.hp, attack: template.attack, defense: template.defense, speed: template.speed },
        growthAllocation: {
            vitality: each + (points % 4 > 0 ? 1 : 0), power: each + (points % 4 > 1 ? 1 : 0),
            guard: each + (points % 4 > 2 ? 1 : 0), agility: each,
        },
    };
};
const rows = [];
for (const level of levels) for (const startingHpFraction of [1, 0.75, 0.5]) for (const guarded of [false, true]) {
    const row = { level, startingHpFraction, guarded, hits: 0, knockouts: 0, meanReportedDamageFraction: 0, maxReportedDamageFraction: 0 };
    for (const template of templates) for (let seed = 1; seed <= seeds; seed++) {
        const battle = createShowdownSession({
            sessionId: 'response-audit', playerName: 'Audit', enemyTeamName: 'Audit',
            format: '1v1', tier: 'warrior', seed: 7919 + seed, rewardEligible: false,
            playerPets: [fixture(template, 'attacker', level)], enemyPets: [fixture(template, 'defender', level)],
        });
        const defender = battle.enemy[0];
        defender.hp = Math.round(defender.maxHp * startingHpFraction);
        battle.player[0].meter = 100;
        battle.player[0].readiness = 99;
        const events = resolveShowdownRound(battle,
            [{ kind: 'super', petId: 'attacker', targetId: 'defender' }],
            [{ kind: guarded ? 'guard' : 'rest', petId: 'defender' }]);
        const hit = events.find(event => event.t === 'action' && event.actorId === 'attacker')
            ?.targets.find(target => target.id === 'defender');
        if (!hit || !Number.isFinite(hit.damage) || hit.damage <= 0) throw new Error(`Missing damaging signature: ${template.id}`);
        const fraction = hit.damage / defender.maxHp;
        row.hits++;
        row.knockouts += Number(hit.ko);
        row.meanReportedDamageFraction += fraction;
        row.maxReportedDamageFraction = Math.max(row.maxReportedDamageFraction, fraction);
    }
    row.meanReportedDamageFraction = Number((row.meanReportedDamageFraction / row.hits).toFixed(4));
    row.maxReportedDamageFraction = Number(row.maxReportedDamageFraction.toFixed(4));
    rows.push({ ...row, knockoutRate: Number((row.knockouts / row.hits).toFixed(4)) });
}
const report = {
    templates: templates.length, seeds,
    assumptions: 'Same-species neutral mirrors at matched levels with balanced legal growth; no traits, gear, weather or setup. Fresh session per probe; signature meter/readiness manually filled; defender HP manually set to its probe band. Defender ordered Rest or Guard, preserving real initiative. Reported damage can include overkill. This is not a complete-bout, opponent-tier, cross-species or human-playtest sample.',
    observations: rows.reduce((sum, row) => sum + row.hits, 0), rows,
};
const path = option('--report');
if (path) writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
