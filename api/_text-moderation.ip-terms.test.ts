import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
    RESERVED_IP_TERMS,
    hasReservedIpTerm,
    isAllowedCustomTitle,
    isCleanPlayerName,
    sanitizeUserText,
    TEXT_LIMITS,
} from './_text-moderation.js';

test('every reserved IP term is actually refused as an identity', () => {
    for (const term of RESERVED_IP_TERMS) {
        assert.equal(hasReservedIpTerm(term), true, `"${term}" should be reserved`);
        assert.equal(isCleanPlayerName(term), false, `"${term}" should be refused as a player name`);
    }
});

test('evasion shapes are caught the same way slurs are', () => {
    // The shared normalizer folds leetspeak, homoglyphs, spacing and repeats.
    for (const attempt of [
        'XxNarutoxX', 'P0kem0n', 'p o k e m o n', 'Pokémon', 'PoKeMoN',
        'temtem_fan', 'Naruuuto', 'sh4ringan', 'Ｐokemon',
    ]) {
        assert.equal(isCleanPlayerName(attempt), false, `"${attempt}" should be refused`);
    }
});

test('IP terms are NOT censored in ordinary conversation', () => {
    // The whole reason these live outside BLOCKLIST: masking them would turn
    // normal chat into asterisks and teach players the filter is broken.
    const line = 'this battle system reminds me of pokemon and temtem';
    assert.equal(sanitizeUserText(line, TEXT_LIMITS.chatMessage), line);
});

test('custom titles reject third-party IP', () => {
    assert.equal(isAllowedCustomTitle('Pokemon Master'), false);
    assert.equal(isAllowedCustomTitle('Sharingan Bearer'), false);
    // ...while ordinary earned-sounding titles still pass.
    assert.equal(isAllowedCustomTitle('Gate Opener'), true);
    assert.equal(isAllowedCustomTitle('Storm Blade'), true);
});

test('real-language words a shinobi setting legitimately uses are NOT reserved', () => {
    // Deliberately excluded from the list: these belong to the genre, not to a
    // franchise. Blocking them would refuse reasonable player choices.
    for (const name of ['Sakura', 'Konoha Leafblade', 'Kitsune', 'Shinobi', 'Kunai', 'Sensei', 'Ronin', 'Samurai']) {
        assert.equal(hasReservedIpTerm(name), false, `"${name}" must remain usable`);
    }
});

test('ordinary fantasy names are unaffected', () => {
    for (const name of [
        'Tempest', 'Temperance', 'Item Hunter', 'Systematic', 'Stormveil',
        'Pokey', 'Monk', 'Demonseeker', 'Naru', 'Ruto', 'Digit', 'Monolith',
        'Bleachbone', 'Magicthe', 'Duelist', 'Nexus', 'Corvus', 'Palisade',
    ]) {
        assert.equal(hasReservedIpTerm(name), false, `"${name}" must not be caught`);
        assert.equal(isCleanPlayerName(name), true, `"${name}" must be a valid player name`);
    }
});

/*
 * The load-bearing check: the game's OWN shipped content must never trip the
 * filter. A false positive here would mean a pet, jutsu, item, village or NPC
 * whose name the game itself uses is unusable by players — the exact way an
 * over-eager blocklist causes damage.
 */
test('no shipped game content name collides with a reserved IP term', () => {
    const roots = [
        join(process.cwd(), 'shinobij.client', 'src', 'data'),
        join(process.cwd(), 'shinobij.client', 'src', 'constants'),
        join(process.cwd(), 'api'),
        join(process.cwd(), 'shared'),
    ];
    const nameRe = /\bname:\s*["'`]([^"'`]{2,60})["'`]/g;
    const titleRe = /\btitle:\s*["'`]([^"'`]{2,60})["'`]/g;

    const collisions: string[] = [];
    let checked = 0;
    const walk = (dir: string) => {
        let entries: string[] = [];
        try { entries = readdirSync(dir); } catch { return; }
        for (const entry of entries) {
            const full = join(dir, entry);
            if (entry === 'node_modules' || entry === 'dist') continue;
            if (!/\.[a-z]+$/.test(entry)) { walk(full); continue; }
            if (!/\.(ts|tsx)$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
            const src = readFileSync(full, 'utf8');
            for (const re of [nameRe, titleRe]) {
                re.lastIndex = 0;
                let m: RegExpExecArray | null;
                while ((m = re.exec(src)) !== null) {
                    checked++;
                    if (hasReservedIpTerm(m[1]!)) collisions.push(`${entry}: "${m[1]}"`);
                }
            }
        }
    };
    roots.forEach(walk);

    assert.ok(checked > 500, `expected to scan a lot of content names, only saw ${checked}`);
    assert.deepEqual([...new Set(collisions)], [], 'shipped content collides with the IP blocklist');
});
