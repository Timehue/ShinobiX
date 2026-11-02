import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import sharp from 'sharp';
import { starterJutsus, starterSavedBloodlines } from '../shinobij.client/src/data/jutsu.ts';
import { LEGACY_JUTSU_BY_ID } from '../shinobij.client/src/data/legacy-jutsu.ts';

test('every expansion option has unique named artwork, a saved prompt and a compact AVIF asset', async () => {
    const { jobs } = JSON.parse(readFileSync(new URL('./global-jutsu-art-prompts.json', import.meta.url), 'utf8'));
    const additions = starterJutsus.filter(j => /^starter-(?:nin|gen|tai|buki)-[a-z]+-[56]$/.test(j.id) || j.id.startsWith('starter-any-'));
    assert.equal(jobs.length, 45);
    assert.deepEqual(jobs.map(j => j.id).sort(), additions.map(j => j.id).sort());
    const names = new Set();
    const hashes = new Set();
    let totalBytes = 0;
    const original = [
        ...starterJutsus.filter(j => !additions.includes(j)),
        ...starterSavedBloodlines.flatMap(bloodline => bloodline.jutsus),
        ...LEGACY_JUTSU_BY_ID.values(),
    ];
    for (const jutsu of additions) {
        const name = jutsu.name.toLowerCase().replaceAll('’', "'");
        assert.ok(!names.has(name), `duplicate new name: ${jutsu.name}`);
        assert.ok(!original.some(j => j.name.toLowerCase().replaceAll('’', "'") === name), `existing name: ${jutsu.name}`);
        names.add(name);
        const job = jobs.find(job => job.id === jutsu.id);
        assert.equal(job.name, jutsu.name);
        assert.ok(job.prompt.includes(jutsu.element));
        assert.equal(jutsu.image, `/jutsu/global/${jutsu.id}.avif`);
        const bytes = readFileSync(new URL(`../shinobij.client/public${jutsu.image}`, import.meta.url));
        assert.ok(bytes.length < 200 * 1024, `${jutsu.id}: exceeds the still-image budget`);
        const info = await sharp(bytes).metadata();
        assert.equal(info.format, 'heif');
        assert.equal(info.compression, 'av1');
        assert.equal(info.width, 320);
        assert.equal(info.height, 320);
        const hash = createHash('sha256').update(bytes).digest('hex');
        assert.ok(!hashes.has(hash), `${jutsu.id}: reused artwork`);
        hashes.add(hash);
        totalBytes += bytes.length;
    }
    assert.ok(totalBytes <= 240 * 1024, `expansion art uses ${totalBytes} bytes; keep it within the existing runtime artifact budget`);
});
