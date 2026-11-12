import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PvpBattleResultPanel } from "./PvpBattleResultPanel";

// A win over a Cinderhold shinobi that paid nothing says why (2026-11-11), from
// the claim reply's `npcPay` (api/pvp/claim-rewards.ts).
function render(npcPayReason: string | undefined, settlementNotice = "") {
    return renderToStaticMarkup(<PvpBattleResultPanel
        outcome="victory" round={6} combatants="Rin · Final · Kuroto"
        isSpectator={false} settlementState="confirmed" settlementNotice={settlementNotice}
        impactLines={[]} settlementError="" onRetrySettlement={() => {}}
        onViewBattleLog={() => {}} returnLabel="Return to the map" onReturnToBattlefield={() => {}}
        npcPayReason={npcPayReason}
    />);
}

describe("PvP result: why a Cinderhold win paid nothing", () => {
    it("replaces the generic line with the NPC rule", () => {
        for (const reason of ["npc-repeat", "npc-daily-cap"]) {
            const markup = render(reason);
            assert.match(markup, /Only your first win against each Cinderhold shinobi pays each day, up to 5 a day\./);
            assert.doesNotMatch(markup, /No personal payout/);
        }
        assert.match(render("npc-campaign"), /Village war objective fights score for the war and pay no purse\./);
        for (const reason of ["npc-loss-repeat", "npc-loss-daily-cap"]) {
            assert.match(render(reason), /Only your first loss to each Cinderhold shinobi pays each day, up to 5 a day\./);
        }
    });
    it("keeps the generic line without a reason, and adds the rule beside other results", () => {
        assert.match(render(undefined), /No personal payout for this result\./);
        const withScore = render("npc-campaign", "Rewards secured — +40 War Score.");
        assert.match(withScore, /\+40 War Score/);
        assert.match(withScore, /pay no purse/);
    });
    it("the battle screen passes the claim reply's reason to the panel", () => {
        const screen = readFileSync(new URL("../screens/PvpBattleScreen.tsx", import.meta.url), "utf8");
        assert.match(screen, /setPvpNpcPayReason\(result\.npcPay \?\? ""\)/);
        const claim = readFileSync(new URL("../lib/pvp-reward-claim.ts", import.meta.url), "utf8");
        assert.match(claim, /typeof payload\.npcPay === "string" \? \{ npcPay: payload\.npcPay \}/);
        assert.match(screen, /npcPayReason=\{pvpNpcPayReason\}/);
    });
});
