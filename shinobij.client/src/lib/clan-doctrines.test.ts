import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
    normalizeDoctrine, doctrineShopDiscount, doctrineHospitalDiscount, doctrineXpBonus, doctrineWarHp,
    DOCTRINE_SHOP_DISCOUNT, DOCTRINE_HOSPITAL_DISCOUNT, DOCTRINE_XP_BONUS, DOCTRINE_WAR_HP, CLAN_DOCTRINES,
} from "./clan-doctrines";

describe("clan doctrines", () => {
    it("normalizes unknown/missing values to 'none'", () => {
        assert.equal(normalizeDoctrine("warmonger"), "warmonger");
        assert.equal(normalizeDoctrine("nope"), "none");
        assert.equal(normalizeDoctrine(undefined), "none");
        assert.equal(normalizeDoctrine(42), "none");
    });
    it("each doctrine grants its own domain bonus and nothing else", () => {
        assert.equal(doctrineShopDiscount("merchant"), DOCTRINE_SHOP_DISCOUNT);
        assert.equal(doctrineShopDiscount("scholars"), 0);
        assert.equal(doctrineHospitalDiscount("medics"), DOCTRINE_HOSPITAL_DISCOUNT);
        assert.equal(doctrineHospitalDiscount("merchant"), 0);
        assert.equal(doctrineXpBonus("scholars"), DOCTRINE_XP_BONUS);
        assert.equal(doctrineXpBonus("medics"), 0);
        assert.equal(doctrineWarHp("warmonger"), DOCTRINE_WAR_HP);
        assert.equal(doctrineWarHp("merchant"), 0);
    });
    it("'none' grants nothing across the board", () => {
        for (const fn of [doctrineShopDiscount, doctrineHospitalDiscount, doctrineXpBonus, doctrineWarHp]) {
            assert.equal(fn("none"), 0);
        }
    });
    it("exposes exactly the four pickable doctrines", () => {
        assert.deepEqual(CLAN_DOCTRINES.map(d => d.id), ["warmonger", "merchant", "scholars", "medics"]);
    });
});
