import { test } from "node:test";
import assert from "node:assert/strict";
import { NOTICE_KEY_GUARD_MS, confirmFocusesCancel, noticeKeyCanDismiss, playerAlertText } from "./GameAlert";

const UNREACHABLE = "The server could not be reached. Check your connection and try again.";
const SERVER_FAILED = "The server could not finish that. Try again in a moment.";

test("raw browser network errors become a sentence the player can act on", () => {
    for (const raw of ["Failed to fetch", "Load failed", "NetworkError when attempting to fetch resource.", "NetworkError when attempting to fetch resource"]) {
        assert.equal(playerAlertText(raw), UNREACHABLE, raw);
    }
    // A 502 HTML page parsed as JSON.
    assert.equal(playerAlertText("Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON"), UNREACHABLE);
});

test("a bare server fault becomes a retry sentence", () => {
    assert.equal(playerAlertText("Internal server error."), SERVER_FAILED);
    assert.equal(playerAlertText("Internal server error"), SERVER_FAILED);
});

test("every other message, including ones that merely mention a fault, is left as written", () => {
    for (const message of [
        "Not enough stamina.",
        "Failed to fetch the clan roster. Try again.",
        "The bank could not be reached: Internal server error.",
        "",
    ]) {
        assert.equal(playerAlertText(message), message);
    }
});

test("a notice ignores a held key and a key typed as it arrived", () => {
    const openedAt = 1_000;
    assert.equal(noticeKeyCanDismiss({ repeat: false }, openedAt, openedAt + 10), false, "typed into chat as the notice landed");
    assert.equal(noticeKeyCanDismiss({ repeat: true }, openedAt, openedAt + 5_000), false, "auto-repeat from a held key");
    assert.equal(noticeKeyCanDismiss({ repeat: false }, openedAt, openedAt + NOTICE_KEY_GUARD_MS), true);
});

test("a destructive confirm opens on Cancel unless the caller chose otherwise", () => {
    assert.equal(confirmFocusesCancel({ danger: true }), true);
    assert.equal(confirmFocusesCancel({ danger: true, initialFocus: "confirm" }), false, "an explicit initialFocus wins");
    assert.equal(confirmFocusesCancel({ initialFocus: "cancel" }), true);
    assert.equal(confirmFocusesCancel({}), false);
    assert.equal(confirmFocusesCancel(undefined), false);
});
