import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// "What's New" only opens PatchNotesModal, which renders nothing when the
// registry is empty (it has been since 2026-10-13). Shown then, it would be a
// button that does nothing. ProgressionPanel imports its stylesheet, so it
// cannot render under node:test (scripts/test-asset-hooks.mjs); read the source.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the What's New button renders only when there is a patch note to open", () => {
    const panel = read("./ProgressionPanel.tsx");
    const buttons = panel.match(/<button[^>]*className="prog-whatsnew"/g) ?? [];
    assert.equal(buttons.length, 1, "exactly one What's New button");
    assert.match(panel, /\{LATEST_PATCH_NOTE && <button type="button" className="prog-whatsnew"/);
    assert.match(read("./PatchNotesModal.tsx"), /if \(!LATEST_PATCH_NOTE\) return null;/, "the modal it opens shows nothing without a note");
});
