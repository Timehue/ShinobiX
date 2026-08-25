import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hint = readFileSync(new URL("./ScreenHint.tsx", import.meta.url), "utf8");
const combatCss = readFileSync(new URL("../styles/battle-skin.css", import.meta.url), "utf8");

test("ambient screen hints collapse to an operable combat-safe help control", () => {
    assert.match(hint, /className=\{`onboarding-coach-banner screen-hint-banner screen-hint-collapsed screen-hint-\$\{screen\}`\}/);
    assert.match(hint, /className="screen-hint-battle-trigger"[\s\S]*?aria-label=\{`Review \$\{subject\} tip`\}[\s\S]*?aria-haspopup="dialog"[\s\S]*?aria-expanded=\{detailsOpen\}/);
    assert.match(hint, /<Modal[\s\S]*?backdropClassName="screen-hint-modal-backdrop"[\s\S]*?<p className="screen-hint-dialog-copy">\{text\}<\/p>/);
    assert.match(hint, /className="start-primary-btn" onClick=\{dismiss\}>Got it<\/button>/);

    assert.match(combatCss, /body:has\(> \.combat-instance\) > \.screen-hint-banner\s*\{[\s\S]*?top:[^;]+!important;[\s\S]*?right:[^;]+!important;[\s\S]*?bottom:\s*auto\s*!important;/);
    assert.match(combatCss, /body:has\(> \.combat-instance\) > \.screen-hint-banner > \.screen-hint-inline\s*\{[\s\S]*?display:\s*none\s*!important;/);
    const triggerRule = combatCss.match(/body:has\(> \.combat-instance\) > \.screen-hint-banner > \.screen-hint-battle-trigger\s*\{([\s\S]*?)\}/);
    assert.ok(triggerRule, "combat hint trigger needs a dedicated responsive rule");
    assert.match(triggerRule[1], /display:\s*inline-flex\s*!important/);
    assert.match(triggerRule[1], /min-width:\s*44px/);
    assert.match(triggerRule[1], /min-height:\s*44px/);
    assert.match(triggerRule[1], /pointer-events:\s*auto/);
});

test("expanded combat help uses the canonical trapped modal above the combat HUD", () => {
    assert.match(hint, /import \{ Modal \} from "\.\/ui\/Modal"/);
    assert.match(combatCss, /\.screen-hint-modal-backdrop\s*\{[\s\S]*?z-index:\s*9100\s*!important;/);
});

test("ambient screen hints cannot block gameplay controls beneath the notice", () => {
    assert.match(hint, /const bannerStyle:[\s\S]*?pointerEvents:\s*"none"/);
    assert.match(hint, /className="screen-hint-inline" style=\{\{ display:\s*"none" \}\}/);
    assert.match(hint, /const triggerStyle:[\s\S]*?minWidth:\s*44[\s\S]*?minHeight:\s*44[\s\S]*?pointerEvents:\s*"auto"/);
    assert.match(hint, /className="screen-hint-battle-trigger"[\s\S]*?style=\{triggerStyle\}/);
});
