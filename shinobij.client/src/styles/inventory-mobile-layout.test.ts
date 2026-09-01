import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const inventoryCss = readFileSync(new URL("./inventory-aaa.css", import.meta.url), "utf8");
const profileCss = readFileSync(new URL("./profile-skin.css", import.meta.url), "utf8");

test("mobile backpack artwork cannot overlap item copy", () => {
    assert.match(profileCss, /grid-template-rows:\s*auto minmax\(0, 1fr\) auto !important/);
    assert.match(profileCss, /object-fit:\s*contain !important/);
    assert.match(inventoryCss, /@media \(max-width: 720px\)[\s\S]*\.inventory-page \.inventory-backpack-panel \.backpack-item \{[\s\S]*grid-template-rows:\s*96px minmax\(0, 1fr\) auto !important/);
    assert.match(inventoryCss, /\.inventory-page \.inventory-backpack-panel \.backpack-item-art \{[\s\S]*height:\s*96px !important;[\s\S]*aspect-ratio:\s*auto/);
});
