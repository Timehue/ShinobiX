import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseWorldEffects, WORLD_EFFECTS_OUTBOX_CAP, worldEffectsOutboxKey } from './_effects-outbox.js';

describe('world effects outbox — shape', () => {
    it('keys by player slug and parses only well-formed effects', () => {
        assert.equal(worldEffectsOutboxKey('rill'), 'world-effects:rill');
        const parsed = parseWorldEffects([
            { kind: 'intel', requestId: 'explore-req-000001', sector: 12, village: ' Mist ' },
            { kind: 'contract', requestId: 'explore-req-000002', sector: 3 },
            { kind: 'intel', requestId: 'short', sector: 12 },
            { kind: 'bogus', requestId: 'explore-req-000003', sector: 12 },
            { kind: 'contract', requestId: 'explore-req-000004', sector: 0 },
            null,
        ]);
        assert.deepEqual(parsed, [
            { kind: 'intel', requestId: 'explore-req-000001', sector: 12, village: 'Mist' },
            { kind: 'contract', requestId: 'explore-req-000002', sector: 3 },
        ]);
        assert.deepEqual(parseWorldEffects('nope'), []);
        assert.ok(WORLD_EFFECTS_OUTBOX_CAP >= 10);
    });
});
