import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const coliseum = readFileSync(new URL("./PetColiseum.tsx", import.meta.url), "utf8");
const arena = readFileSync(new URL("../screens/PetArena.tsx", import.meta.url), "utf8");
const showdownBattle = readFileSync(new URL("./PetShowdownBattle.tsx", import.meta.url), "utf8");
const showdownStyles = readFileSync(new URL("../screens/PetShowdown.css", import.meta.url), "utf8");
const witnessProgress = readFileSync(new URL("./PetChronicleProgress.tsx", import.meta.url), "utf8");

test("Pet Coliseum result is a trapped modal boundary that restores the battle safely", () => {
    assert.match(coliseum, /ref=\{resultDialogRef\} role="dialog" aria-modal="true" aria-label=\{`\$\{resultLabel\}: Pet Colosseum result`\} tabIndex=\{-1\}/);
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
    // The duel screen no longer mounts the coliseum overlay, so its receipt no
    // longer rides that component's `resultSupplement` slot. It gets its own
    // portal ABOVE the replay player — which portals itself fullscreen to
    // document.body, so an ordinary sibling would put a won card behind the
    // battle. Same reachability guarantees, asserted on the new host: it scrolls
    // on its own, honours the safe-area insets, and is width-capped and centred.
    assert.match(arena, /watchedDuel && duelChronicleResultSupplement && createPortal/);
    assert.match(arena, /overflowY: "auto", overscrollBehavior: "contain"/);
    assert.match(arena, /env\(safe-area-inset-top\)[\s\S]*?env\(safe-area-inset-bottom\)/);
    assert.match(arena, /width: "min\(620px, 100%\)", margin: "auto", boxSizing: "border-box"/);
    assert.match(arena, /role="dialog"[\s\S]*?aria-modal="true"/);
    assert.match(arena, /chronicleProgress \? <PetChronicleProgress receipt=\{chronicleProgress\} \/> : null/);
    assert.match(witnessProgress, /role="status" aria-live="polite" aria-atomic="true"/);
    assert.match(witnessProgress, /<progress[\s\S]*?aria-label=[\s\S]*?max=\{entry\.threshold\}[\s\S]*?value=\{Math\.min\(entry\.wins, entry\.threshold\)\}/);
});

test("Pet Arena does not preload the retired Coliseum renderer", () => {
    assert.doesNotMatch(arena, /import\("\.\.\/components\/PetColiseum"\)/);
    assert.match(arena, /const PetShowdownReplay = lazyWithRetry/);
    assert.match(arena, /const PetWarfrontMatch = lazyWithRetry/);
});

test("the shared Showdown battle owns the stylesheet that constrains its fullscreen replay", () => {
    assert.match(showdownBattle, /import "\.\.\/screens\/PetShowdown\.css";/);
    assert.match(showdownBattle, /className="pet-combat-takeover showdown-takeover"/);
    assert.match(showdownStyles, /\.showdown-takeover\s*\{[^}]*background:/);
    assert.match(showdownStyles, /\.showdown-vs-side img\s*\{[^}]*width:\s*84px;[^}]*height:\s*84px;/);
    assert.match(showdownStyles, /\.showdown-result\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;/);
});
