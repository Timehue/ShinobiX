import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

describe("bounded supporter analytics wiring", () => {
    it("records the supporter page and actual Patreon start and failure paths", () => {
        const patreon = source("../../components/PatreonLink.tsx");
        assert.match(patreon, /captureProductEvent\('supporter_page_viewed'/);
        assert.match(patreon, /captureProductEvent\('patreon_connection_started'/);
        assert.equal((patreon.match(/captureProductEvent\('patreon_connection_failed'/g) ?? []).length, 2);
    });

    it("uses exact, honest Base and Supporter benefit distinctions", () => {
        const patreon = source("../../components/PatreonLink.tsx");
        assert.match(patreon, /Base account: 12 equipped · Supporter: 15 equipped \(three additional combat options\)/);
        assert.match(patreon, /Base roster: 4 carried pets · Supporter roster: 6 carried pets/);
        assert.match(patreon, /Base account: 1 · Supporter: 2/);
        assert.match(patreon, /Supporter: upload your own avatar/);
        assert.doesNotMatch(patreon, /equal (?:footing|loadouts?)/i);
    });

    it("records only deliberate inspection of a locked jutsu slot", () => {
        const loadout = source("../../components/JutsuLoadoutPanel.tsx");
        const profileSkin = source("../../styles/profile-skin.css");
        assert.match(loadout, /captureProductEvent\("locked_jutsu_slot_inspected"/);
        assert.match(loadout, /<button[\s\S]*?className="jutsu-loadout-slot is-locked"[\s\S]*?onClick=\{\(\) => \{[\s\S]*?captureProductEvent\("locked_jutsu_slot_inspected"/);
        assert.match(loadout, /aria-describedby="jutsu-supporter-slot-copy"/);
        assert.match(loadout, /Base account: 12 equipped jutsu · Supporter: 15 equipped jutsu\./);
        assert.match(profileSkin, /\.jutsu-loadout-slot\.is-locked:focus-visible\s*\{[^}]*var\(--sj-spirit-bright\)/s);
        assert.match(profileSkin, /prefers-reduced-motion: reduce[\s\S]*?\.jutsu-loadout-slot\.is-locked\s*\{[^}]*transition:\s*none/s);
    });

    it("records the visible Sanctuary overflow explanation on entry", () => {
        const sanctuary = source("../../components/PetSanctuary.tsx");
        assert.match(sanctuary, /captureProductEvent\("sanctuary_overflow_explanation_viewed"/);
        assert.match(sanctuary, /Companions beyond your carried roster rest here safely/);
    });

    it("records authoritative OAuth outcomes and reconciliation failure paths", () => {
        const callback = source("../../../../api/patreon/oauth-callback.ts");
        const webhook = source("../../../../api/patreon/webhook.ts");
        assert.match(callback, /captureServerProductEvent\('patreon_connection_succeeded'/);
        assert.match(callback, /captureServerProductEvent\('patreon_connection_failed'/);
        assert.match(callback, /captureServerProductEvent\('subscription_entitlement_refresh_failed'/);
        assert.match(webhook, /captureServerProductEvent\('subscription_entitlement_refresh_failed'/);
    });
});
