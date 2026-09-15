import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PvpBattleResultPanel, type PvpSettlementState } from "./PvpBattleResultPanel";

function render(settlementState: PvpSettlementState, isSpectator = false) {
    return renderToStaticMarkup(<PvpBattleResultPanel
        outcome="victory" round={4} combatants="Rin · Final · Kenji"
        isSpectator={isSpectator} settlementState={settlementState}
        settlementNotice="Rewards secured — +500 Ryo."
        impactLines={["Sector 44: 250 territory damage recorded"]}
        settlementError="Network interrupted" onRetrySettlement={() => {}}
        onViewBattleLog={() => {}} returnLabel="Return to War Front"
        onReturnToBattlefield={() => {}}
    />);
}

describe("PvP battle result impact", () => {
    it("waits for full settlement before showing world impact", () => {
        for (const state of ["claiming", "failed"] as const) {
            const markup = render(state);
            assert.doesNotMatch(markup, /territory damage recorded/);
            assert.doesNotMatch(markup, /Rewards secured/);
        }
        const confirmed = render("confirmed");
        assert.match(confirmed, /Sector 44: 250 territory damage recorded/);
        assert.match(confirmed, /Return to War Front/);
        assert.doesNotMatch(render("confirmed", true), /territory damage recorded/);
    });
});
