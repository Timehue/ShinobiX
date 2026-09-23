import assert from "node:assert/strict";
import { test } from "node:test";
import { assertBloodlineSaveAcknowledged } from "./bloodline-save-ack";
import type { SavedBloodline } from "../types/combat";

const requested = [{ id: "bl-new", rank: "A Rank" }] as SavedBloodline[];

test("bloodline maker accepts only a server acknowledgement that retained and equipped the new id", () => {
    assert.doesNotThrow(() => assertBloodlineSaveAcknowledged(
        { savedBloodlineIds: ["bl-new"], savedBloodlineRanks: { "bl-new": "A Rank" }, equippedBloodlineId: "bl-new" }, requested, "bl-new"));
    assert.throws(() => assertBloodlineSaveAcknowledged(
        { savedBloodlineIds: ["bl-old"], savedBloodlineRanks: { "bl-old": "A Rank" }, equippedBloodlineId: "bl-old" }, requested, "bl-new"));
    assert.throws(() => assertBloodlineSaveAcknowledged(
        { savedBloodlineIds: ["bl-new"], savedBloodlineRanks: { "bl-new": "A Rank" }, equippedBloodlineId: "bl-old" }, requested, "bl-new"));
    assert.throws(() => assertBloodlineSaveAcknowledged(
        { savedBloodlineIds: ["bl-new"], savedBloodlineRanks: { "bl-new": "B Rank" }, equippedBloodlineId: "bl-new" }, requested, "bl-new"));
    assert.throws(() => assertBloodlineSaveAcknowledged(undefined, requested, "bl-new"));
});
