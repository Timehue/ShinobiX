import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { migrationSourceWritersStopped } from './_migration-write-fence.js';

describe('overlay-to-base migration write-fence acknowledgement', () => {
    it('never treats maintenance mode alone as source-writer quiescence', () => {
        assert.equal(migrationSourceWritersStopped({}), false);
        assert.equal(migrationSourceWritersStopped({ MAINTENANCE_MODE: '1' }), false);
    });

    it('requires the explicit exact-value operator acknowledgement', () => {
        assert.equal(migrationSourceWritersStopped({ KV_MIGRATION_WRITE_FROZEN: 'true' }), false);
        assert.equal(migrationSourceWritersStopped({ KV_MIGRATION_WRITE_FROZEN: '1' }), true);
        assert.equal(migrationSourceWritersStopped({
            MAINTENANCE_MODE: '1',
            KV_MIGRATION_WRITE_FROZEN: '1',
        }), true);
    });
});
