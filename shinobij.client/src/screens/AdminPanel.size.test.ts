import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const screensDirectory = join(process.cwd(), "shinobij.client", "src", "screens");

function sourceLineCount(fileName: string): number {
    return readFileSync(join(screensDirectory, fileName), "utf8").trimEnd().split(/\r?\n/).length;
}

describe("AdminPanel source budgets", () => {
    it("keeps the parent under its post-extraction growth and hard limits", () => {
        // 6,634 -> 6,629 (2026-09-11): the Dojo Circuit's World Events tab put the
        // parent at 6,644, five over. EditableVnPage moved verbatim to types/vn.
        const measuredPostExtractionLines = 6629;
        const maximumLines = Math.min(measuredPostExtractionLines + 5, 6745);
        assert.ok(sourceLineCount("AdminPanel.tsx") <= maximumLines, `AdminPanel.tsx exceeds ${maximumLines} lines`);
    });

    it("keeps the Village Leaders render leaf focused", () => {
        assert.ok(sourceLineCount("AdminVillageLeadersPanel.tsx") <= 150, "AdminVillageLeadersPanel.tsx exceeds 150 lines");
    });
});
