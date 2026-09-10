// Full-health technique probes. Unlike a win-rate simulation, every legal
// uncharged move is exercised against every same-rarity catalog opponent.
import { writeFileSync } from 'node:fs';
import { PET_CATALOG } from '../api/pet/_catalog.ts';
import { createShowdownSession, resolveShowdownRound } from '../api/_pet-showdown/engine.ts';

const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const levels = String(option('--levels', '1,5,10,20,25,50')).split(',').map(Number);
const seeds = Number(option('--seeds', 3));
const ultimatesOnly = args.includes('--ultimates-only');
const guarded = args.includes('--guarded');
const charged = args.includes('--charged') || ultimatesOnly;
if (!Number.isInteger(seeds) || seeds < 1 || levels.some(n => !Number.isInteger(n) || n < 1 || n > 100)) throw new Error('Invalid levels/seeds');
const templates = Object.values(PET_CATALOG).filter(t => Array.isArray(t.jutsus));
const fixture = (tpl, id, level) => {
    const points = level - 1, each = Math.floor(points / 4);
    return { ...tpl, id, templateId: tpl.id, level,
        growthBaseStats: { hp: tpl.hp, attack: tpl.attack, defense: tpl.defense, speed: tpl.speed },
        growthAllocation: { vitality: each + (points % 4 > 0 ? 1 : 0), power: each + (points % 4 > 1 ? 1 : 0), guard: each + (points % 4 > 2 ? 1 : 0), agility: each } };
};
const rows = [], worst = [];
for (const level of levels) {
    const row = { level, hits: 0, oneShots: 0, maxHpFraction: 0 };
    for (const attacker of templates) for (const defender of templates.filter(t => t.rarity === attacker.rarity)) for (let seed = 1; seed <= seeds; seed++) {
        const create = () => createShowdownSession({ sessionId: 'burst-audit', playerName: 'Audit', enemyTeamName: 'Audit', format: '1v1', tier: 'warrior', seed: 7919 + seed,
            playerPets: [fixture(attacker, 'attacker', level)], enemyPets: [fixture(defender, 'defender', level)], rewardEligible: false });
        const initial = create();
        const moves = ultimatesOnly ? [initial.player[0].signatureMove] : [...initial.player[0].moves, ...(charged ? [initial.player[0].signatureMove] : [])];
        for (const [moveIndex, move] of moves.entries()) {
            if ((!charged && move.hold > 0) || move.cls === 'status') continue;
            const session = create();
            if (charged) { session.player[0].readiness = 99; session.player[0].meter = 100; }
            const command = move.signature ? { kind: 'super', petId: 'attacker', targetId: 'defender' } : { kind: 'move', petId: 'attacker', targetId: 'defender', moveIndex };
            const events = resolveShowdownRound(session, [command], [{ kind: guarded ? 'guard' : 'rest', petId: 'defender' }]);
            const hit = events.find(e => e.t === 'action' && e.actorId === 'attacker')?.targets[0];
            if (!hit || hit.damage <= 0) continue;
            const ratio = hit.damage / initial.enemy[0].maxHp;
            row.hits++;
            if (hit.ko) row.oneShots++;
            row.maxHpFraction = Math.max(row.maxHpFraction, ratio);
            if (ratio > 0.9) worst.push({ level, attacker: attacker.id, defender: defender.id, move: move.name, kind: move.kind, power: move.power, ratio, damage: hit.damage, maxHp: initial.enemy[0].maxHp });
        }
    }
    rows.push(row);
}
worst.sort((a, b) => b.ratio - a.ratio);
const report = { seeds, charged, ultimatesOnly, guarded, templates: templates.length, assumptions: `Same level and rarity; balanced growth; no gear or traits; ${ultimatesOnly ? 'every signature with full readiness and meter' : charged ? 'every damaging technique, with full readiness and signature meter' : 'every uncharged non-signature damaging opener'} against a full-health target ${guarded ? 'ordered to Guard (actual turn priority is preserved, so a faster attack may land before Guard)' : 'ordered to Rest without guarding'}. Separate fresh session per probe. Both counter and neutral/resisted matchups included.`, rows, worst: worst.slice(0, 40) };
const path = option('--report');
if (path) writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
