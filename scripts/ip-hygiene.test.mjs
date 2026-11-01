import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
const textExtensions = new Set(['.ts', '.tsx', '.mjs', '.cjs', '.json', '.md', '.css', '.html', '.txt']);
const skipDirectories = new Set(['node_modules', 'dist']);

// Competitor names and identifiers are stored only as SHA-256 hashes, so this
// file cannot be decoded back into them. Each word in a file, and each pair of
// neighbouring words joined together, is lowercased and hashed, which also
// catches the spaced, hyphenated and underscored spellings of a name. To add
// one, hash its lowercase letters and digits with the separators removed.
const hashWord = (word) => createHash('sha256').update(word).digest('hex');
const competitorHashes = new Set([
    '6458957a3cb92470bd01d08b9f90a2ff6e7f0f04cd75a25403a04a7e76f28e0f',
    'aecb65fc665de53bf70c9af74f4d5a59798ac29bb173597404a5b0346fe6dc04',
    '88c460a41a4dc9e88c2675fc08de828b06b83a20b76074fb52c91b3d983abd33',
    'fb661b2987b2b7d7817d90b61cfb3d4b5e236d150385eaafb162df943f98d571',
    '43e2db62ff6e7a348bb8894301e6bc38b2b1cb71981081e0a1306d3b28d75d47',
    'd5be3e3851cda46ba5d8ff94f275e3bb2db1700ba52c6771173a4f2329225df9',
    '41c82f757bf311cb6ce019bd382df71d2e9a86736e0e6a6cc5634aeb79572ad6',
]);

// Stand-in descriptions that point at the same games without naming them.
const competitorPhraseTokens = ['genre leader', 'sibling shinobi', 'rival shinobi browser'];

// The TCG whose format/set/card names Chronicle Showdown was scrubbed of.
// Generic mechanics words ("Monster", "Deck", "Graveyard") are deliberately NOT
// listed — the 2026-07-23 ruling kept them; only real names are off-limits.
const tcgTokens = ['yu-gi-oh', 'yugioh', 'duel monsters', 'exodia', 'time wizard', 'goat format'];

// Borrowed franchise names. These keep coming back through test fixtures and
// generated handoff docs, which is exactly what this gate is for.
// 'sakura' is deliberately excluded: it is also a legitimate generic cosmetic
// id (the cherry-blossom Nindo banner preset in nindo-backgrounds.ts and its
// server allowlist), so word-level banning it would fail on real content. The
// 2026-09-19 sweep instead renamed the specific test fixtures that used it as
// a character name.
const franchiseTokens = [
    'naruto', 'sasuke', 'chidori', 'konoha', 'hokage', 'sharingan', 'rasengan',
    'kakashi', 'obito', 'minato', 'hinata', 'tsunade',
    // Clan and character names that slipped into war-reward fixtures as
    // player surnames before the 2026-10-15 cleanup.
    'uchiha', 'itachi', 'orochimaru', 'jiraiya', 'boruto', 'byakugan',
];

const bannedTokens = [...competitorPhraseTokens, ...tcgTokens, ...franchiseTokens];
// Word-bounded: unbounded 'minato' also matches inside ordinary words like
// "terminator" and "denominator" (findBanned's own "contnr" test below checks
// the same principle for the slug pattern).
const bannedPattern = new RegExp(
    bannedTokens.map((token) => `\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).join('|'),
    'gi',
);

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

const hashedWordCaches = new WeakMap();

function findHashed(source, hashes) {
    const found = [];
    if (!hashedWordCaches.has(hashes)) hashedWordCaches.set(hashes, new Map());
    const cache = hashedWordCaches.get(hashes);
    const isBanned = (word) => {
        if (!cache.has(word)) cache.set(word, hashes.has(hashWord(word)));
        return cache.get(word);
    };
    let previous = null;
    for (const match of source.matchAll(/[a-z0-9]+/gi)) {
        const word = match[0].toLowerCase();
        const adjacent = previous !== null && match.index - previous.end === 1
            && /[ _-]/.test(source[previous.end]);
        if (isBanned(word)) {
            found.push({ token: match[0], offset: match.index });
        } else if (adjacent && isBanned(previous.word + word)) {
            found.push({ token: source.slice(previous.start, match.index + match[0].length), offset: previous.start });
        }
        previous = { word, start: match.index, end: match.index + match[0].length };
    }
    return found;
}

function findBanned(source, hashes = competitorHashes) {
    const found = findHashed(source, hashes);
    bannedPattern.lastIndex = 0;
    let match = bannedPattern.exec(source);
    while (match !== null) {
        found.push({ token: match[0], offset: match.index });
        match = bannedPattern.exec(source);
    }
    return found;
}

describe('brand and IP hygiene', () => {
    it('detects every guarded token', () => {
        for (const token of bannedTokens) {
            assert.equal(findBanned(`before ${token} after`).length > 0, true, `${token} should be detected`);
        }
    });

    it('detects hashed names in every spelling', () => {
        const hashes = new Set([hashWord('canaryname')]);
        for (const spelling of ['CanaryName', 'canary name', 'Canary-Name', 'canary_name']) {
            assert.equal(findBanned(`before ${spelling} after`, hashes).length, 1, `${spelling} should be detected`);
        }
        assert.deepEqual(findBanned('canary. name', hashes), []);
    });

    it('stores competitor names as hashes only', () => {
        for (const hash of competitorHashes) assert.match(hash, /^[0-9a-f]{64}$/);
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
