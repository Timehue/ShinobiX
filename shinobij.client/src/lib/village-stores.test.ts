import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    comebackCostMultiplier,
    expectedDeclareCost,
    formatLedgerRef,
    formatStoresLedgerEntry,
    intelTierFor,
    intelTierLabel,
    isMaterialsRequired,
    materialsShortMessage,
    parseStoresLedger,
    readStores,
    storesCreditNote,
    storesDonatedToday,
    storesDonationBucket,
    storesDonationCapLine,
    storesDonationGate,
    storesLedgerIcon,
    storesLedgerLines,
    storesLedgerRows,
    DAILY_CRAFT_POINT_DONATION_CAP,
    DAILY_RATION_DONATION_CAP,
    structureMaterialsCost,
} from './village-stores';

const NOW = 1_700_000_000_000;
const H = 3_600_000;

test('formatStoresLedgerEntry renders "2h ago · War burn −30 · Sector 12"', () => {
    assert.equal(
        formatStoresLedgerEntry({ at: NOW - 2 * H, kind: 'war', amount: 30, ref: '12:moonshadow-vs-stormveil' }, NOW),
        '2h ago · War burn −30 · Sector 12',
    );
    assert.equal(formatStoresLedgerEntry({ at: NOW - 30_000, kind: 'spoil', amount: 4 }, NOW), 'just now · Spoilage −4');
    assert.equal(formatStoresLedgerEntry({ at: NOW - 5 * 60_000, kind: 'garrison', amount: 15, ref: '7:a-vs-b' }, NOW), '5m ago · Garrison feed −15 · Sector 7');
    assert.equal(formatStoresLedgerEntry({ at: NOW - 26 * H, kind: 'structure', amount: 400, by: 'Rill', ref: 'barracks:6' }, NOW), '1d ago · Structure build −400 materials · Barracks L6 · by Rill');
    assert.equal(formatStoresLedgerEntry({ at: NOW - H, kind: 'convert', amount: 2500, ref: 'wr:250' }, NOW), '1h ago · Depot conversion −2,500 materials · → 250 WR');
    assert.equal(formatStoresLedgerEntry({ at: NOW - H, kind: 'home-loss', amount: 50, ref: 'sector:33' }, NOW), '1h ago · Home sector lost −50 · Sector 33');
    assert.equal(formatStoresLedgerEntry({ at: NOW - H, kind: 'merc', amount: 24, by: 'Kenji', ref: 'ronin' }, NOW), '1h ago · Merc rations −24 · ronin · by Kenji');
    assert.equal(formatStoresLedgerEntry({ at: NOW, kind: 'feed-toggle', amount: 1, by: 'Rill' }, NOW), 'just now · Feed toggled on · by Rill');
});

test('formatLedgerRef humanizes the known ref shapes and passes unknown ones through', () => {
    assert.equal(formatLedgerRef('12:x-vs-y'), 'Sector 12');
    assert.equal(formatLedgerRef('sector:5'), 'Sector 5');
    assert.equal(formatLedgerRef('wr:40'), '→ 40 WR');
    assert.equal(formatLedgerRef('supplyDepot:8'), 'Supply Depot L8');
    assert.equal(formatLedgerRef('ronin'), 'ronin');
    assert.equal(formatLedgerRef(undefined), '');
});

test('parseStoresLedger drops junk and storesLedgerLines shows the last 10 newest-first', () => {
    assert.deepEqual(parseStoresLedger('nope'), []);
    assert.deepEqual(parseStoresLedger([{ kind: 'bogus', amount: 1 }, null, { kind: 'spoil', amount: '3', at: '5' }]), [{ at: 5, kind: 'spoil', amount: 3 }]);
    const raw = Array.from({ length: 12 }, (_, i) => ({ at: NOW - (12 - i) * H, kind: 'war', amount: i + 1, ref: `${i + 1}:a-vs-b` }));
    const lines = storesLedgerLines(raw, NOW);
    assert.equal(lines.length, 10);
    assert.match(lines[0], /War burn −12 · Sector 12/);
    assert.match(lines[9], /War burn −3 · Sector 3/);
});

test('readStores never goes negative or fractional', () => {
    assert.deepEqual(readStores({ provisions: 12.9, materialPoints: -4 }), { provisions: 12, materialPoints: 0 });
    assert.deepEqual(readStores(undefined), { provisions: 0, materialPoints: 0 });
});

test('storesDonationBucket routes rations / hunt materials / relics and nothing else', () => {
    assert.equal(storesDonationBucket('ration-pack'), 'provisions');
    assert.equal(storesDonationBucket('hunt-beast-meat'), 'materialPoints');
    assert.equal(storesDonationBucket('warforged-relic'), 'materialPoints');
    assert.equal(storesDonationBucket('item-smoke-bomb'), null);
});

test('storesCreditNote reports the delta the server credited', () => {
    const before = { provisions: 10, materialPoints: 100 };
    assert.equal(storesCreditNote({ provisions: 15 }, before), '+5 rations');
    assert.equal(storesCreditNote({ materialPoints: 140 }, before), '+40 materials');
    assert.equal(storesCreditNote({ provisions: 15, materialPoints: 1_600 }, before), '+5 rations / +1,500 materials');
    assert.equal(storesCreditNote(undefined, before), '');
    assert.equal(storesCreditNote({ provisions: 10 }, before), '');
});

test('structure materials gate mirrors 400/700/1100/1600/2400 for L6–10 and 0 below', () => {
    assert.equal(structureMaterialsCost(5), 0);
    assert.equal(structureMaterialsCost(6), 400);
    assert.equal(structureMaterialsCost(7), 700);
    assert.equal(structureMaterialsCost(8), 1_100);
    assert.equal(structureMaterialsCost(9), 1_600);
    assert.equal(structureMaterialsCost(10), 2_400);
    assert.equal(structureMaterialsCost(11), 0);
});

test('materials-required 402 body is recognised and phrased', () => {
    assert.equal(isMaterialsRequired({ error: 'materials-required', cost: 800, need: 400, have: 150 }), true);
    assert.equal(isMaterialsRequired({ error: 'insufficient-seals', cost: 800 }), false);
    assert.equal(isMaterialsRequired(null), false);
    assert.equal(materialsShortMessage(400, 150), 'The stores are 250 materials short (150 of 400).');
    assert.equal(materialsShortMessage(2_400, 1_000), 'The stores are 1,400 materials short (1,000 of 2,400).');
});

test('intel tiers: thresholds, labels', () => {
    assert.equal(intelTierFor(0), 'none');
    assert.equal(intelTierFor(99), 'none');
    assert.equal(intelTierFor(100), 'scouted');
    assert.equal(intelTierFor(250), 'mapped');
    assert.equal(intelTierFor(500), 'infiltrated');
    assert.equal(intelTierLabel('none'), 'Unscouted');
    assert.equal(intelTierLabel('scouted', 140), 'Scouted · 140 pts');
    assert.equal(intelTierLabel('scouted'), 'Scouted');
    assert.equal(intelTierLabel('mapped', 300), 'Mapped');
    assert.equal(intelTierLabel('infiltrated', 900), 'Infiltrated');
});

test('expected declare cost = intel base (250/250/175/125) × comeback multiplier', () => {
    assert.equal(comebackCostMultiplier(0), 0);
    assert.equal(comebackCostMultiplier(1), 0.25);
    assert.equal(comebackCostMultiplier(2), 0.5);
    assert.equal(comebackCostMultiplier(3), 0.75);
    assert.equal(comebackCostMultiplier(8), 1);
    assert.equal(expectedDeclareCost('none', 8), 250);
    assert.equal(expectedDeclareCost('scouted', 8), 250);
    assert.equal(expectedDeclareCost('mapped', 8), 175);
    assert.equal(expectedDeclareCost('infiltrated', 8), 125);
    // stacks with the comeback discount exactly like api/_village-intel.test.ts
    assert.equal(expectedDeclareCost('infiltrated', 2), 63);
    assert.equal(expectedDeclareCost('mapped', 2), 88);
    assert.equal(expectedDeclareCost('none', 0), 0);
});

// ── Per-donor daily donation caps ───────────────────────────────────────────
// Donating a CRAFT_POINTS item is capped at 1,500 points/day and rations at
// 40/day, and the endpoint answers a bare 429 past either. The Town Hall must
// show the running total and refuse locally, the way the Cafeteria's cook cap
// already does — a hard daily cap on an existing action is not allowed to be a
// surprise.

const DAY = '2023-11-14'; // the UTC day NOW falls in

test('storesDonatedToday reads the server-mirrored counters and resets on a new UTC day', () => {
    assert.deepEqual(storesDonatedToday({}, NOW), { rations: 0, craftPoints: 0 });
    assert.deepEqual(
        storesDonatedToday({ storesDonatedDate: DAY, rationsDonatedToday: 12, craftPointsDonatedToday: 900 }, NOW),
        { rations: 12, craftPoints: 900 },
    );
    assert.deepEqual(
        storesDonatedToday({ storesDonatedDate: '2023-11-13', rationsDonatedToday: 12, craftPointsDonatedToday: 900 }, NOW),
        { rations: 0, craftPoints: 0 },
        'yesterday does not count against today',
    );
});

test('storesDonationCapLine shows both caps the way the cook cap line does', () => {
    assert.equal(storesDonationCapLine({}, NOW), 'Donated today: 0/40 rations · 0/1,500 materials.');
    assert.equal(
        storesDonationCapLine({ storesDonatedDate: DAY, rationsDonatedToday: 12, craftPointsDonatedToday: 1_450 }, NOW),
        'Donated today: 12/40 rations · 1,450/1,500 materials.',
    );
});

test('storesDonationGate refuses before the request, mirroring the server 429', () => {
    assert.equal(DAILY_RATION_DONATION_CAP, 40);
    assert.equal(DAILY_CRAFT_POINT_DONATION_CAP, 1_500);
    // Unrouted items are not capped at all.
    assert.equal(storesDonationGate({ storesDonatedDate: DAY, rationsDonatedToday: 40 }, 'item-smoke-bomb', 1, NOW).ok, true);
    // Rations, per item.
    assert.equal(storesDonationGate({ storesDonatedDate: DAY, rationsDonatedToday: 39 }, 'ration-pack', 1, NOW).ok, true);
    const cappedRations = storesDonationGate({ storesDonatedDate: DAY, rationsDonatedToday: 40 }, 'ration-pack', 1, NOW);
    assert.equal(cappedRations.ok, false);
    if (!cappedRations.ok) assert.match(cappedRations.reason, /40\/40 rations/);
    // Craft points, at the item's own point value (warforged-relic = 250).
    assert.equal(storesDonationGate({ storesDonatedDate: DAY, craftPointsDonatedToday: 1_250 }, 'warforged-relic', 1, NOW).ok, true);
    const cappedPoints = storesDonationGate({ storesDonatedDate: DAY, craftPointsDonatedToday: 1_251 }, 'warforged-relic', 1, NOW);
    assert.equal(cappedPoints.ok, false);
    if (!cappedPoints.ok) assert.match(cappedPoints.reason, /1,251\/1,500 materials/);
    // A fresh day clears both.
    assert.equal(storesDonationGate({ storesDonatedDate: '2023-11-13', craftPointsDonatedToday: 1_500 }, 'warforged-relic', 1, NOW).ok, true);
});

test('the Town Hall Treasury tab shows the cap line and gates the donate button', async () => {
    const { readFileSync } = await import('node:fs');
    const townHall = readFileSync(new URL('../screens/TownHall.tsx', import.meta.url), 'utf8');
    assert.match(townHall, /const villageDonateCapLine = storesDonationCapLine\(character\)/);
    assert.match(townHall, /const villageDonateGate = storesDonationGate\(character, villageDonateItemId\)/);
    assert.match(townHall, /\{villageDonateCapLine\}/, 'the running total must be rendered');
    assert.match(townHall, /disabled=\{!villageDonateItemId \|\| !villageDonateGate\.ok\}/, 'and the button disabled before the 429');
    assert.match(townHall, /if \(!villageDonateGate\.ok\) return alert/, 'and the handler must refuse locally too');
});

// ── Canonical terminology ─────────────────────────────────────────────
// The two stocks are PROVISIONS (rations) and MATERIALS (materials). "craft
// points", "material points", "pts" and "supplies" are retired spellings, and
// a single survivor re-teaches players a word the rest of the game does not
// use — so the ban is asserted over every string this module can emit.

test('no player-facing string says "craft points", "material points", "pts" or "supplies"', () => {
    const character = { storesDonatedDate: DAY, rationsDonatedToday: 3, craftPointsDonatedToday: 1_499 };
    const gate = storesDonationGate(character, 'warforged-relic', 1, NOW);
    const strings = [
        storesDonationCapLine(character, NOW),
        gate.ok ? '' : gate.reason,
        materialsShortMessage(1_400, 1_150),
        storesCreditNote({ provisions: 5, materialPoints: 40 }, { provisions: 0, materialPoints: 0 }),
        ...storesLedgerLines([
            { at: NOW - H, kind: 'convert', amount: 2_500, ref: 'wr:250' },
            { at: NOW - H, kind: 'structure', amount: 400, ref: 'barracks:6' },
            { at: NOW - H, kind: 'spoil', amount: 4 },
        ], NOW),
    ];
    for (const line of strings) {
        assert.doesNotMatch(line, /craft points|material points|\bpts\b|supplies/i, `retired unit in: ${line}`);
    }
});

test('materialsShortMessage names the shortfall and both figures', () => {
    assert.equal(materialsShortMessage(1_400, 1_150), 'The stores are 250 materials short (1,150 of 1,400).');
    assert.equal(materialsShortMessage(400, 400), 'The stores are 0 materials short (400 of 400).');
    assert.equal(materialsShortMessage(-5, -5), 'The stores are 0 materials short (0 of 0).');
});

test('storesLedgerRows keeps the kind and a glyph so a run of "−" rows is not a wall of errors', () => {
    const rows = storesLedgerRows([
        { at: NOW - 2 * H, kind: 'war', amount: 30, ref: '12:a-vs-b' },
        { at: NOW - H, kind: 'convert', amount: 2_500, ref: 'wr:250' },
    ], NOW);
    assert.equal(rows.length, 2);
    // newest first, same order storesLedgerLines uses
    assert.equal(rows[0].kind, 'convert');
    assert.equal(rows[0].text, '1h ago · Depot conversion −2,500 materials · → 250 WR');
    assert.equal(rows[1].kind, 'war');
    assert.equal(rows[0].icon, storesLedgerIcon('convert'));
    assert.notEqual(storesLedgerIcon('war'), storesLedgerIcon('spoil'));
    // every kind has its own glyph, and the text still spells the kind out, so
    // the icon is never the only carrier of meaning
    for (const kind of ['spoil', 'war', 'merc', 'garrison', 'convert', 'structure', 'feed-toggle', 'home-loss'] as const) {
        assert.ok(storesLedgerIcon(kind).length > 0, kind);
    }
    assert.deepEqual(storesLedgerRows('nope', NOW), []);
    assert.deepEqual(storesLedgerRows(null, NOW), []);
    // unique keys even when two rows share a timestamp and a kind
    const dupes = storesLedgerRows([{ at: NOW, kind: 'spoil', amount: 1 }, { at: NOW, kind: 'spoil', amount: 2 }], NOW);
    assert.equal(new Set(dupes.map((r) => r.key)).size, 2);
});

test('the Town Hall stores rows, supply log and vacant-seat path hold their shape', async () => {
    const { readFileSync } = await import('node:fs');
    const townHall = readFileSync(new URL('../screens/TownHall.tsx', import.meta.url), 'utf8');
    // 2a: an unread store renders as an em dash, never as "0 rations".
    assert.match(townHall, /storesLoaded \? `\$\{storesView\.provisions\.toLocaleString\(\)\} rations` : "—"/);
    assert.match(townHall, /storesLoaded \? `\$\{storesView\.materialPoints\.toLocaleString\(\)\} materials` : "—"/);
    assert.match(townHall, /Fetching the stores…/);
    // and the rows are hidden outright when the war/stores layer is off
    assert.match(townHall, /const storesOpen = sectorMapOpen;/);
    assert.match(townHall, /\{storesOpen && <><p className="town-store-row">/);
    // 2c: a failed ledger read is its own state, not "nothing happened yet".
    assert.match(townHall, /The stores ledger could not be read\. Try again in a moment\./);
    // …and an empty-but-stocked log no longer reads as "nothing happened". The
    // ledger records DRAINS only, so a player who had just donated saw the
    // Provisions row climb and "Nothing drawn from the stores yet" beneath it,
    // and concluded the donation was lost. The copy moved into the tested
    // helpers in lib/village-stores-signposts; the screen must call them rather
    // than re-inline a flat sentence.
    assert.match(townHall, /\{storesLedgerEmptyLine\(storesView\)\}/);
    assert.match(townHall, /\{storesLedgerScopeLine\(character\.village\)\}/);
    assert.doesNotMatch(townHall, /Nothing drawn from the stores yet\./, 'the empty state must distinguish "nothing SPENT" from "nothing happened"');
    // 2d: relative stamps are computed in render against a ticking clock.
    assert.match(townHall, /const storesLedgerView = storesLedgerRows\(storesLedgerRaw, storesLedgerNow\);/);
    assert.match(townHall, /setStoresLedgerNow\(Date\.now\(\)\), 60_000/);
    // 2b: the button keeps its label; the refusal is a hint.
    assert.match(townHall, /\{villageDonateLabel\}<\/button>/);
    assert.match(townHall, /id="village-donate-reason"/);
    assert.doesNotMatch(townHall, /title=\{villageDonateGate\.ok \? undefined : villageDonateGate\.reason\}/, 'a title attribute is unreachable on touch');
    // 2f/2g/2h
    assert.match(townHall, /<h4>Supply log<\/h4>/);
    assert.match(townHall, /className="town-stores-log"/);
    assert.doesNotMatch(townHall, /style=\{\{ margin: "0 0 0\.75rem", paddingLeft: "1\.1rem" \}\}/, 'the inline list style moved to a class');
    // 7b: the vacant seat names where to claim it, and gets there.
    assert.match(townHall, /The seat stands empty — claim it at the Shinobi Council Hall\./);
    assert.match(townHall, /onClick=\{\(\) => setScreen\("shinobiCouncil"\)\}/);
    // C3: routine success is a toast, not a modal.
    assert.match(townHall, /gameToast\(\s*credit \?/);
});
