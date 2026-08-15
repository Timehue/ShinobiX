import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    SAVE_FIELD_CONTRACT,
    classifiedFieldSet,
    type OwnershipCategory,
} from '../api/save/_state-ownership.js';
import {
    SERVER_OWNED_CHARACTER_FIELDS,
    SERVER_OWNED_TOPLEVEL_FIELDS,
    SERVER_PROJECTED_VITAL_FIELDS,
    isServerOwnedSavePath,
} from '../shinobij.client/src/lib/save-ownership.js';

/*
 * The client conflict UI mirrors the ownership manifest so it can tell "the
 * player lost device progress" apart from "the server corrected the client".
 * Getting that backwards is what made the save-recovery banner unclearable, so
 * the mirror is pinned to the manifest here rather than trusted to stay in sync.
 *
 * Add a field to api/save/_state-ownership.ts and this test tells you whether
 * shinobij.client/src/lib/save-ownership.ts needs it too.
 */

/** Categories a generic player save cannot durably write. */
const NON_RESTORABLE: ReadonlySet<OwnershipCategory> = new Set<OwnershipCategory>([
    'server-ledger',
    'server-owned',
    'server-payout-stamp',
    'derived',
    'deprecated',
    'forbidden',
    'shared-admin-content',
]);

function expectedFor(scope: 'character' | 'top'): Set<string> {
    return new Set(
        SAVE_FIELD_CONTRACT
            .filter((def) => def.scope === scope && NON_RESTORABLE.has(def.category))
            .map((def) => def.field),
    );
}

function sorted(values: Iterable<string>): string[] {
    return [...values].sort();
}

test('the client mirror lists exactly the non-restorable character fields', () => {
    const expected = expectedFor('character');
    // The vitals are mirrored for a different reason (the read projection
    // recomputes them), so they are held separately and excluded here.
    const mirrored = new Set([...SERVER_OWNED_CHARACTER_FIELDS].filter((field) => !SERVER_PROJECTED_VITAL_FIELDS.has(field)));

    assert.deepEqual(
        sorted(mirrored),
        sorted(expected),
        'shinobij.client/src/lib/save-ownership.ts is out of sync with the manifest',
    );
});

test('the client mirror lists exactly the non-restorable top-level fields', () => {
    assert.deepEqual(
        sorted(SERVER_OWNED_TOPLEVEL_FIELDS),
        sorted(expectedFor('top')),
        'shinobij.client/src/lib/save-ownership.ts is out of sync with the manifest',
    );
});

test('vitals are mirrored as server-projected, not as server-owned', () => {
    // They are `server-clamped` in the manifest — writable — but
    // settleSaveRecordForRead re-derives them on every read, so a device copy is
    // never observable. If they are ever reclassified, this pins the reason.
    for (const field of SERVER_PROJECTED_VITAL_FIELDS) {
        const defs = SAVE_FIELD_CONTRACT.filter((def) => def.scope === 'character' && def.field === field);
        assert.equal(defs.length, 1, `${field} should have exactly one character-scope definition`);
        assert.equal(defs[0].category, 'server-clamped', `${field} is mirrored as a read projection, not an ownership category`);
        assert.ok(isServerOwnedSavePath(['character', field]), `${field} must classify as non-restorable`);
    }
});

test('every per-pet field is covered by the blanket on character.pets', () => {
    // The manifest classifies pet fields individually; the client only needs the
    // subtree, because `pets` itself is server-owned.
    assert.ok(classifiedFieldSet('pet').size > 0, 'the manifest should still classify pet-scope fields');
    assert.ok(SERVER_OWNED_CHARACTER_FIELDS.has('pets'), 'character.pets must stay in the mirror');
    assert.ok(isServerOwnedSavePath(['character', 'pets']), 'a pets divergence is never restorable by a generic save');
});

test('client-owned state stays restorable', () => {
    // The fields the recovery banner exists to protect. If one of these ever
    // classifies as server-owned, the banner would silently stop offering it.
    for (const path of [['currentSector'], ['currentBiome'], ['acceptedMissionIds'], ['missionProgress'], ['triggeredEvents']]) {
        assert.equal(isServerOwnedSavePath(path), false, `${path.join('.')} must remain restorable`);
    }
    for (const field of ['inventory', 'equipment', 'ryo', 'nindo', 'battleHistory', 'equippedJutsuIds']) {
        assert.equal(isServerOwnedSavePath(['character', field]), false, `character.${field} must remain restorable`);
    }
});
