import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./NindoEditor.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/profile-skin.css", import.meta.url), "utf8");

test("Nindo footer owns a responsive action group instead of relying on generic menu sizing", () => {
    assert.match(source, /className="nindo-editor-foot"/);
    assert.match(source, /className="nindo-editor-actions"/);
    assert.match(source, /className="hint nindo-editor-count"/);

    assert.match(css, /\.profile-page-card \.nindo-editor-foot\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*max-content minmax\(0, 1fr\);/s);
    assert.match(css, /\.profile-page-card \.nindo-editor-actions\s*\{[^}]*grid-template-columns:\s*minmax\(76px, 0\.72fr\) minmax\(112px, 1\.28fr\);[^}]*width:\s*min\(100%, 240px\);/s);
    assert.match(css, /\.profile-page-card \.nindo-editor-actions > \.profile-title-btn\s*\{[^}]*width:\s*100% !important;[^}]*min-width:\s*0 !important;[^}]*min-height:\s*44px;/s);
});

test("Nindo actions stack safely on very narrow phones", () => {
    assert.match(css, /@media \(max-width: 359px\)\s*\{[\s\S]*?\.profile-page-card \.nindo-editor-foot\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/);
    assert.match(css, /@media \(max-width: 359px\)\s*\{[\s\S]*?\.profile-page-card \.nindo-editor-actions\s*\{[^}]*width:\s*100%;/);
});

test("Nindo formatting and banner controls keep phone-size touch targets", () => {
    assert.match(source, /className="nindo-bg-option"/);
    assert.match(source, /aria-pressed=\{bg === b\.id\}/);
    assert.match(css, /\.profile-page-card \.nindo-toolbar > button\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/s);
    assert.match(css, /\.profile-page-card \.nindo-bg-option\s*\{[^}]*width:\s*58px;[^}]*height:\s*44px;[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/s);
});
