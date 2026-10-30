import assert from 'node:assert/strict';
import { test } from 'node:test';
import { beginEmbeddedCombat, hasEmbeddedCombat } from './embedded-combat';

test('embedded combat is scoped to the account and each mounted host', () => {
    assert.equal(hasEmbeddedCombat('Rill'), false);
    const releasePatrol = beginEmbeddedCombat('Rill');
    const releaseVault = beginEmbeddedCombat('rill');
    assert.equal(hasEmbeddedCombat('RILL'), true);
    assert.equal(hasEmbeddedCombat('Buster'), false);
    releasePatrol(); releasePatrol();
    assert.equal(hasEmbeddedCombat('Rill'), true, 'a stale cleanup cannot unpause a newer fight');
    releaseVault();
    assert.equal(hasEmbeddedCombat('Rill'), false, 'traversal resumes recovery after the last host exits');
});
