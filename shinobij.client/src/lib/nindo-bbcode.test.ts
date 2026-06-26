/*
 * nindo-bbcode is the trust boundary for player-authored profile content shown
 * to other players. These tests lock in that boundary by exercising the three
 * XSS gates directly (URL scheme / colour / size) and asserting the renderer
 * never reaches for a raw-HTML sink. (The render path itself emits only a fixed,
 * known-safe set of React elements — never raw HTML — so there is structurally
 * no way for a tag/attribute we don't allow to reach the DOM.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { safeUrl, safeColor, clampSize, renderNindo } from "./nindo-bbcode";

test("safeUrl accepts only http(s); rejects javascript:/data:/relative/protocol-relative", () => {
    assert.equal(safeUrl("https://example.com/a.png"), "https://example.com/a.png");
    assert.equal(safeUrl("http://x.test/y"), "http://x.test/y");
    assert.equal(safeUrl("javascript:alert(1)"), undefined);
    assert.equal(safeUrl("data:text/html,<script>1</script>"), undefined);
    assert.equal(safeUrl("data:image/svg+xml,<svg onload=alert(1)>"), undefined);
    assert.equal(safeUrl("vbscript:msgbox(1)"), undefined);
    assert.equal(safeUrl("/relative/path"), undefined);
    assert.equal(safeUrl("//evil.test/x"), undefined);
    assert.equal(safeUrl("  javascript:alert(1)  "), undefined);
});

test("safeColor accepts hex or allowlisted names; rejects CSS injection", () => {
    assert.equal(safeColor("red"), "red");
    assert.equal(safeColor("GOLD"), "gold");
    assert.equal(safeColor("#ff0000"), "#ff0000");
    assert.equal(safeColor("#abc"), "#abc");
    assert.equal(safeColor("red;background:url(/evil)"), undefined);
    assert.equal(safeColor("url(x)"), undefined);
    assert.equal(safeColor("expression(alert(1))"), undefined);
    assert.equal(safeColor("#ff0000;}body{display:none"), undefined);
});

test("clampSize clamps to a sane px range and rejects junk", () => {
    assert.equal(clampSize("22"), 22);
    assert.equal(clampSize("999"), 28); // clamped to MAX
    assert.equal(clampSize("1"), 11); // clamped to MIN
    assert.equal(clampSize("abc"), undefined);
    assert.equal(clampSize(undefined), undefined);
});

test("renderNindo returns null for empty input", () => {
    assert.equal(renderNindo(""), null);
});

test("the renderer never uses a raw-HTML injection sink", () => {
    // The entire safety model rests on NEVER injecting raw HTML. Strip comments
    // (the header doc deliberately names these sinks) then assert the live code
    // contains none of them. If this ever trips, the security review must too.
    const file = fileURLToPath(new URL("./nindo-bbcode.tsx", import.meta.url));
    const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(code, /dangerouslySetInnerHTML/);
    assert.doesNotMatch(code, /\binnerHTML\b/);
    assert.doesNotMatch(code, /\bouterHTML\b/);
});
