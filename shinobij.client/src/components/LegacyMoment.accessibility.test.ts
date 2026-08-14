import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const moment = readFileSync(new URL("./LegacyMoment.tsx", import.meta.url), "utf8");
const modal = readFileSync(new URL("./ui/Modal.tsx", import.meta.url), "utf8");
const ceremonyCss = readFileSync(new URL("./RankUpCelebration.css", import.meta.url), "utf8");
const legacyPanel = readFileSync(new URL("../screens/LegacyPanel.tsx", import.meta.url), "utf8");

test("LegacyMoment delegates its complete dialog lifecycle to the canonical modal", () => {
    assert.match(moment, /import \{ Modal \} from "\.\/ui\/Modal"/);
    assert.match(moment, /<Modal[\s\S]*?open[\s\S]*?ariaLabel=/);
    assert.match(moment, /disableBackdropClose=\{!dismissible\}/);
    assert.match(moment, /disableEscapeClose=\{!dismissible\}/);
    assert.doesNotMatch(moment, /createPortal|role="dialog" aria-modal="true"|autoFocus/);

    assert.match(modal, /const previouslyFocused = document\.activeElement/);
    assert.match(modal, /e\.key === "Tab"/);
    assert.match(modal, /disableEscapeCloseRef\.current/);
    assert.match(modal, /e\.stopImmediatePropagation\(\)/);
    assert.match(modal, /syncModalBackgroundInert\(\)/);
    assert.match(modal, /queueMicrotask\(\(\) => previouslyFocused\?\.focus\(\)\)/);
});

test("Legacy ceremony content remains reachable at 200% zoom and short landscape heights", () => {
    assert.match(ceremonyCss, /\.rankup-card \{[\s\S]*?max-height: calc\(100dvh - 32px\);[\s\S]*?overflow-y: auto;[\s\S]*?overscroll-behavior: contain;/);
    assert.match(ceremonyCss, /\.legacy-moment-card \.ui-modal-body--bare \{[\s\S]*?overflow-y: auto;[\s\S]*?overscroll-behavior: contain;/);
    assert.match(ceremonyCss, /@media \(max-height: 520px\), \(max-width: 480px\)/);
});

test("Legacy trial feedback is announced without moving keyboard focus", () => {
    assert.match(legacyPanel, /\{trialNote && <p role="status" aria-live="polite" aria-atomic="true"/);
});
