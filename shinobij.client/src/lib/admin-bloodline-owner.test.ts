import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ReviewBloodline } from "../types/combat";
import {
    ADMIN_BLOODLINE_OWNER_KEY,
    adminBloodlineOwnerId,
    canonicalBloodlineOwnerKey,
    findAdminBloodlineByOwnerId,
    prepareAdminBloodlineApproval,
    sameAdminBloodlineOwner,
} from "./admin-bloodline-owner";

function bloodline(ownerKey: string | undefined, name: string): ReviewBloodline {
    return {
        id: "shared-id",
        name,
        rank: "A Rank",
        jutsus: [],
        totalPoints: 0,
        ownerKey,
    };
}

describe("admin bloodline owner identity", () => {
    it("canonicalizes player owners with the save-key rule and defaults authored entries to admin", () => {
        assert.equal(canonicalBloodlineOwnerKey(undefined), ADMIN_BLOODLINE_OWNER_KEY);
        assert.equal(canonicalBloodlineOwnerKey(""), ADMIN_BLOODLINE_OWNER_KEY);
        assert.equal(canonicalBloodlineOwnerKey(" Player.A "), "playera");
        assert.equal(canonicalBloodlineOwnerKey({}), "");
    });

    it("keeps identical bloodline ids distinct across owners", () => {
        const admin = bloodline("admin", "Admin Copy");
        const playerA = bloodline("Player A", "Player A Copy");
        const playerB = bloodline("playerb", "Player B Copy");
        const records = [admin, playerA, playerB];

        assert.equal(adminBloodlineOwnerId(admin), "admin:shared-id");
        assert.equal(adminBloodlineOwnerId(playerA), "playera:shared-id");
        assert.equal(adminBloodlineOwnerId(playerB), "playerb:shared-id");
        assert.equal(findAdminBloodlineByOwnerId(records, "playera:shared-id"), playerA);
        assert.equal(findAdminBloodlineByOwnerId(records, "playerb:shared-id"), playerB);
    });

    it("matches by the composite owner and id rather than id alone", () => {
        const playerA = bloodline("Player A", "Player A Copy");
        const samePlayer = bloodline("playera", "Updated Copy");
        const playerB = bloodline("Player B", "Player B Copy");

        assert.equal(sameAdminBloodlineOwner(playerA, samePlayer), true);
        assert.equal(sameAdminBloodlineOwner(playerA, playerB), false);
    });

    it("fails closed for empty bloodline ids and malformed owners", () => {
        assert.equal(adminBloodlineOwnerId({ id: "", ownerKey: "playera" }), "");
        assert.equal(adminBloodlineOwnerId({ id: "shared-id", ownerKey: "..." }), "");
        assert.equal(findAdminBloodlineByOwnerId([
            bloodline("Player A", "Player A Copy"),
        ], "admin:shared-id"), undefined);
    });

    it("promotes duplicate player ids into collision-free admin catalog identities", () => {
        const sourceA = {
            ...bloodline("playera", "Player A Copy"),
            ownerImage: "/api/img/player-a.webp",
            image: "/api/img/shared-fallback.webp",
            jutsus: [{ id: "shared-jutsu", name: "A", type: "Ninjutsu", element: "Fire", method: "Ranged", target: "Enemy", power: 1, effectPower: 1, ap: 1, range: 1, cooldown: 0 }],
        } as ReviewBloodline;
        const approved = prepareAdminBloodlineApproval(sourceA);
        const repeated = prepareAdminBloodlineApproval(sourceA);
        const ownerB = prepareAdminBloodlineApproval({ ...sourceA, ownerKey: "playerb" });

        assert.match(approved.id, /^bloodline-approved-[0-9a-f]{16}$/);
        assert.match(approved.jutsus[0]?.id ?? "", /^jutsu-approved-[0-9a-f]{16}$/);
        assert.equal(approved.image, undefined, "owner-key /api/img references cannot alias the promoted admin key");
        assert.notEqual(approved.id, sourceA.id);
        assert.notEqual(approved.jutsus[0]?.id, sourceA.jutsus[0]?.id);
        assert.deepEqual(repeated, approved, "the same source approval must be idempotent across clicks and reloads");
        assert.notEqual(ownerB.id, approved.id, "same-id content from another owner needs an independent promotion id");

        const inlineImage = prepareAdminBloodlineApproval({
            ...sourceA,
            ownerImage: "data:image/webp;base64,AAAA",
            jutsus: [{ ...sourceA.jutsus[0]!, image: "/api/img?category=jutsu&id=shared-jutsu" }],
        });
        assert.equal(inlineImage.image, "data:image/webp;base64,AAAA");
        assert.equal(inlineImage.jutsus[0]?.image, undefined);

        const admin = prepareAdminBloodlineApproval(bloodline("admin", "Admin Copy"));
        assert.equal(admin.id, "shared-id");
    });
});
