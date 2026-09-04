import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { describe, it } from 'node:test';

// Brand/IP hygiene gate.
//
// ShinobiX has been scrubbed of competitor and borrowed-franchise names three
// times (2026-06-03, 2026-08-07, 2026-09-03) and each scrub decayed, because
// the only IP guard in the repo was `api/_text-moderation.ts` — and that only
// stops *players* from typing these words. Nothing ever looked at the source.
// This test does, so the next reintroduction fails CI instead of shipping.
//
// Adding a token here is cheap. Removing one needs a reason.

const root = resolve(import.meta.dirname, '..');
const sourceRoots = ['api', 'shared', 'scripts', 'shinobij.client/src', 'shinobij.client/scripts', 'docs', 'tools'];
const textExtensions = new Set(['.ts', '.tsx', '.mjs', '.cjs', '.json', '.md', '.css', '.html']);
const skipDirectories = new Set(['node_modules', 'dist']);

// The direct competitor, and the org slug that identifies their codebase just
// as surely as the name does.
const competitorTokens = ['theninjarpg', 'studie-tech'];

// The TCG whose format/set/card names Chronicle Showdown was scrubbed of.
// Generic mechanics words ("Monster", "Deck", "Graveyard") are deliberately NOT
// listed — the 2026-07-23 ruling kept them; only real names are off-limits.
const tcgTokens = ['yu-gi-oh', 'yugioh', 'duel monsters', 'exodia', 'time wizard', 'goat format'];

// Borrowed franchise names. These keep coming back through test fixtures and
// generated handoff docs, which is exactly what this gate is for.
const franchiseTokens = ['naruto', 'sasuke', 'chidori', 'konoha', 'hokage', 'sharingan', 'rasengan'];

const bannedTokens = [...competitorTokens, ...tcgTokens, ...franchiseTokens];
const bannedPattern = new RegExp(bannedTokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');

// Lowercase `tnr-` / `tnr_` CSS classes and identifiers. Word-bounded so it
// cannot fire on ordinary words that merely contain the letters.
const competitorSlugPattern = /\btnr[-_]/gi;

// Files where the word IS the guard, not a reference. Scrubbing these removes
// protection: the moderation blocklist stops players impersonating village
// leadership, and the trailer prompts name the franchise as a NEGATIVE
// constraint so the image model refuses to draw it.
const allowedFiles = new Set([
    'api/_text-moderation.ts',
    'api/_text-moderation.ip-terms.test.ts',
    'api/_text-moderation-titles.test.ts',
    'scripts/ip-hygiene.test.mjs',
]);
const allowedPrefixes = ['tools/trailer/'];

function sourceFiles(directory) {
    const files = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (skipDirectories.has(entry.name)) continue;
            files.push(...sourceFiles(join(directory, entry.name)));
        } else if (textExtensions.has(extname(entry.name))) {
            files.push(join(directory, entry.name));
        }
    }
    return files;
}

function repoPath(file) {
    return relative(root, file).split('\\').join('/');
}

function isAllowed(path) {
    return allowedFiles.has(path) || allowedPrefixes.some((prefix) => path.startsWith(prefix));
}

function lineOf(source, offset) {
    return source.slice(0, offset).split('\n').length;
}

function findBanned(source) {
    const found = [];
    for (const pattern of [bannedPattern, competitorSlugPattern]) {
        pattern.lastIndex = 0;
        let match = pattern.exec(source);
        while (match !== null) {
            found.push({ token: match[0], offset: match.index });
            match = pattern.exec(source);
        }
    }
    return found;
}

describe('brand and IP hygiene', () => {
    it('detects every guarded token', () => {
        for (const token of [...bannedTokens, 'tnr-hud']) {
            assert.equal(findBanned(`before ${token} after`).length > 0, true, `${token} should be detected`);
        }
    });

    it('does not fire on ordinary words that merely contain a token', () => {
        assert.deepEqual(findBanned('the winter tundra held; contnr is not a slug'), []);
    });

    it('keeps the allowlist honest', () => {
        for (const path of allowedFiles) {
            if (path === 'scripts/ip-hygiene.test.mjs') continue;
            const source = readFileSync(join(root, path), 'utf8');
            assert.equal(
                findBanned(source).length > 0,
                true,
                `${path} is allowlisted but contains no guarded token — drop it from the allowlist`,
            );
        }
    });

    it('contains no competitor or borrowed-franchise names in source', () => {
        const failures = [];
        for (const sourceRoot of sourceRoots) {
            for (const file of sourceFiles(join(root, sourceRoot))) {
                const path = repoPath(file);
                if (isAllowed(path)) continue;
                const source = readFileSync(file, 'utf8');
                for (const { token, offset } of findBanned(source)) {
                    failures.push(`${path}:${lineOf(source, offset)} (${token})`);
                }
            }
        }
        assert.deepEqual(
            failures,
            [],
            `competitor or borrowed-franchise names found in source:\n${failures.join('\n')}\n\n` +
                'If the word is genuinely a guard (a moderation blocklist, or a negative\n' +
                'constraint in an art prompt), add the file to allowedFiles above with a\n' +
                'comment saying why. Otherwise rename it.',
        );
    });
});
