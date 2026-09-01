import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const screen = readFileSync(new URL("./ClanHall.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/index/14-menu-panels-bloodline-vn.css", import.meta.url), "utf8");

describe("Clan Hall mobile roster contract", () => {
    it("keeps Leave Clan on Roster instead of every clan submenu", () => {
        assert.match(screen, /\{view === "roster" && <div className="clan-roster">[^]*className="menu clan-membership-actions"[^]*>Leave Clan<\/button>[^]*<\/div>\}/);
        assert.doesNotMatch(screen, /view !== "exchange"[^]*Clan Exchange balance/);
    });

    it("gives roster identity, role, contribution, and actions separate mobile grid areas", () => {
        assert.match(css, /@media \(max-width: 620px\)[^]*grid-template-areas:[^]*"position identity role"[^]*"\. contribution contribution"[^]*"\. actions actions"/);
        assert.match(css, /\.clan-member-row-v2 \.clan-contrib-col \{[^]*grid-area: contribution/);
        assert.match(css, /\.clan-member-row-v2 \.clan-member-actions \{[^]*grid-area: actions/);
    });
});
