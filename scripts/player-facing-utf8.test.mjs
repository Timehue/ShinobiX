import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { describe, it } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const sourceRoots = ['api/player', 'shared', 'shinobij.client/src'];
const textExtensions = new Set(['.css', '.html', '.json', '.ts', '.tsx']);

// UTF-8 punctuation decoded as Windows-1252, plus the two common leading
// characters produced when accented UTF-8 text is decoded one byte at a time.
const mojibakeMarkers = new Map([
    ['en dash', '\u00e2\u20ac\u201c'],
    ['em dash', '\u00e2\u20ac\u201d'],
    ['right apostrophe', '\u00e2\u20ac\u2122'],
    ['left double quote', '\u00e2\u20ac\u0153'],
    ['right double quote', '\u00e2\u20ac\u009d'],
    ['misdecoded two-byte UTF-8 (U+00C3)', '\u00c3'],
    ['stray UTF-8 lead byte (U+00C2)', '\u00c2'],
]);

function sourceFiles(directory) {
    const files = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const absolute = join(directory, entry.name);
        if (entry.isDirectory()) files.push(...sourceFiles(absolute));
        else if (textExtensions.has(extname(entry.name))) files.push(absolute);
    }
    return files;
}

function location(source, offset) {
    const before = source.slice(0, offset);
    const line = before.split('\n').length;
    const column = offset - before.lastIndexOf('\n');
    return `${line}:${column}`;
}

function findMojibake(source) {
    return [...mojibakeMarkers].filter(([, marker]) => source.includes(marker));
}

describe('player-facing UTF-8 source', () => {
    it('recognizes every guarded mojibake sequence', () => {
        for (const [label, marker] of mojibakeMarkers) {
            assert.ok(findMojibake(`before ${marker} after`).some(([found]) => found === label), `${label} marker is detectable`);
        }
    });

    it('contains no common mojibake markers', () => {
        const failures = [];
        for (const sourceRoot of sourceRoots) {
            for (const file of sourceFiles(join(root, sourceRoot))) {
                const source = readFileSync(file, 'utf8');
                for (const [label, marker] of mojibakeMarkers) {
                    let offset = source.indexOf(marker);
                    while (offset !== -1) {
                        failures.push(`${relative(root, file).replaceAll('\\', '/')}:${location(source, offset)} (${label})`);
                        offset = source.indexOf(marker, offset + marker.length);
                    }
                }
            }
        }
        assert.deepEqual(failures, [], `mojibake found in player-facing source:\n${failures.join('\n')}`);
    });
});
