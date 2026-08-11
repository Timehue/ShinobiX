import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const combatSelectionSurfaces = [
    'battle-start.ts',
    'warfront-start.ts',
    '../pet-ladder/ladder.ts',
    '../arena/lobby.ts',
    '../clan/war/pet.ts',
    '../village/sector-pet.ts',
    '../_realtime/pet-duel-socket.ts',
    '../player/challenge.ts',
    '../combat-core/companion.ts',
] as const;

test('pet combat selection surfaces reuse the centralized busy-state predicate', () => {
    for (const relativePath of combatSelectionSurfaces) {
        const source = readFileSync(resolve('api/pet', relativePath), 'utf8');
        assert.match(source, /petCombatBusyReason/, `${relativePath} must enforce the shared combat-busy rule`);
        assert.doesNotMatch(
            source,
            /activeBreedingParentIds/,
            `${relativePath} must not regress to a breeding-only combat check`,
        );
    }
});
