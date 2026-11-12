import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { MAX_WILD_SECTOR } from './sector-geo';

/**
 * The world grew from 60 to 66 to MAX_WILD_SECTOR (74, Cinderhold) and each time
 * some validators kept the old number: Cinderhold explore receipts, AI-fight
 * reports, pet encounters, dungeon probes and raid proofs were all refused at
 * `> 66` (2026-11-09). A sector bound must read MAX_WILD_SECTOR (or
 * isWildSector), never a number.
 */
const ROOTS = ['api', 'shared', 'shinobij.client/src'];
/** Deliberate: authored on the legacy 1..60 contract map, not "any wild sector". */
const ALLOWED: readonly [file: string, snippet: string, reason: string][] = [
    ['api/missions/_hunt-trail.ts', 'sector <= 60 && isWildSector(sector)', 'Hunter Guild trails stay on the 1..60 contract map'],
    ['shinobij.client/src/lib/hunt-trail.ts', 'sector <= 60 && isWildSector(sector)', 'client mirror of the hunt trail'],
    ['api/missions/_mission-progress-receipt.ts', 'opts.sector > 60', 'field/hunt mission targets are authored on 1..60'],
];
const BOUND = /\b\w*[sS]ector\w*!?\)?\s*(?:<=|>=|<|>)\s*(6\d|7\d)\b(?!\s*[%*.])/;

function* sources(dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist') continue;
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) yield* sources(full);
        else if (/\.(ts|tsx|mts|mjs)$/.test(name) && !/\.test\./.test(name)) yield full;
    }
}

test('no validator hard-codes the last wild sector', () => {
    const hits: string[] = [];
    // The dev server's mock routes live in vite.config.ts, outside the roots.
    for (const file of [...ROOTS.flatMap((root) => [...sources(root)]), path.join('shinobij.client', 'vite.config.ts')]) {
        readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
            if (!BOUND.test(line) || /^\s*(\/\/|\*)/.test(line)) return;
            const rel = file.split(path.sep).join('/');
            if (ALLOWED.some(([f, snippet]) => f === rel && line.includes(snippet))) return;
            hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 140)}`);
        });
    }
    assert.deepEqual(hits, [], 'Use MAX_WILD_SECTOR (or isWildSector) instead of a literal sector bound');
    // Each allowance must still point at a real line, or it is dead and should go.
    for (const [file, snippet] of ALLOWED) assert.ok(readFileSync(file, 'utf8').includes(snippet), `stale allowance ${file}`);
});

test('the scan still matches the shapes it guards', () => {
    for (const line of ['sector > 66', 'raidSector <= 66', 'sectorNum <= 66', 'data.sector! <= 66', 'Number(value.sector) <= 66', 'requestedSector > 74'])
        assert.ok(BOUND.test(line), line);
    for (const line of [`sector > ${'MAX_WILD_SECTOR'}`, 'sector >= 1', 'sectorCount * 66'])
        assert.ok(!BOUND.test(line), line);
    assert.equal(MAX_WILD_SECTOR, 74);
});
