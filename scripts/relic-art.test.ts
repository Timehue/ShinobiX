import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { RELIC_ROSTER } from '../shared/relics.js';

test('all 20 relics ship distinct, decodable, nonblank inventory artwork', async () => {
    assert.equal(RELIC_ROSTER.length, 20);
    const filenames = new Set(await readdir('shinobij.client/public/items'));
    const paths = new Set<string>();
    const hashes = new Set<string>();
    for (const relic of RELIC_ROSTER) {
        assert.match(relic.image, /^\/items\/[a-z0-9-]+\.webp$/, relic.id);
        assert.ok(filenames.has(relic.image.slice('/items/'.length)), `filename case must match on Linux: ${relic.id}`);
        assert.ok(!paths.has(relic.image), `shared placeholder image: ${relic.id}`);
        paths.add(relic.image);
        const bytes = await readFile(`shinobij.client/public${relic.image}`);
        const hash = createHash('sha256').update(bytes).digest('hex');
        assert.ok(!hashes.has(hash), `duplicate artwork bytes: ${relic.id}`);
        hashes.add(hash);
        const metadata = await sharp(bytes).metadata();
        assert.equal(metadata.format, 'webp', relic.id);
        assert.ok((metadata.width ?? 0) >= 96 && (metadata.height ?? 0) >= 96, `undersized art: ${relic.id}`);
        const stats = await sharp(bytes).stats();
        assert.ok(stats.channels.slice(0, 3).some(channel => channel.stdev > 4), `blank art: ${relic.id}`);
        if (metadata.hasAlpha) assert.ok(stats.channels.at(-1)!.max > 0, `invisible art: ${relic.id}`);
    }
});
