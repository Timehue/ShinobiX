import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const root = 'docs/pve-close-fights-evidence';
const names = ['progression', 'endgame', 'near94', 'special', 'rookie'];
const reports = names.map(name => ({ name, report: JSON.parse(readFileSync(`${root}/${name}.json`, 'utf8')) }));
const pending = reports.filter(({ report }) => !report.complete || !report.unchangedSources).map(r => r.name);
if (pending.length) throw new Error(`Evidence is not final: ${pending.join(', ')}`);
const mismatches = reports.flatMap(({ name, report }) => Object.entries(report.sourceHashes).filter(([path, hash]) =>
    createHash('sha256').update(readFileSync(path)).digest('hex') !== hash).map(([path]) => `${name}:${path}`));
if (mismatches.length) throw new Error(`Evidence source mismatch: ${mismatches.join(', ')}`);
const rows = reports.flatMap(({ name, report }) => report.rows.map(r => ({ ...r, report: name })));
const mean = a => a.reduce((n, v) => n + v, 0) / Math.max(1, a.length);
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const round = n => Math.round(n * 100) / 100;
const groups = new Map();
for (const r of rows) {
    const key = [r.report, r.source, r.fixture, r.level, r.difficulty, r.variant, r.playerPolicy].join(':');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
}
const summary = [...groups].map(([key, set]) => ({ key, fights: set.length,
    wins: set.filter(r => r.outcome === 'win').length, deaths: set.filter(r => r.death).length,
    livingLimits: set.filter(r => r.roundLimitLoss).length,
    medianMinHpPct: round(median(set.map(r => r.minimumHp / r.maxHp * 100))),
    minHpPctRange: [Math.min(...set.map(r => r.minimumHp / r.maxHp * 100)), Math.max(...set.map(r => r.minimumHp / r.maxHp * 100))].map(round),
    meanFinalHpPct: round(mean(set.map(r => r.finalHp / r.maxHp * 100))),
    rounds: [Math.min(...set.map(r => r.rounds)), Math.max(...set.map(r => r.rounds))],
    meanActualHpDamage: round(mean(set.map(r => r.damageToHp))),
    meanEnemyDirectHpDamage: round(mean(set.map(r => r.enemyDirectHpDamage))),
    meanShieldDamage: round(mean(set.map(r => r.damageToShield))),
    meanAppliedHealing: round(mean(set.map(r => r.playerHealing))),
    meanEnemyAp: round(mean(set.map(r => r.enemyApPerTurn))),
    cooldownDryTurns: set.reduce((n, r) => n + r.cooldownDryTurns, 0),
}));

const keyForPair = r => [r.report, r.source, r.fixture, r.level, r.difficulty, r.seed, r.playerPolicy].join(':');
const old = new Map(rows.filter(r => r.variant === 'before').map(r => [keyForPair(r), r]));
const unchangedFields = ['outcome', 'death', 'roundLimitLoss', 'rounds', 'minimumHp', 'finalHp', 'finalEnemyHp',
    'damageToHp', 'damageToShield', 'playerHealing', 'finalPlayerChakra', 'finalPlayerStamina'];
const controls = rows.filter(r => r.variant === 'after' && (r.enemyLevel <= 60 || r.difficulty === 'weaker'));
const changedControls = controls.filter(r => unchangedFields.some(f => r[f] !== old.get(keyForPair(r))?.[f])).map(keyForPair);
if (changedControls.length) throw new Error(`Protected/weak controls changed: ${changedControls.join(', ')}`);
if (rows.some(r => !r.completed || r.minimumHp > r.finalHp)) throw new Error('Incomplete fight or invalid minimum HP');
const output = { baselineSha: reports[0].report.baselineSha, complete: true, sourceHashesVerified: true,
    reports: reports.map(({ name, report }) => ({ name, rows: report.rows.length,
        sha256: createHash('sha256').update(readFileSync(`${root}/${name}.json`)).digest('hex') })),
    totalRows: rows.length, protectedAndWeakMatchedControls: controls.length, changedControls, summary };
writeFileSync(`${root}/summary.json`, JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output, null, 2));
