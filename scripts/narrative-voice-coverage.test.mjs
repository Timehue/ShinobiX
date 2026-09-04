import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';

// Narrative voice, for the corpora `story-tone-and-staging.test.ts` does not name.
//
// That gate is thorough, but a gate only covers the corpus it imports. A
// 2026-09-03 audit found these modules carry real player-facing prose while no
// voice gate ever read them: item and event descriptions, the pet tutorial, the
// Chronicle card catalogue and its lore, store signposts, and the logbook. They
// were clean when this was written. This keeps them that way.
//
// Scope note: the zero-dash rule and the raw-game-term rule are deliberately
// NOT applied here. Both are scoped by the tone gate to visual-novel and
// story/event copy respectively, and these corpora are neither — "Level 4 or
// lower Monster" is correct card rules text, and an en dash in "1-5 Honor
// Seals" is correct typography.

const root = resolve(import.meta.dirname, '..');

const corpora = [
    // PENDING: when Celestial Tower: The First Pact lands, add its three prose
    // corpora here — 'shinobij.client/src/screens/FirstPact.tsx',
    // 'shared/first-pact-contract.ts' and
    // 'shinobij.client/src/lib/first-pact-api.ts'. Its own narrative test
    // checks lore anchors and the dash rule but never the shinobi-world
    // vocabulary rules below, so it needs this gate the same as the rest.
    // They are not listed yet because a named corpus that does not exist fails
    // this file, and that campaign is a separate pull request.
    'shared/legacy-card-sources.ts',
    'shared/chronicle-duel.ts',
    'shinobij.client/src/data/starter-items.ts',
    'shinobij.client/src/data/starter-pets.ts',
    'shinobij.client/src/data/event-items.ts',
    'shinobij.client/src/data/professions.ts',
    'shinobij.client/src/data/pet-pool.ts',
    'shinobij.client/src/data/pet-config.ts',
    'shinobij.client/src/lib/pet-tutorial.ts',
    'shinobij.client/src/lib/journey-guide.ts',
    'shinobij.client/src/lib/offline-notices.ts',
    'shinobij.client/src/lib/village-stores.ts',
    'shinobij.client/src/lib/village-stores-signposts.ts',
    'shinobij.client/src/lib/clan-stores.ts',
    'shinobij.client/src/lib/logbook-objectives.ts',
    'shinobij.client/src/lib/daily-briefing-core.ts',
    'shinobij.client/src/lib/spire-catalog.ts',
    'shinobij.client/src/lib/profession-mastery.ts',
];

// Mirrors the vocabulary rules in shinobij.client/src/data/story-tone-and-staging.test.ts.
const voiceRules = [
    ['generic fantasy vocabulary', /\b(?:wizard|paladin|cleric|sorcerer|adventurer|quest giver)s?\b/i],
    ['pilgrim terminology', /\bpilgrims?\b/i],
    [
        'stock AI mysticism',
        /\b(?:something stirs|strange energy|ancient energy|true potential|last sanctuary|fate-bound|fortune favors|a new path opens before you|the world is holding its breath|only the strongest hunters survive|base reward)\b/i,
    ],
    ['retired village labels', /\bThe (?:Chaotic|Traditional|Loyal|Selfish) Path\b|lawless proving ground/i],
    ['out-of-world terms', /\b(?:whole servers?|world queues?|card game)\b/i],
];

// Quoted strings long enough to be sentences rather than ids, keys or classes.
//
// The backtick class MUST exclude newlines like the other two. Without it a
// template literal swallows every line between two backticks and consumes the
// real dialogue inside that span, so a file reads as "covered" while its copy
// is never actually scanned: FirstPact.tsx yielded 22 fragments of code that
// way, against 81 genuine lines once the newline is excluded.
const quoted = /"([^"\n]{20,})"|'([^'\n]{20,})'|`([^`\n]{20,})`/g;
const codeish = /\$\{|=>|::|https?:\/\/|\.(?:png|webp|css|tsx?)\b/;

function playerFacingStrings(source) {
    const found = [];
    quoted.lastIndex = 0;
    let match = quoted.exec(source);
    while (match !== null) {
        const text = match[1] ?? match[2] ?? match[3] ?? '';
        const words = text.split(' ').length - 1;
        if (words >= 4 && /[a-z] [a-z]/.test(text) && !codeish.test(text)) {
            found.push({ text, line: source.slice(0, match.index).split('\n').length });
        }
        match = quoted.exec(source);
    }
    return found;
}

describe('narrative voice outside the story tone gate', () => {
    it('still finds prose in every listed corpus', () => {
        for (const file of corpora) {
            const count = playerFacingStrings(readFileSync(join(root, file), 'utf8')).length;
            assert.equal(count > 0, true, `${file} yielded no player-facing prose — has it moved or been renamed?`);
        }
    });

    it('detects every guarded phrase', () => {
        const samples = [
            'a wandering wizard waits by the gate',
            'the pilgrims gather at dawn',
            'something stirs beneath the floor',
            'The Chaotic Path suits you',
            'queue across whole servers tonight',
        ];
        samples.forEach((sample, index) => {
            assert.equal(voiceRules[index][1].test(sample), true, `${voiceRules[index][0]} should match its sample`);
        });
    });

    it('uses shinobi-world language in every uncovered corpus', () => {
        const failures = [];
        for (const file of corpora) {
            const source = readFileSync(join(root, file), 'utf8');
            for (const { text, line } of playerFacingStrings(source)) {
                for (const [label, pattern] of voiceRules) {
                    const match = text.match(pattern);
                    if (match) failures.push(`${file}:${line} (${label}: "${match[0]}") ${text.slice(0, 90)}`);
                }
            }
        }
        assert.deepEqual(failures, [], `off-voice copy found:\n${failures.join('\n')}`);
    });
});
