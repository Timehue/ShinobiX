import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sanitizeUserText, hasNameProfanity, isCleanPlayerName, isCleanText, TEXT_LIMITS } from './_text-moderation.js';

describe('sanitizeUserText', () => {
    it('returns empty string for non-strings', () => {
        assert.equal(sanitizeUserText(null, 10), '');
        assert.equal(sanitizeUserText(undefined, 10), '');
        assert.equal(sanitizeUserText(42 as unknown, 10), '');
    });

    it('preserves a clean string', () => {
        assert.equal(sanitizeUserText('hello world', 100), 'hello world');
    });

    it('caps length at maxLen', () => {
        const long = 'x'.repeat(500);
        assert.equal(sanitizeUserText(long, 50).length, 50);
    });

    it('redacts email addresses', () => {
        const out = sanitizeUserText('contact me at foo@bar.com please', 200);
        assert.ok(out.includes('[redacted email]'));
        assert.ok(!out.includes('foo@bar.com'));
    });

    it('redacts URLs', () => {
        const out = sanitizeUserText('check https://evil.example/foo', 200);
        assert.ok(out.includes('[redacted link]'));
        assert.ok(!out.includes('evil.example'));
    });

    it('redacts phone numbers', () => {
        const out = sanitizeUserText('call me at +1 555-123-4567', 200);
        assert.ok(out.includes('[redacted #]'));
    });

    it('masks profanity with asterisks', () => {
        const out = sanitizeUserText('you are a whore', 200);
        assert.ok(out.includes('*'), `expected mask in ${out}`);
        assert.ok(!out.toLowerCase().includes('whore'));
    });

    it('does NOT mask grey-area swears like ass in assassin', () => {
        const out = sanitizeUserText('I am an assassin', 200);
        assert.equal(out, 'I am an assassin');
    });

    it('catches leetspeak bypass attempts', () => {
        // "n!gger" with ! → i normalizes to "nigger" → blocked.
        assert.equal(isCleanText('n!gger'), false);
        assert.equal(isCleanText('n1gger'), false);
        assert.equal(isCleanText('n|gger'), false);
    });

    it('catches whitespace-separation bypass', () => {
        assert.equal(isCleanText('n i g g e r'), false);
        assert.equal(isCleanText('n-i-g-g-e-r'), false);
    });

    it('catches repeat-char bypass', () => {
        // niiigger → collapse repeats → nigger → blocked.
        assert.equal(isCleanText('niiigger'), false);
    });

    it('passes innocent strings', () => {
        assert.equal(isCleanText('Hidden Leaf Village'), true);
        assert.equal(isCleanText('Crimson Dragons'), true);
        assert.equal(isCleanText('Title with numbers 123'), true);
    });

    // The compact pass used to join the WHOLE line, so letters from adjacent
    // ordinary words formed a blocked term and every chat refused the line.
    it('does not join letters across ordinary words into a blocked term', () => {
        for (const line of [
            'looking for a pet for my team', "let's pick a team", 'that is suspicious',
            'who really won that?', 'such ink on that scroll', 'candy kept me going',
            'my therapist says relax', 'torpedo the plan', 'a grape for the road',
            'I am ok, are we go?', 'is it ok to go now',
        ]) {
            assert.equal(isCleanText(line), true, `"${line}" must pass`);
        }
    });

    it('still catches a blocked term spelled as short tokens or joined by punctuation', () => {
        for (const line of [
            'you are a n i g g e r lol', 'go n.i.g.g.e.r now', 'such a wh or e', 'ra pe jokes',
            'n_i_g_g_e_r', 'k-i-k-e',
        ]) {
            assert.equal(isCleanText(line), false, `"${line}" must be refused`);
        }
    });

    it('rejects blocked terms embedded in normalized player names without blocking normal fantasy names', () => {
        assert.equal(isCleanPlayerName('n1gger-ninja'), false);
        assert.equal(isCleanPlayerName('Hidden Leaf'), true);
        assert.equal(isCleanPlayerName('SkyStorm'), true);
    });

    it('lets ordinary names that merely contain a blocked substring through, but not the term beside them', () => {
        for (const name of [
            'Grape', 'Scrape', 'Draper', 'Therapist', 'Torpedo', 'Spice', 'Spicy', 'Spicer',
            'Nigeria', 'Scunthorpe', 'Kikelomo', 'Vandyke', 'Nazir', 'Dickens', 'Riddick',
        ]) {
            assert.equal(isCleanPlayerName(name), true, `"${name}" must remain usable`);
        }
        for (const name of ['GrapeRapist', 'Therapist Whore', 'SpiceSpic', 'NaziNazir', 'DickensDick']) {
            assert.equal(isCleanPlayerName(name), false, `"${name}" must be refused`);
        }
    });
});

// Owner ruling 2026-10-15: no bad names like "fuck" and "shit".
describe('player-name profanity', () => {
    it('refuses swears and crude words, including the usual evasions', () => {
        for (const name of [
            'fuck', 'Shit', 'xXfuckXx', 'f u c k', 'f.u.c.k', 'sh1t', 'SHIIIT', 'fvck',
            'Phuck You', 'b1tch', 'Asshole', 'BigDick', 'Shitlord', 'MotherFucker',
            'pu$$y', 'Bastard', 'n4zi', 'Hitler', 'YamashitaShit', 'Shit Yamashita',
        ]) {
            assert.equal(isCleanPlayerName(name), false, `"${name}" must be refused`);
        }
    });

    it('does not catch ordinary fantasy names that merely contain the letters', () => {
        for (const name of [
            'Assassin', 'Peacock', 'Arsenal', 'Canal', 'Scrap', 'Classic', 'Titan',
            'Bass', 'Shiro', 'Mishima', 'Pistol', 'Sussex', 'Cassandra', 'Analise',
            'Hidden Leaf', 'Stormveil', 'Kunoichi', 'Eastwatch', 'The last watch',
            'Yamashita', 'Kinoshita', 'Thorny Vale', 'Swanky', 'Bob',
        ]) {
            assert.equal(isCleanPlayerName(name), true, `"${name}" must remain usable`);
        }
    });

    it('chat is unaffected: swears are not masked in conversation', () => {
        assert.equal(sanitizeUserText('oh shit that was close', TEXT_LIMITS.chatMessage), 'oh shit that was close');
    });

    // The load-bearing check: a swear on the list must never make one of the
    // game's OWN pet, jutsu, item, village or NPC names unusable.
    it('no shipped game content name is refused', () => {
        const roots = ['shinobij.client/src/data', 'shinobij.client/src/constants', 'api', 'shared']
            .map((dir) => join(process.cwd(), dir));
        const nameRe = /\b(?:name|title):\s*["'`]([^"'`]{2,32})["'`]/g;
        const refused: string[] = [];
        let checked = 0;
        const walk = (dir: string) => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                if (entry.name === 'node_modules' || entry.name === 'dist') continue;
                const full = join(dir, entry.name);
                if (entry.isDirectory()) { walk(full); continue; }
                if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
                const src = readFileSync(full, 'utf8');
                nameRe.lastIndex = 0;
                let m: RegExpExecArray | null;
                while ((m = nameRe.exec(src)) !== null) {
                    checked++;
                    if (hasNameProfanity(m[1]!)) refused.push(`${entry.name}: "${m[1]}"`);
                }
            }
        };
        roots.forEach(walk);
        assert.ok(checked > 500, `expected to scan a lot of content names, only saw ${checked}`);
        assert.deepEqual([...new Set(refused)], [], 'shipped content names collide with the name filter');
    });
});

describe('TEXT_LIMITS', () => {
    it('clanName cap is sane', () => {
        // 32 chars covers any realistic clan name; longer would inflate the
        // KV keyspace via clan-<slug>.
        assert.ok(TEXT_LIMITS.clanName >= 16 && TEXT_LIMITS.clanName <= 64);
    });
    it('chatMessage cap is sane', () => {
        assert.ok(TEXT_LIMITS.chatMessage >= 100 && TEXT_LIMITS.chatMessage <= 1000);
    });
});
