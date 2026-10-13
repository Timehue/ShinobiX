import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
    ICON_COMPONENT,
    VARIANT_DIR,
    VARIANT_PX,
    readGameArtIconSources,
    variantPathFor,
} from './gen-game-art-icon-variants.mjs';

const sources = readGameArtIconSources();
const component = fs.readFileSync(ICON_COMPONENT, 'utf8');

function webpSize(file) {
    const bytes = fs.readFileSync(file);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF', `${file} is not a RIFF file`);
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP', `${file} is not a WebP file`);
    const chunk = bytes.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return [1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3)];
    if (chunk === 'VP8L') {
        const bits = bytes.readUInt32LE(21);
        return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
    }
    if (chunk === 'VP8 ') return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
    assert.fail(`${file} has an unknown WebP chunk ${chunk}`);
}

test('the ART table parses into one existing source per GameArtIcon kind', () => {
    const kindUnion = /export type GameArtIconKind = ([\s\S]*?);/.exec(component);
    assert.ok(kindUnion, 'GameArtIconKind union not found');
    const kinds = [...kindUnion[1].matchAll(/"(\w+)"/g)].map((match) => match[1]).sort();
    assert.deepEqual([...sources.keys()].sort(), kinds);
    for (const [kind, sourcePath] of sources) {
        assert.ok(fs.existsSync(sourcePath), `ART.${kind} source missing: ${sourcePath}`);
    }
});

test('every GameArtIcon kind has a small delivery copy within the 96 px box', () => {
    for (const kind of sources.keys()) {
        const file = variantPathFor(kind);
        assert.ok(fs.existsSync(file), `missing ${path.relative(process.cwd(), file)}; run node scripts/gen-game-art-icon-variants.mjs`);
        const [width, height] = webpSize(file);
        assert.ok(width <= VARIANT_PX && height <= VARIANT_PX, `${kind} copy is ${width}x${height}`);
        assert.ok(fs.statSync(file).size <= 12_000, `${kind} copy is ${fs.statSync(file).size} B`);
    }
    const extras = fs.readdirSync(VARIANT_DIR).filter((file) => !sources.has(file.replace(/\.webp$/, '')));
    assert.deepEqual(extras, [], 'stale icon copies no GameArtIcon kind uses');
});

test('GameArtIcon serves the small copy up to 48 px and the full art above it', () => {
    assert.match(component, /const SMALL_ICON_MAX_PX = 48;/);
    assert.match(component, /typeof size === "number" && size <= SMALL_ICON_MAX_PX \? `\/ui\/icon-96\/\$\{kind\}\.webp` : ART\[kind\]/);
    assert.match(component, /src=\{gameArtIconSrc\(kind, size\)\}/);
});
