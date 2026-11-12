import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SECTOR_FLOOR_SECTORS } from './sector-art-manifest';

// The generator (scripts/gen-sector-art.mjs) rebuilds this list from disk, but it
// is a paid image pipeline nobody re-runs for hand-composed floors. Cinderhold's
// eight floors (s67-s74) were added without it, so their boards silently fell
// back to the shared theme art. Keep the list equal to the floors on disk.
test('the floor manifest lists exactly the painted floors on disk', () => {
    const dir = fileURLToPath(new URL('../../public/sector-map/', import.meta.url));
    const onDisk = readdirSync(dir).map((name) => /^s(\d+)\.webp$/.exec(name)?.[1]).filter((n): n is string => !!n).map(Number).sort((a, b) => a - b);
    assert.ok(onDisk.includes(67) && onDisk.includes(99), 'the scan still finds real floors');
    assert.deepEqual([...SECTOR_FLOOR_SECTORS].sort((a, b) => a - b), onDisk);
});
