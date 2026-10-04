import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { isCleanPlayerName, TEXT_LIMITS } from '../../api/_text-moderation.ts';
import { nameGateAccepts, uniqueNameStamp, uniquePlayerName } from '../e2e-live/helpers/player-names.ts';

// Live specs register throwaway accounts, and registration refuses a name that
// spells a blocked term (see e2e-live/helpers/player-names.ts). These tests
// prove the helper only hands out names the server accepts, and keep a live
// spec from going back to a raw clock stamp.

const clientRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const liveRoot = join(clientRoot, 'e2e-live');

// Fixed starting clocks keep every search below deterministic. The stamps
// from REFUSED_FROM read "mutp3d0…", which collapses to "mutpedo…", a stamp
// the filter refuses today, so the searches for one end at once.
const REFUSED_FROM = parseInt('mutp3d00', 36);
const WINDOW_FROM = 1_786_000_000_000;

const accepted = (name: string) => isCleanPlayerName(name) && name.trim().length <= TEXT_LIMITS.playerName;

/** The first clock reading from REFUSED_FROM whose plain stamp the filter refuses in `name`. */
function firstRefusedClock(name: (stamp: string) => string): number {
    for (let now = REFUSED_FROM; now < REFUSED_FROM + 5_000_000; now++) {
        if (!isCleanPlayerName(name(now.toString(36)))) return now;
    }
    throw new Error('no refused stamp in range; widen the search');
}

test('a clock stamp the filter refuses is re-rolled into a name registration accepts', () => {
    const shapes: Array<(stamp: string) => string> = [
        (stamp) => `defeatd${stamp}`,
        (stamp) => `rankedjourneyalice12${stamp}`,
        (stamp) => `storesqa${stamp}m`,
    ];
    for (const shape of shapes) {
        const now = firstRefusedClock(shape);
        const refused = shape(now.toString(36));
        const name = uniquePlayerName(shape, { now });
        assert.notEqual(name, refused);
        assert.ok(accepted(name), `${name} must pass the server's name gate (re-rolled from ${refused})`);
        assert.ok(nameGateAccepts(name));
    }
});

test('every name over a window of clock readings is accepted and unique', () => {
    const shapes: Record<string, (stamp: string) => readonly string[]> = {
        single: (stamp) => [`defeatd${stamp}`],
        // The defeat spec also registers a healer from the same stamp.
        derived: (stamp) => [`defeatd${stamp}`, `defeatd${stamp}medic`],
        pair: (stamp) => [`clockkage${stamp}`, `clockrival${stamp}`],
        // The onboarding display name keeps a space and the stamp's last seven characters.
        display: (stamp) => [`Journey ${stamp.slice(-7)}`],
    };
    for (const [shape, names] of Object.entries(shapes)) {
        const seen = new Set<string>();
        let rerolled = 0;
        for (let now = WINDOW_FROM; now < WINDOW_FROM + 5_000; now++) {
            const stamp = uniqueNameStamp(names, { now });
            if (stamp !== now.toString(36)) rerolled += 1;
            for (const name of names(stamp)) assert.ok(accepted(name), `${shape}: ${name} must pass the server's name gate`);
            const key = names(stamp).join('|');
            assert.ok(!seen.has(key), `${shape}: ${key} repeated`);
            seen.add(key);
        }
        // The common case keeps today's names: the plain clock stamp.
        assert.ok(rerolled < 10, `${shape}: a re-roll is rare, but ${rerolled} of 5,000 readings needed one`);
    }
});

test('a head is kept in front of the stamp, and the names built from it are all accepted', () => {
    const names = (tag: string) => [`wardheal${tag}`, `wardhurt${tag}`];
    const now = firstRefusedClock((stamp) => `wardhealm${stamp}`);
    const tag = uniqueNameStamp(names, { head: 'm', now });
    assert.match(tag, /^m[0-9a-z]+$/);
    assert.notEqual(tag, `m${now.toString(36)}`);
    for (const name of names(tag)) assert.ok(accepted(name), `${name} must pass the server's name gate`);
});

test('fixed text registration always refuses fails loudly instead of yielding a refused name', () => {
    assert.throws(() => uniquePlayerName((stamp) => `pedometer${stamp}`), /refuses \["pedometer/);
    assert.throws(() => uniquePlayerName((stamp) => `${'x'.repeat(TEXT_LIMITS.playerName)}${stamp}`), /at most 32 characters/);
});

function specFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return specFiles(path);
        return /\.spec\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
    });
}

test('no live spec names an account from a raw clock or random stamp', () => {
    const files = specFiles(liveRoot);
    // A vacuous pass is worse than none: the corpus must include the specs this
    // guard was written for.
    for (const name of ['first-defeat-recovery-express.spec.ts', 'kage-challenge-express.spec.ts']) {
        assert.ok(files.some((file) => file.endsWith(name)), `the scan must include e2e-live/${name}`);
    }
    const offenders = files.flatMap((file) => readFileSync(file, 'utf8').split('\n').flatMap((line, index) => (
        /\b(?:Date\.now|Math\.random)\(\)\.toString\(36\)/.test(line) ? [`${relative(clientRoot, file)}:${index + 1}`] : []
    )));
    assert.deepEqual(
        offenders,
        [],
        'Registration refuses a stamp that spells a blocked term. Name live accounts with uniquePlayerName or '
        + 'uniqueNameStamp from e2e-live/helpers/player-names.ts.',
    );
});
