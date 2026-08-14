import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const coliseum = readFileSync(new URL("./PetColiseum.tsx", import.meta.url), "utf8");
const arena = readFileSync(new URL("../screens/PetArena.tsx", import.meta.url), "utf8");
const witnessProgress = readFileSync(new URL("./PetChronicleProgress.tsx", import.meta.url), "utf8");

test("Pet Coliseum result is a trapped modal boundary that restores the battle safely", () => {
    assert.match(coliseum, /ref=\{resultDialogRef\} role="dialog" aria-modal="true" aria-label=\{`\$\{resultLabel\}: Pet Coliseum result`\} tabIndex=\{-1\}/);
    assert.match(coliseum, /dialog\?\.closest<HTMLElement>\("\[data-testid='pet-duel-root'\]"\)/);
    assert.match(coliseum, /snapshot\.element\.inert = true;[\s\S]*?snapshot\.element\.setAttribute\("aria-hidden", "true"\)/);
    assert.match(coliseum, /event\.key === "Escape"[\s\S]*?event\.preventDefault\(\)[\s\S]*?event\.stopImmediatePropagation\(\)/);
    assert.match(coliseum, /event\.key !== "Tab"/);
    assert.match(coliseum, /document\.addEventListener\("focusin", onFocusIn, true\)/);
    assert.match(coliseum, /snapshot\.element\.inert = snapshot\.inert/);
    assert.match(coliseum, /previouslyFocused\?\.isConnected/);
});

test("Pet Coliseum result and Chronicle ceremony remain reachable at mobile width and 200% zoom", () => {
    assert.match(coliseum, /overflowY: "auto", overscrollBehavior: "contain"/);
    assert.match(coliseum, /env\(safe-area-inset-top\)[\s\S]*?env\(safe-area-inset-bottom\)/);
    assert.match(coliseum, /width: "min\(620px, 100%\)", margin: "auto",[\s\S]*?boxSizing: "border-box"/);
    const dialogStart = coliseum.indexOf('role="dialog" aria-modal="true"');
    assert.ok(coliseum.indexOf("{resultSupplement}", dialogStart) > dialogStart);
    assert.match(arena, /resultSupplement=\{duelChronicleResultSupplement\}/);
    assert.match(arena, /chronicleProgress \? <PetChronicleProgress receipt=\{chronicleProgress\} \/> : null/);
    assert.match(witnessProgress, /role="status" aria-live="polite" aria-atomic="true"/);
    assert.match(witnessProgress, /<progress[\s\S]*?aria-label=[\s\S]*?max=\{entry\.threshold\}[\s\S]*?value=\{Math\.min\(entry\.wins, entry\.threshold\)\}/);
});
