import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

/*
 * A cleared combat mission has to LOOK cleared.
 *
 * Combat wins pay nothing on the spot — they queue a durable claim
 * (pendingCombatMissionClaims) the player settles back in the Mission Hall. So the
 * Hall is the only place that can tell a player a reward is waiting, and for a
 * while it did not: Missions.tsx put `mh-fetch-complete` on the cleared card, but
 * the only rules for that class matched `.mh-fetch-card` and `.mh-field-card`.
 * On a COMBAT card it painted nothing.
 *
 * On desktop the button label ("Claim Reward") still carried the state, so the bug
 * was invisible in review. Under 700px `.mh-combat-btn-label` is sr-only and the
 * button collapses to a 44px glyph column — leaving a cleared mission
 * PIXEL-IDENTICAL to one never attempted. Players fought, won, came back, and saw
 * six identical rows with the same gold chevron.
 *
 * These assertions are deliberately about the SIGHTED signals only. A screen-reader
 * label passing is exactly what made the original bug ship.
 */

const missionsSource = readFileSync(new URL("./Missions.tsx", import.meta.url), "utf8");
const skinCss = readFileSync(new URL("../styles/hub-screens-skin.css", import.meta.url), "utf8");

/** The `@media (max-width: 700px)` block — the phone layout the bug lived in. */
function phoneBlock(css: string): string {
    const start = css.indexOf("@media (max-width: 700px)");
    assert.notEqual(start, -1, "hub-screens-skin.css must keep its 700px phone block");
    // Walk the braces so the slice ends at the media query's own closing brace.
    let depth = 0;
    for (let i = css.indexOf("{", start); i < css.length; i++) {
        if (css[i] === "{") depth++;
        else if (css[i] === "}" && --depth === 0) return css.slice(start, i);
    }
    assert.fail("unterminated 700px media block");
}

describe("Mission Hall — a waiting reward is visible", () => {
    it("styles the cleared COMBAT card, not just field/fetch cards", () => {
        // The original bug in one line: the class was applied but never matched.
        assert.match(
            skinCss,
            /\.mh-combat-card\.mh-fetch-complete\b/,
            "Missions.tsx marks cleared combat cards with .mh-fetch-complete; that selector must actually exist in CSS",
        );
    });

    it("outranks the gold card skin on the Weekly Board's cleared card", () => {
        // 12-village-screen.css does paint `.mh-fetch-card.mh-fetch-complete` green,
        // but this skin sets `border: ... !important` on `.mission-hall .mh-fetch-card`
        // — so a bare `border-color` never reached the screen. Same dead highlight as
        // the combat card, arrived at from the other direction.
        assert.match(
            skinCss,
            /\.mission-hall \.mh-fetch-card\.mh-fetch-complete\b/,
            "the Hall skin must re-assert the complete highlight it overrides",
        );
    });

    it("re-asserts the ready state inside the phone layout", () => {
        // The phone block resets .mh-combat-btn to a flat 44px column with a gold
        // chevron. Without a later, more specific rule the cleared card is flattened
        // right back into looking untouched — which is how this shipped.
        const phone = phoneBlock(skinCss);
        assert.match(
            phone,
            /\.mh-combat-card\.mh-fetch-complete .mh-combat-btn\b/,
            "the 700px block must re-style the claim button after its generic .mh-combat-btn reset",
        );
        assert.match(
            phone,
            /\.mh-combat-card\.mh-fetch-complete .mh-combat-btn-arrow\b/,
            "the 700px block must re-style the glyph after its generic .mh-combat-btn-arrow reset",
        );
    });

    it("marks the cleared card with a signal that survives the sr-only label", () => {
        // .mh-combat-btn-label is clipped to 1px under 700px, so the button text is
        // NOT a phone-visible signal. These two are.
        assert.match(
            missionsSource,
            /className="mh-tag mh-tag-ready"/,
            "a cleared card needs a visible tag, not only the sr-only button label",
        );
        assert.match(skinCss, /\.mh-tag-ready\b/, "mh-tag-ready must be styled");
        assert.match(
            missionsSource,
            /className="mh-combat-btn-arrow" aria-hidden="true">✓</,
            "the 44px glyph column must show a check on a claimable card, not the ordinary chevron",
        );
    });

    it("flags the Combat tab when a claim is waiting on another tab", () => {
        // Players with a profession land on the Profession tab, so the cleared card
        // is off-screen entirely. The tab strip already has the dot pattern (World).
        assert.match(
            missionsSource,
            /pendingCombatClaims > 0 && <span className="mh-tab-alert"/,
            "the Combat tab must show the existing alert dot while a claim is pending",
        );
    });

    it("counts pending claims from the durable server flag", () => {
        assert.match(
            missionsSource,
            /const pendingCombatClaims = \(character\.pendingCombatMissionClaims \?\? \[\]\)\.length;/,
            "the banner/dot must read the same durable list the claim button gates on",
        );
    });

    it("keeps the field claim button distinguishable on a phone too", () => {
        // Same 44px collapse: .mh-field-primary-label is sr-only and the
        // "Ready to claim" pill is display:none under 700px.
        assert.match(
            missionsSource,
            /className="mh-field-primary-arrow" aria-hidden="true">✓</,
            "the field claim button needs the check glyph for the same reason the combat one does",
        );
        assert.match(phoneBlock(skinCss), /\.mh-claim-btn .mh-field-primary-arrow\b/);
    });
});
