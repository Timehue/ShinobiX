import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    GARRISON_POINTS_CAP,
    GARRISON_POINTS_CAP_FED,
    NO_WAR_MAP_ERROR,
    WAR_RATIONS_PER_DAY,
    busyLabel,
    declareEstimateNote,
    depotConversionNote,
    garrisonFedCapLine,
    garrisonFeedStatusLine,
    provisionsMeaningLine,
    resolvedStructureLevel,
    structureUpgradeNotice,
    warMapErrorAfterAction,
    warMapErrorAfterRefresh,
    wrAffordability,
} from './village-war-map-ui';

describe('structure upgrade copy', () => {
    it('never renders a "?" level — it falls back to the known level + 1', () => {
        assert.equal(resolvedStructureLevel(7, 6), 7);
        assert.equal(resolvedStructureLevel(undefined, 6), 7);
        assert.equal(resolvedStructureLevel(null, 0), 1);
        assert.equal(resolvedStructureLevel('nonsense', 3), 4);
        assert.equal(resolvedStructureLevel(0, 2), 3, 'a zero level is not a level');
        assert.equal(resolvedStructureLevel(NaN, -5), 1, 'a nonsense current level still yields L1');
    });

    it('phrases the confirmation without a machine "?" and in canonical terminology', () => {
        const plain = structureUpgradeNotice({ name: 'Barracks', reportedLevel: 4, knownCurrentLevel: 3 });
        assert.equal(plain, 'Barracks raised to L4.');

        const withMaterials = structureUpgradeNotice({
            name: 'Supply Depot', reportedLevel: undefined, knownCurrentLevel: 5,
            materialsSpent: 400, remainingMaterials: 1250,
        });
        assert.equal(withMaterials, 'Supply Depot raised to L6 — 400 materials spent (1,250 left).');
        assert.doesNotMatch(withMaterials, /\?/);
        assert.doesNotMatch(withMaterials, /material points|craft points|\bpts\b|supplies/i);
    });
});

describe('War Resources affordability', () => {
    it('renders "Need {cost} WR" when the pool is short, matching the merc-tier pattern', () => {
        assert.deepEqual(wrAffordability(250, 100, { verb: 'Declare War', estimate: true }), { affordable: false, label: 'Need 250 WR' });
        assert.deepEqual(wrAffordability(90, 40, { verb: 'Hire' }), { affordable: false, label: 'Need 90 WR' });
    });

    it('keeps the "~" only on the estimated declare label, never on the shortfall label', () => {
        assert.deepEqual(wrAffordability(250, 250, { verb: 'Declare War', estimate: true }), { affordable: true, label: 'Declare War · ~250 WR' });
        assert.deepEqual(wrAffordability(90, 900, { verb: 'Hire' }), { affordable: true, label: 'Hire · 90 WR' });
        assert.doesNotMatch(wrAffordability(250, 0, { verb: 'Declare War', estimate: true }).label, /~/);
    });

    it('treats an exactly-affordable pool as affordable and junk input as zero', () => {
        assert.equal(wrAffordability(175, 175, { verb: 'Declare War' }).affordable, true);
        assert.equal(wrAffordability(Number.NaN, 0, { verb: 'Declare War' }).affordable, true);
        assert.equal(wrAffordability(10, Number.NaN, { verb: 'Declare War' }).affordable, false);
    });

    it('explains the "~" in visible prose rather than a tooltip', () => {
        const note = declareEstimateNote('Mapped');
        assert.match(note, /^~ estimate/);
        assert.match(note, /Mapped/);
        assert.match(note, /comeback discount/i);
        assert.match(note, /server charges the exact amount/i);
        assert.ok(note.length < 160, 'the note has to fit a 360px sector card');
    });
});

describe('garrison-feed copy', () => {
    it('says who is feeding what, not "on"/"off"', () => {
        assert.equal(garrisonFeedStatusLine({ feeding: true, sector: 12 }), 'Your Kage is feeding the Sector 12 garrison.');
        assert.equal(garrisonFeedStatusLine({ feeding: false, sector: 12 }), 'Nobody is feeding this garrison — your Kage or ANBU can.');
        for (const feeding of [true, false]) {
            assert.doesNotMatch(garrisonFeedStatusLine({ feeding, sector: 3 }), /feed: (on|off)/i);
        }
    });

    it('spells out what "cap 200" buys, in points', () => {
        assert.equal(
            garrisonFedCapLine('Moonshadow Village', true),
            `Fed by Moonshadow Village — the garrison holds ${GARRISON_POINTS_CAP_FED} points instead of ${GARRISON_POINTS_CAP}.`,
        );
        const pending = garrisonFedCapLine('Frostfang Village', false);
        assert.match(pending, /supply run/);
        assert.match(pending, new RegExp(`${GARRISON_POINTS_CAP_FED} points instead of ${GARRISON_POINTS_CAP}`));
        assert.doesNotMatch(pending, /\bcap \d+/i);
    });
});

describe('stores meaning + depot note', () => {
    it('states the Provisions burn rates in the canonical unit', () => {
        const line = provisionsMeaningLine(15);
        assert.match(line, new RegExp(`${WAR_RATIONS_PER_DAY} rations a day per war`));
        assert.match(line, /15 for a fed garrison/);
        assert.doesNotMatch(line, /craft points|material points|\bpts\b|supplies/i);
    });

    it('suppresses the depot conversion note when the cap is zero or missing', () => {
        assert.equal(depotConversionNote(0, 10), '');
        assert.equal(depotConversionNote(undefined, 10), '');
        assert.equal(depotConversionNote(-40, 10), '');
        assert.equal(depotConversionNote(130, 10), '→ up to 130 WR/day at 10 materials each');
    });
});

describe('error stickiness (the poll must not eat a refusal)', () => {
    it('keeps an action error through refreshes until the next action', () => {
        const failed = warMapErrorAfterAction('The treasury is short — 800 Honor Seals needed.');
        assert.equal(failed.sticky, true);
        // Fifteen seconds later the poll succeeds — the refusal stays put.
        assert.deepEqual(warMapErrorAfterRefresh(failed, ''), failed);
        // …and a later load failure does not overwrite it either.
        assert.deepEqual(warMapErrorAfterRefresh(failed, 'HTTP 500'), failed);
    });

    it('clears a LOAD error once the poll recovers', () => {
        const loadFail = warMapErrorAfterRefresh(NO_WAR_MAP_ERROR, 'Failed to fetch');
        assert.deepEqual(loadFail, { text: 'Failed to fetch', sticky: false });
        assert.deepEqual(warMapErrorAfterRefresh(loadFail, ''), NO_WAR_MAP_ERROR);
    });

    it('returns the identical object when nothing changed, so the poll cannot thrash state', () => {
        const loadFail = warMapErrorAfterRefresh(NO_WAR_MAP_ERROR, 'Failed to fetch');
        assert.equal(warMapErrorAfterRefresh(loadFail, 'Failed to fetch'), loadFail);
        assert.equal(warMapErrorAfterRefresh(NO_WAR_MAP_ERROR, ''), NO_WAR_MAP_ERROR);
    });

    it('treats an empty action message as no error at all', () => {
        assert.deepEqual(warMapErrorAfterAction('   '), NO_WAR_MAP_ERROR);
    });
});

describe('per-button in-flight labels', () => {
    it('relabels only the button that was pressed', () => {
        assert.equal(busyLabel('feed-12', 'feed-12', 'Feeding…', 'Feed the garrison'), 'Feeding…');
        assert.equal(busyLabel('feed-12', 'dec-12', 'Declaring…', 'Declare War · ~250 WR'), 'Declare War · ~250 WR');
        assert.equal(busyLabel('', 'feed-12', 'Feeding…', 'Feed the garrison'), 'Feed the garrison');
    });
});
