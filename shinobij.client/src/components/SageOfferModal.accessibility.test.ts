import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./SageOfferModal.tsx", import.meta.url), "utf8");

test("a legal single Sage offer is selected and uses separate native controls", () => {
    assert.match(source, /offer\.offers\.length === 1 \? offer\.offers\[0\]\.legacyId : null/);
    assert.match(source, /<article[\s\S]*?<button[\s\S]*?type="button"[\s\S]*?aria-label=\{`Select \$\{o\.name\}`\}[\s\S]*?aria-pressed=\{selected === o\.legacyId\}/);
    assert.doesNotMatch(source, /role="button"|tabIndex=\{0\}|onKeyDown=/);
    assert.match(source, /onClick=\{\(\) => setSelected\(o\.legacyId\)\}/);
    assert.match(source, /<\/button>\s*\{selected === o\.legacyId && \(\s*<button/);
    assert.match(source, /Accept This Path/);
    assert.match(source, /mountedRef\.current = true;[\s\S]*?requestRef\.current \+= 1;[\s\S]*?window\.clearTimeout\(departureTimerRef\.current\)/);
    assert.match(source, /if \(!mountedRef\.current \|\| request !== requestRef\.current\) return;/);
    assert.match(source, /scheduleDeparture\(\(\) => \{ \(onDismissed \?\? onDeclined\)\(\); onClose\(\); \}\)/);
    assert.doesNotMatch(source, /setTimeout\(\(\) => \{ \(onDismissed/);
    assert.match(source, /\{note && \([\s\S]*?<p role="alert" aria-live="assertive" aria-atomic="true"/);
});
