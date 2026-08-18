import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { definitionsFor } from './_state-ownership.js';
import { trainingBonusPct } from '../training/_session.js';

/*
 * `clanUpgradeLevels` / `clanDoctrine` are a MIRROR of the canonical clan
 * record that rides on the character. They had no ownership-manifest entry, so
 * the save sanitizer neither copied nor clamped them — while four server paths
 * read them as trusted inputs. The worst is trainingBonusPct, which is sealed
 * into the training grant: a forged mirror was a permanent progression mint.
 *
 * These pin BOTH halves: the fields are classified, and the sanitizer defers to
 * the clan record rather than the client.
 */

describe('clan mirror fields are server-authoritative', () => {
    it('both fields are classified in the ownership manifest', () => {
        for (const field of ['clanUpgradeLevels', 'clanDoctrine']) {
            const defs = definitionsFor(field).filter((d) => d.scope === 'character');
            assert.equal(defs.length, 1, `${field} must have exactly one character-scope entry`);
            assert.equal(defs[0].domain, 'clan');
            assert.equal(defs[0].category, 'server-clamped');
        }
    });

    it('the sanitizer takes the CANONICAL clan record as the arbiter, not the client', () => {
        const save = readFileSync(join(process.cwd(), 'api', 'save', '[name].ts'), 'utf8');
        const block = save.slice(save.indexOf('Clan upgrade snapshot + doctrine'));
        // Unchanged mirror → re-assert stored (and no extra KV read).
        assert.match(block, /out\.clanUpgradeLevels = exChar\.clanUpgradeLevels/);
        // Changed mirror → the clan record decides.
        assert.match(block, /kv\.get<MinimalClanRec>\(`save:\$\{clanRecordSlug\(finalClan\)\}`\)/);
        assert.match(block, /out\.clanUpgradeLevels = rec\.upgrades/);
        // No clan → the mirror cannot linger and keep paying bonuses.
        assert.match(block, /delete out\.clanUpgradeLevels/);
        assert.match(block, /delete out\.clanDoctrine/);
    });

    it('the mirror is only re-fetched when it actually changes', () => {
        // Autosaves are frequent; a KV read on every one would be real cost.
        const save = readFileSync(join(process.cwd(), 'api', 'save', '[name].ts'), 'utf8');
        const block = save.slice(save.indexOf('Clan upgrade snapshot + doctrine'));
        assert.match(block, /const sameUpgrades = JSON\.stringify/);
        assert.match(block, /if \(sameUpgrades && sameDoctrine\)/);
    });
});

describe('what the forged mirror was worth — the mint this closes', () => {
    it('a forged clan snapshot would have inflated the SEALED training rate', () => {
        const honest = trainingBonusPct({ clan: 'Real Clan' });
        const forged = trainingBonusPct({
            clan: 'Real Clan',
            clanUpgradeLevels: { trainingGrounds: 50 },
            clanDoctrine: 'scholars',
        });
        assert.equal(honest, 0);
        assert.equal(forged, 15, 'clan Training Grounds 10% + Scholars doctrine 5%');
        // 15 percentage points of permanent stat-gain rate, for free — which is
        // why these fields have to come from the clan record.
        assert.ok(forged > honest);
    });

    it('the bonus is inert without a clan, so leaving cannot keep paying it', () => {
        assert.equal(trainingBonusPct({ clanUpgradeLevels: { trainingGrounds: 50 }, clanDoctrine: 'scholars' }), 0);
    });
});
