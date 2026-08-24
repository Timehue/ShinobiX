import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

/*
 * Village War Map — feedback, affordability and reachability contract.
 *
 * Pins the fixes for a review pass that found the screen's two feedback slots
 * INVERTED: the success `notice` never cleared and sat in the resources card all
 * session, while a refusal was silently wiped by the 15s poll whether or not it
 * had been read. Alongside that: machine error codes reaching the player, a
 * "raised to L?" fallback, an unaffordable Declare War button with no state, the
 * garrison feed dressed as a primary action, and meaning that lived only in
 * title= attributes on non-focusable elements.
 *
 * Source-text assertions (same shape as VillageWarMap.garrison.test.ts) — the
 * behavioural halves live in lib/village-war-map-ui.test.ts and
 * api/village/war-structure-messages.test.ts.
 */

const screen = readFileSync(new URL('./VillageWarMap.tsx', import.meta.url), 'utf8');
const skin = readFileSync(new URL('../styles/village-war-map-skin.css', import.meta.url), 'utf8');
const client = readFileSync(new URL('../lib/village-war-map.ts', import.meta.url), 'utf8');

describe('Village War Map feedback contract', () => {
    it('3a — success is a transient toast, not a notice that sits in the card forever', () => {
        assert.match(screen, /import \{ gameToast \} from "\.\.\/components\/GameToast"/);
        assert.doesNotMatch(screen, /setNotice/, 'the never-clearing notice slot must be gone');
        assert.doesNotMatch(screen, /const \[notice, /);
        // Every success path toasts.
        for (const call of ['structureUpgradeNotice', 'is feeding the Sector', 'War declared on Sector']) {
            assert.match(screen, new RegExp(`gameToast\\([\\s\\S]{0,200}${call}`), `expected a gameToast carrying "${call}"`);
        }
    });

    it('3a — a refusal survives the 15s poll and only clears on the next action or a dismiss', () => {
        // The poll folds through the helper instead of blanking the slot.
        assert.match(screen, /setError\(\(prev\) => warMapErrorAfterRefresh\(prev, ""\)\)/);
        assert.match(screen, /setError\(\(prev\) => warMapErrorAfterRefresh\(prev, msg\)\)/);
        assert.doesNotMatch(screen, /setError\(""\)/, 'the poll must not blank the error slot outright');
        // Acting is the acknowledgement…
        assert.match(screen, /setBusy\(label\);[\s\S]{0,260}setError\(NO_WAR_MAP_ERROR\)/);
        assert.match(screen, /setError\(warMapErrorAfterAction\(/);
        // …and there is a visible way out that does not require acting.
        assert.match(screen, /className="vwm-error-dismiss"[\s\S]{0,160}setError\(NO_WAR_MAP_ERROR\)/);
        assert.match(screen, /role="alert"/);
        assert.match(skin, /\.vwm-error-dismiss\s*\{/);
    });

    it('C4 — the player reads a sentence, never a machine code', () => {
        assert.match(client, /super\(String\(data\.message \?\? data\.error/);
        assert.doesNotMatch(screen, /isMaterialsRequired|materialsShortMessage/, 'the server sentence supersedes the client-side rephrase');
    });

    it('C5 — a structure confirmation can never read "raised to L?"', () => {
        assert.doesNotMatch(screen, /raised to L\$\{/, 'the level must go through resolvedStructureLevel');
        assert.match(screen, /structureUpgradeNotice\(\{[\s\S]{0,400}knownCurrentLevel: level/);
    });

    it('3c — Declare War has an affordability state computed against the live WR pool', () => {
        assert.match(screen, /declareAfford: wrAffordability\(declareCost, myView\?\.warResources \?\? 0, \{ verb: "Declare War", estimate: true \}\)/);
        assert.match(screen, /disabled=\{!!busy \|\| !declareAfford\.affordable\}/);
        // The "~" is explained in VISIBLE text, not a tooltip.
        assert.match(screen, /className="hint vwm-declare-note">\{declareEstimateNote\(/);
        assert.match(screen, /const hireCost = wrAffordability\(t\.costWr, myView\?\.warResources \?\? 0, \{ verb: "Hire" \}\)/);
    });

    it('3d — feeding a garrison is a secondary toggle, not the Declare War treatment', () => {
        assert.match(screen, /className="vwm-feed-toggle"/);
        assert.match(screen, /aria-pressed=\{myFeed\.on\}/);
        assert.doesNotMatch(screen, /className="vwm-declare"[\s\S]{0,400}setGarrisonFeed/);
        assert.match(skin, /\.vwm-feed-toggle\s*\{[\s\S]*?border:\s*1px dashed/);
        assert.match(skin, /\.vwm-feed-toggle\[aria-pressed="true"\]/);
    });

    it('3e / 3f — the read-only feed lines say who is feeding what, and what it buys', () => {
        assert.match(screen, /garrisonFeedStatusLine\(\{ feeding: myFeed\.on, sector: sec\.sector \}\)/);
        assert.match(screen, /garrisonFedCapLine\(myVillage, myFeed\.covered\)/);
        assert.doesNotMatch(screen, /Garrison feed: \{/, 'the "on"/"off" status line is gone');
        assert.doesNotMatch(screen, /cap 200/, 'the design-doc shorthand is gone');
    });

    it('3g — the button that was pressed relabels; the rest merely disable', () => {
        for (const [id, label] of [['feed-\\$\\{sec\\.sector\\}', 'Feeding…'], ['dec-\\$\\{sec\\.sector\\}', 'Declaring…'], ['hire-\\$\\{t\\.id\\}', 'Hiring…'], ['aband-\\$\\{sec\\.sector\\}', 'Conceding…'], ['deploy-\\$\\{t\\.id\\}', 'Deploying…']]) {
            assert.match(screen, new RegExp(`busyLabel\\(busy, \`${id}\`, "${label}"`), `expected a "${label}" in-flight label`);
        }
        assert.match(screen, /busy === `up-\$\{s\.key\}`/);
        assert.match(screen, /Raising \$\{s\.name\}…/);
    });

    it('3j — the new rows use the icon vocabulary, not bolted-on emoji', () => {
        // main removed the react-icons dependency in favour of the local
        // LightweightGameIcons layer; the vocabulary point is unchanged.
        assert.match(screen, /import \{ GiBowlOfRice, GiHazardSign \} from "\.\.\/components\/icons\/LightweightGameIcons"/);
        assert.match(screen, /import \{ GameIcon \}/);
        assert.doesNotMatch(screen, /🍚/, 'the rice-bowl emoji is replaced by GiBowlOfRice');
        assert.doesNotMatch(screen, /⚠/, 'the warning emoji is replaced by GiHazardSign');
    });

    it('3k — an ANBU appointment made mid-session lights the feed controls up', () => {
        assert.match(screen, /const isAnbu = useMemo\(\(\) => isVillageAnbu\(character\), \[character\]\)/);
        assert.doesNotMatch(screen, /useState\(\(\) => isVillageAnbu/);
    });

    it('3l — the depot conversion note disappears when the cap is zero', () => {
        assert.match(screen, /depotConversionNote\(myView\.depotConversionCap, DEPOT_CONVERSION_POINTS_PER_WR\)/);
        assert.doesNotMatch(screen, /→ up to \{myView\.depotConversionCap\}/);
    });

    it('C2 — the stores meaning is visible text and the Fed/Unfed rule is in the accordion', () => {
        assert.match(screen, /className="hint vwm-stores-meaning">\{provisionsMeaningLine\(GARRISON_RATIONS_PER_DAY\)\}/);
        // The Fed/Unfed explainer is a real cell inside .vwm-info-body's grid.
        const infoBody = screen.match(/vwm-info-grid[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? '';
        assert.match(infoBody, /Fed or Unfed/);
        assert.match(infoBody, /rations a day/);
        assert.match(infoBody, /GARRISON_POINTS_CAP_FED/);
        // The old title-only carriers on the stat row and the chips are gone.
        assert.doesNotMatch(screen, /<span title="Rations in the Town Hall stores/);
        assert.doesNotMatch(screen, /vwm-fed-chip[^>]*title=/);
    });

    it('3h / 3i — the mobile contest track is wide enough and the taps are 44px', () => {
        const mobile = skin.match(/@media \(max-width: 800px\)\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
        assert.ok(mobile, 'expected the ≤800px block');
        assert.match(mobile, /\.vwm-grid \{ grid-template-columns: repeat\(auto-fill, minmax\(160px, 1fr\)\); \}/);
        assert.doesNotMatch(mobile, /minmax\(120px/);
        assert.match(mobile, /\.vwm-declare, \.vwm-feed-toggle \{ min-height: 44px/);
        assert.match(skin, /\.vwm-sector \{[^}]*overflow-wrap: anywhere/);
    });

    it('P1 — the 1Hz tick drives ONLY the countdowns; every per-card derivation is memoised', () => {
        // The screen re-renders every second (useSharedNow). Before this, each of
        // the 32 sector cards redid a linear intel lookup, the declare pricing and
        // a fresh garrison-feed object on every one of those ticks.
        const memo = screen.match(/const sectorViews = useMemo\(\(\) => new Map\([\s\S]*?\}\)\)\), \[[^\]]*\]\);/)?.[0] ?? '';
        assert.ok(memo, 'expected a sectorViews useMemo');
        // Keyed on the data that actually feeds it — never on the tick.
        assert.match(memo, /\[data, owners, myVillage, isKage, isAnbu, contestBySector, myView\]\);$/);
        assert.doesNotMatch(memo, /nowTick|useSharedNow/, 'the memo must not depend on the clock');
        const unfedMemo = screen.match(/const unfedContestIds = useMemo\([\s\S]*?\[data, myVillage\],\s*\);/)?.[0] ?? '';
        assert.ok(unfedMemo, 'expected an unfedContestIds useMemo for the Active Wars list');

        // None of the four hot calls may survive in the render body.
        const renderBody = screen.replace(memo, '').replace(unfedMemo, '');
        for (const call of ['revealedIntelForSector', 'expectedDeclareCost', 'contestGarrisonFeed', 'contestVillageUnfed']) {
            assert.doesNotMatch(renderBody, new RegExp(`${call}\\(`), `${call}() must be computed inside the memo, not per render`);
        }
        // The tick is read exactly where a countdown needs it, nowhere else.
        const ticks = screen.match(/nowTick/g) ?? [];
        assert.equal(ticks.length, 3, 'one declaration + the two "hours left" countdowns');
        assert.equal((screen.match(/endsAt - nowTick/g) ?? []).length, 2);
    });

    it('uses the canonical stock names in every player-facing string it owns', () => {
        // Deliberately narrow: the CSS/JSX identifiers `materialPoints` and
        // `vwm-materials-need` are code, the copy must not be.
        const copy = screen.replace(/materialPoints|remainingMaterialPoints|vwm-materials-need/g, '');
        assert.doesNotMatch(copy, /craft points|material points|\bpts\b|\bsupplies\b/i);
    });
});
