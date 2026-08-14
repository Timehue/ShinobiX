/*
 * Pet Showdown kit audit — the structural pass the win-rate analyzer can't do.
 *
 * showdown-balance.mjs answers "does this species win too much or too little";
 * it cannot say WHY. Every kit surgery so far started with the same manual
 * autopsy: read the sealed kit, find the structural fault (a power-0 control
 * move priced at the cost floor, a kit whose only damage is held so round one
 * is spent poking, a technique duplicating the utility its role already
 * derives). This script does that autopsy for all 140 species at once.
 *
 * Run:  node --import tsx scripts/showdown-kit-audit.mjs [--flag noLiveDamage]
 *
 * Every flag is a TEMTEM/CHAMPIONS design invariant, not an opinion:
 *   noLiveDamage  — a pet must be able to threaten damage on round one.
 *                   Both games open with a live attacking option; a kit whose
 *                   damage is entirely on hold spends round one poking with
 *                   the neutral jab (the Tempest Pegasus disease, 19.5%).
 *   allUtility    — a kit with no damage technique at all cannot close.
 *   dupKind       — two techniques of the same kind is a wasted slot; both
 *                   games give a mon distinct tools, not two of one.
 *   utilityDup    — the derived utility duplicating an authored kind (a
 *                   legendary assassin deriving `mark` while also carrying an
 *                   authored mark) — the round-45 finding.
 *   freeControl   — a control/utility technique priced at the stamina floor is
 *                   spammable disruption; Temtem prices control at real
 *                   stamina and hold. This was the original HIGH-four engine.
 *   thinKit       — fewer than three real options is not a moveset.
 *   noStab        — no technique carrying the pet's own element wastes STAB
 *                   entirely, which both games build around.
 */

import { PET_CATALOG } from '../api/pet/_catalog.ts';
import { createShowdownSession } from '../api/_pet-showdown/engine.ts';
import { SHOWDOWN_COST_MIN } from '../shared/pet-showdown-contract.ts';

const onlyFlag = process.argv.includes('--flag') ? process.argv[process.argv.indexOf('--flag') + 1] : '';

const DAMAGING = new Set(['damage', 'crush', 'lifesteal', 'push', 'pull', 'dot', 'burn', 'wound', 'stun', 'freeze', 'confuse', 'debuff', 'slow', 'mark', 'movelock']);
/** Kinds whose whole value is the immediate hit. */
// Matches the engine's own reading of 'kinds whose value IS the hit': a wound
// or a DoT is a live attacking option (KIND_FX mult 0.82), a stun is not (0.5).
const REAL_DAMAGE = new Set(['damage', 'crush', 'lifesteal', 'wound', 'dot', 'burn', 'push', 'pull']);
const CONTROLish = new Set(['stun', 'freeze', 'confuse', 'slow', 'movelock', 'debuff', 'mark', 'taunt']);

function sealOne(tpl) {
    const session = createShowdownSession({
        sessionId: 'audit', playerName: 'a', format: '1v1', tier: 'warrior', seed: 7,
        playerPets: [{ ...tpl, id: tpl.id ?? 'p1', templateId: tpl.id, level: 30 }],
        enemyPets: [{ ...tpl, id: 'e1', templateId: tpl.id, level: 30 }],
        enemyTeamName: 'b',
    });
    return session.player[0];
}

const rows = [];
for (const tpl of Object.values(PET_CATALOG)) {
    if (tpl.wildSpawnable === false || !Array.isArray(tpl.jutsus)) continue;
    const pet = sealOne(tpl);
    // moves[0] is the universal neutral jab; the signature is separate.
    const kit = (pet.moves ?? []).slice(1);
    const sig = pet.signatureMove;
    const flags = [];

    const liveDamage = kit.filter((m) => REAL_DAMAGE.has(m.kind) && m.power > 0 && m.hold === 0);
    if (!liveDamage.length) flags.push('noLiveDamage');
    if (!kit.some((m) => REAL_DAMAGE.has(m.kind) && m.power > 0)) flags.push('allUtility');

    const kinds = kit.map((m) => m.kind);
    const dup = kinds.filter((k, i) => k !== 'damage' && kinds.indexOf(k) !== i);
    if (dup.length) flags.push(`dupKind:${[...new Set(dup)].join('/')}`);

    const cheapControl = kit.filter((m) => CONTROLish.has(m.kind) && m.cost <= SHOWDOWN_COST_MIN + 2);
    if (cheapControl.length) flags.push(`freeControl:${cheapControl.map((m) => m.name).join('/')}`);

    if (kit.length < 3) flags.push(`thinKit:${kit.length}`);
    if (pet.element !== 'None' && !kit.some((m) => m.element === pet.element) && sig?.element !== pet.element) flags.push('noStab');

    rows.push({
        name: tpl.name, rarity: tpl.rarity, role: pet.role, element: pet.element,
        kit: kit.map((m) => `${m.name}[${m.kind} p${m.power} c${m.cost}${m.hold ? ' H' : ''}]`).join(' · '),
        flags,
    });
}

const flagged = rows.filter((r) => r.flags.length && (!onlyFlag || r.flags.some((f) => f.startsWith(onlyFlag))));
console.log(`Audited ${rows.length} species — ${flagged.length} carry at least one structural flag.\n`);

const counts = {};
for (const r of rows) for (const f of r.flags) {
    const key = f.split(':')[0];
    counts[key] = (counts[key] ?? 0) + 1;
}
console.log('FLAG TOTALS:', JSON.stringify(counts), '\n');

for (const r of flagged) {
    console.log(`${r.name} (${r.rarity} ${r.element} ${r.role})`);
    console.log(`  flags: ${r.flags.join(', ')}`);
    console.log(`  kit:   ${r.kit}`);
}
