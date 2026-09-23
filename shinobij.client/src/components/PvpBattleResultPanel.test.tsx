import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PvpBattleResultPanel, type PvpBattleOutcome, type PvpSettlementState } from "./PvpBattleResultPanel";

function render(settlementState: PvpSettlementState, isSpectator = false, outcome: PvpBattleOutcome = "victory") {
    return renderToStaticMarkup(<PvpBattleResultPanel
        outcome={outcome} round={4} combatants="Rin · Final · Kenji"
        isSpectator={isSpectator} settlementState={settlementState}
        settlementNotice="Rewards secured — +500 Ryo."
        impactLines={["Sector 44: 250 territory damage recorded"]}
        settlementError="Network interrupted" onRetrySettlement={() => {}}
        onViewBattleLog={() => {}} returnLabel="Return to War Front"
        onReturnToBattlefield={() => {}}
    />);
}

describe("PvP battle result impact", () => {
    it("shows cancellation without a draw, rewards, or a disabled return after confirmation", () => {
        const markup = render("confirmed", false, "cancelled");
        assert.match(markup, /Duel Cancelled/);
        assert.match(markup, /No rewards or penalties/);
        assert.match(markup, /Cancellation confirmed/);
        assert.doesNotMatch(markup, /Draw|Battle Rewards|disabled/);
    });
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
