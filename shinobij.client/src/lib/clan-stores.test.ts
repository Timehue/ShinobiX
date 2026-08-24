import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    CLAN_LOW_RATION_DAYS,
    CLAN_WAR_RATIONS_PER_DAY,
    clanRationBurnLabel,
    clanRationBurnPerDay,
    clanRationCreditLine,
    clanRationDaysCovered,
    clanRationDonateBlock,
    clanRationDonateLabel,
    clanRationDonationCapLine,
    clanRationDonationCount,
    clanRationsHeldLabel,
    clanStoresReadout,
    clanWarFedToday,
    storesDayKey,
} from "./clan-stores";
import { DAILY_RATION_DONATION_CAP, WAR_RATIONS_PER_DAY } from "./village-stores";

const NOW = Date.UTC(2026, 7, 24, 12, 0, 0);
const TODAY = "2026-08-24";

describe("clan stores — constants stay pinned to the server mirror", () => {
    it("re-exports the village burn rate rather than restating it", () => {
        // Identity, and only identity, is what this file can prove: both names
        // live in this tree. The CROSS-TREE assertion — that the number also
        // matches api/_village-stores-daily.ts — is in
        // scripts/village-stores-parity.test.ts, which imports both trees and
        // can therefore actually fail. Asserting a literal 30 here as well
        // would just fire a second, more confusing failure on a legitimate
        // retune.
        assert.equal(CLAN_WAR_RATIONS_PER_DAY, WAR_RATIONS_PER_DAY);
    });
});

describe("clanWarFedToday", () => {
    it("reads today's verdict for the named clan", () => {
        const row = { storesDate: TODAY, storesFed: { Alpha: true, Beta: false } };
        assert.equal(clanWarFedToday(row, "Alpha", NOW), true);
        assert.equal(clanWarFedToday(row, "Beta", NOW), false);
    });
    it("returns null rather than 'unfed' when there is no verdict", () => {
        assert.equal(clanWarFedToday(null, "Alpha", NOW), null);
        assert.equal(clanWarFedToday({}, "Alpha", NOW), null);
        assert.equal(clanWarFedToday({ storesDate: TODAY }, "Alpha", NOW), null);
        assert.equal(clanWarFedToday({ storesDate: TODAY, storesFed: {} }, "Alpha", NOW), null);
    });
    it("ignores a verdict stamped on an older UTC day", () => {
        const row = { storesDate: "2026-08-23", storesFed: { Alpha: false } };
        assert.equal(clanWarFedToday(row, "Alpha", NOW), null);
    });
    it("stamps the same UTC day key the server writes", () => {
        assert.equal(storesDayKey(NOW), TODAY);
    });
});

describe("burn / held projection", () => {
    it("multiplies the per-war burn by the active wars", () => {
        assert.equal(clanRationBurnPerDay(0), 0);
        assert.equal(clanRationBurnPerDay(1), 30);
        assert.equal(clanRationBurnPerDay(3), 90);
        assert.equal(clanRationBurnPerDay(-2), 0);
    });
    it("counts whole days of war covered", () => {
        assert.equal(clanRationDaysCovered(90, 1), 3);
        assert.equal(clanRationDaysCovered(89, 1), 2);
        assert.equal(clanRationDaysCovered(90, 3), 1);
        assert.equal(clanRationDaysCovered(0, 1), 0);
    });
    it("returns null instead of a fake 0 when nothing burns or nothing was read", () => {
        assert.equal(clanRationDaysCovered(500, 0), null);
        assert.equal(clanRationDaysCovered(null, 1), null);
        assert.equal(clanRationDaysCovered(undefined, 1), null);
    });
    it("labels the held stock in rations, formatted, and singularised", () => {
        assert.equal(clanRationsHeldLabel(1_240), "1,240 rations");
        assert.equal(clanRationsHeldLabel(1), "1 ration");
        assert.equal(clanRationsHeldLabel(0), "0 rations");
        assert.equal(clanRationsHeldLabel(null), null);
        assert.equal(clanRationsHeldLabel(undefined), null);
    });
    it("labels the daily cost, naming the war count only when it is plural", () => {
        assert.equal(clanRationBurnLabel(0), "None while at peace");
        assert.equal(clanRationBurnLabel(1), "30 rations a day");
        assert.equal(clanRationBurnLabel(2), "60 rations a day across 2 wars");
    });
});

describe("clanStoresReadout", () => {
    it("stays silent for a clan at peace with nothing stocked", () => {
        assert.equal(clanStoresReadout({ clanName: "Alpha", provisions: null, activeWars: 0 }), null);
        assert.equal(clanStoresReadout({ clanName: "Alpha", provisions: 0, activeWars: 0 }), null);
    });
    it("reads calm for a clan at peace that holds rations", () => {
        const r = clanStoresReadout({ clanName: "Alpha", provisions: 500, activeWars: 0 });
        assert.ok(r);
        assert.equal(r.tone, "neutral");
        assert.equal(r.held, "500 rations");
        assert.equal(r.burn, "None while at peace");
        assert.equal(r.cover, null);
        assert.equal(r.line, "Alpha is at peace — 500 rations stand ready and nothing is drawn. A clan war burns 30 rations a day.");
    });
    it("never asserts 0 rations from a figure that was never written", () => {
        const r = clanStoresReadout({ clanName: "Alpha", provisions: undefined, activeWars: 1 });
        assert.ok(r);
        assert.equal(r.held, null);
        assert.equal(r.tone, "danger");
        assert.equal(r.line, "No rations are stocked yet, and this war costs 30 rations a day. Cook ration packs at the Cafeteria, then donate them on the Treasury tab.");
        assert.doesNotMatch(r.line, /\b0 rations\b/);
    });
    it("distinguishes a read empty store from an unread one", () => {
        const r = clanStoresReadout({ clanName: "Alpha", provisions: 0, activeWars: 1 });
        assert.ok(r);
        assert.equal(r.held, "0 rations");
        assert.equal(r.tone, "danger");
        assert.equal(r.line, "The clan stores stand empty, and this war costs 30 rations a day. Cook ration packs at the Cafeteria, then donate them on the Treasury tab.");
    });
    it("leads with today's unfed verdict when the pass reported one", () => {
        const r = clanStoresReadout({ clanName: "Alpha", provisions: 12, activeWars: 1, unfedWars: 1 });
        assert.ok(r);
        assert.equal(r.tone, "danger");
        assert.equal(r.line, "Alpha went unfed today — the war costs 30 rations a day and the stores could not cover it. Cook ration packs at the Cafeteria, then donate them on the Treasury tab.");
    });
    it("cannot report more unfed wars than are running", () => {
        const r = clanStoresReadout({ clanName: "Alpha", provisions: 900, activeWars: 0, unfedWars: 4 });
        assert.ok(r);
        assert.equal(r.tone, "neutral");
        assert.doesNotMatch(r.line, /unfed/);
    });
    it("warns under two days of war", () => {
        const r = clanStoresReadout({ clanName: "Alpha", provisions: 45, activeWars: 1 });
        assert.ok(r);
        assert.equal(r.tone, "warn");
        assert.equal(r.cover, "1 day of war");
        assert.equal(r.line, `45 rations left against 30 rations a day — under ${CLAN_LOW_RATION_DAYS} days of war. Cook ration packs at the Cafeteria, then donate them on the Treasury tab.`);
    });
    it("reads as a calm status line when the stores are deep", () => {
        const r = clanStoresReadout({ clanName: "Alpha", provisions: 1_240, activeWars: 1 });
        assert.ok(r);
        assert.equal(r.tone, "neutral");
        assert.equal(r.cover, "41 days of war");
        assert.equal(r.line, "1,240 rations in the clan stores against 30 rations a day — enough for 41 days of war. Rations are drawn from the stores each day.");
    });
    it("confirms today's rations were paid once the pass has fed the war", () => {
        // The FED half of the verdict. It shipped uncounted: the panel filtered
        // for `=== false` only, so a clan the pass had fed read exactly like a
        // clan the pass had not reached yet.
        const r = clanStoresReadout({ clanName: "Alpha", provisions: 1_240, activeWars: 1, fedWars: 1 });
        assert.ok(r);
        assert.equal(r.tone, "neutral");
        assert.match(r.line, /Today's rations are paid\.$/);
    });
    it("stays silent about feeding when the pass has not reached the clan today", () => {
        const r = clanStoresReadout({ clanName: "Alpha", provisions: 1_240, activeWars: 1, fedWars: 0 });
        assert.ok(r);
        assert.doesNotMatch(r.line, /paid/, "an unreached clan must not be told its rations were paid");
    });
    it("never counts more fed wars than the clan is actually fighting", () => {
        const r = clanStoresReadout({ clanName: "Alpha", provisions: 1_240, activeWars: 1, fedWars: 99 });
        assert.ok(r);
        assert.match(r.line, /Today's rations are paid\.$/);
    });
    it("falls back to a neutral clan name rather than an empty sentence", () => {
        const r = clanStoresReadout({ clanName: "   ", provisions: 100, activeWars: 0 });
        assert.ok(r);
        assert.match(r.line, /^Your clan is at peace/);
    });
    it("uses the canonical unit and never the banned ones", () => {
        const lines = [
            clanStoresReadout({ clanName: "Alpha", provisions: 1_240, activeWars: 1 }),
            clanStoresReadout({ clanName: "Alpha", provisions: 0, activeWars: 2 }),
            clanStoresReadout({ clanName: "Alpha", provisions: 500, activeWars: 0 }),
        ].map((r) => `${r!.line} ${r!.burn} ${r!.held ?? ""} ${r!.cover ?? ""}`).join(" ");
        assert.match(lines, /rations/);
        assert.doesNotMatch(lines, /provisions points|craft points|\bpts\b/i);
    });
});

describe("ration donation gate + copy", () => {
    const donorWith = (rations: number) => ({ storesDonatedDate: TODAY, rationsDonatedToday: rations });

    it("clamps the donation to what is left of the shared daily allowance", () => {
        assert.equal(clanRationDonationCount(donorWith(0), 12, NOW), 12);
        assert.equal(clanRationDonationCount(donorWith(35), 12, NOW), DAILY_RATION_DONATION_CAP - 35);
        assert.equal(clanRationDonationCount(donorWith(DAILY_RATION_DONATION_CAP), 12, NOW), 0);
        assert.equal(clanRationDonationCount(donorWith(0), 0, NOW), 0);
    });
    it("ignores yesterday's counter", () => {
        const stale = { storesDonatedDate: "2026-08-23", rationsDonatedToday: DAILY_RATION_DONATION_CAP };
        assert.equal(clanRationDonationCount(stale, 5, NOW), 5);
    });
    it("explains the block in a sentence, never only an icon", () => {
        assert.equal(clanRationDonateBlock(donorWith(0), 0, NOW), "You are not carrying any ration packs. Cook them at the Cafeteria.");
        assert.equal(
            clanRationDonateBlock(donorWith(DAILY_RATION_DONATION_CAP), 5, NOW),
            "Daily limit reached — 40 rations donated today. The allowance resets at midnight UTC.",
        );
        assert.equal(clanRationDonateBlock(donorWith(0), 5, NOW), null);
    });
    it("names the amount on the button", () => {
        assert.equal(clanRationDonateLabel(0), "Donate Ration Packs");
        assert.equal(clanRationDonateLabel(1), "Donate 1 Ration Pack");
        assert.equal(clanRationDonateLabel(1_200), "Donate 1,200 Ration Packs");
    });
    it("shows the running allowance and says it is shared", () => {
        assert.equal(
            clanRationDonationCapLine(donorWith(5), NOW),
            "Rations donated today: 5/40. This allowance is shared with Town Hall donations and resets at midnight UTC.",
        );
    });
    it("confirms the credit and the new total", () => {
        assert.equal(clanRationCreditLine("Alpha", 12, 1_240), "+12 rations to Alpha's war stores — 1,240 now held.");
        assert.equal(clanRationCreditLine("Alpha", 1, 1), "+1 ration to Alpha's war stores — 1 now held.");
    });
    it("does not claim a stores credit when the server reported none", () => {
        assert.equal(clanRationCreditLine("Alpha", 3, null), "3 ration packs donated to Alpha's treasury.");
        assert.equal(clanRationCreditLine("", 1, undefined), "1 ration pack donated to your clan's treasury.");
    });
});
