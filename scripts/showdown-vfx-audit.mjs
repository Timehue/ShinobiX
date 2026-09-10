import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { PET_CATALOG } from '../api/pet/_catalog.ts';
import { createShowdownSession, showdownStateView } from '../api/_pet-showdown/engine.ts';
import { buildMovePresentations, movePresentationKey } from '../shinobij.client/src/lib/showdown-move-presentation.ts';

const rows = [];
for (const pet of Object.values(PET_CATALOG)) {
    const session = createShowdownSession({ sessionId: 'vfx-audit', playerName: 'Review', format: '1v1', tier: 'warrior', seed: 7,
        playerPets: [{ ...pet, templateId: pet.id, level: 30 }], enemyPets: [{ ...pet, id: 'opponent', templateId: pet.id, level: 30 }], enemyTeamName: 'Review' });
    const moves = showdownStateView(session).player[0].moves;
    const presentations = buildMovePresentations(moves);
    const loadout = moves.map(move => ({ name: move.name, kind: move.kind, element: move.element, signature: move.signature,
        ...presentations.get(movePresentationKey(move.name, move.signature)) }));
    assert.equal(new Set(loadout.map(move => move.grammar)).size, moves.length, `${pet.name}: duplicate primary silhouettes`);
    rows.push({ id: pet.id, pet: pet.name, moves: loadout });
}
const report = { pets: rows.length, moves: rows.reduce((sum, row) => sum + row.moves.length, 0), duplicateLoadouts: 0, rows };
const out = process.argv.find(arg => arg.startsWith('--out='))?.slice(6);
if (out) writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ pets: report.pets, moves: report.moves, duplicateLoadouts: report.duplicateLoadouts, output: out ?? null }));
