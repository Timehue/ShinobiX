import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const source = readFileSync(join(process.cwd(), "shinobij.client", "src", "screens", "AdminPanel.tsx"), "utf8");

function slice(start: string, end: string): string {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.notEqual(from, -1, `missing start anchor: ${start}`);
    assert.notEqual(to, -1, `missing end anchor: ${end}`);
    return source.slice(from, to);
}

describe("AdminPanel bloodline owner wiring", () => {
    it("selects and renders bloodlines by composite owner plus id", () => {
        assert.match(source, /selectedBloodlineOwnerId/);
        assert.match(source, /findAdminBloodlineByOwnerId\(sortedBloodlines, selectedBloodlineOwnerId\)/);
        assert.match(source, /value=\{selectedBloodline \? adminBloodlineOwnerId\(selectedBloodline\) : ""\}/);
        assert.match(source, /const ownerId = adminBloodlineOwnerId\(bloodline\)/);
        assert.match(source, /<option key=\{ownerId\} value=\{ownerId\}>/);
    });

    it("loads the exact composite record before an edit and updates only that player owner", () => {
        const saveEdit = slice("async function saveAdminBloodlineEdit()", "// Stat-derived leveling");
        assert.match(saveEdit, /const editingOwnerId = adminBloodlineOwnerId\(/);
        assert.match(saveEdit, /findAdminBloodlineByOwnerId\(adminPanelBloodlines, editingOwnerId\)/);
        assert.match(saveEdit, /if \(activeBloodlineEditRef\.current\) return alert/);
        assert.match(saveEdit, /if \(!operationIsCurrent\(\)\) return/);
        assert.match(saveEdit, /await fetchAllKnownPlayersIfCurrent\(operationIsCurrent\)/);
        assert.match(saveEdit, /activeBloodlineEditRef\.current === operation/);
        assert.match(saveEdit, /sameAdminBloodlineOwner\(bloodline, sourceBloodline\)/);
        assert.doesNotMatch(saveEdit, /adminPanelBloodlines\.find\([^)]*\.id === editingBloodlineId/);
        assert.match(source, /editingBloodlineOwnerIdRef\.current = ownerId;\s*setSelectedBloodlineOwnerId\(ownerId\)/);
    });

    it("does not publish or mutate an id-only admin image while editing a player bloodline", () => {
        const imageDraft = slice("function applyBloodlineImage", "function setVnPageImage");
        assert.doesNotMatch(imageDraft, /publishSharedImage/);
        assert.doesNotMatch(imageDraft, /setSavedBloodlines/);
        assert.match(imageDraft, /const ownerId = editingBloodlineOwnerIdRef\.current/);
        assert.match(imageDraft, /const imageEpoch = \+\+bloodlineEditImageEpochRef\.current/);
        assert.match(imageDraft, /editingBloodlineOwnerIdRef\.current !== ownerId/);
        assert.match(imageDraft, /bloodlineEditImageEpochRef\.current !== imageEpoch/);
        assert.match(source, /!selectedBloodline\.image && selectedBloodlineIsAdmin/);
        assert.match(source, /selectedBloodlineIsSavedAdmin/);
        assert.match(source, /canonicalBloodlineOwnerKey\(bloodline\.ownerKey\) === ADMIN_BLOODLINE_OWNER_KEY\s*\? bloodline\.image \?\? ""\s*:\s*bloodline\.ownerImage \?\? ""/);
    });

    it("deduplicates review rows by composite identity instead of bloodline id", () => {
        const projection = slice("const reviewBloodlines", "function updateLeadershipImage");
        assert.match(projection, /sameAdminBloodlineOwner/);
        assert.doesNotMatch(projection, /existing\.id === bloodline\.id/);
    });

    it("keeps legacy review edit and bulk-image paths owner-aware", () => {
        assert.match(source, /loadAdminBloodline\(bl\);\s*setActiveAdminPanel\("jutsuBloodlines"\)/);
        assert.doesNotMatch(source, /onEditBloodline\?\.\(/);
        const bulk = slice("<h4>Bulk Bloodline Image Generation</h4>", "</section>");
        assert.match(bulk, /adminOwnedPanelBloodlines\.filter/);
        assert.doesNotMatch(bulk, /adminPanelBloodlines\.filter/);
    });

    it("promotes player content under fresh admin-owned bloodline and jutsu ids", () => {
        const approval = slice("async function pmApproveBloodline", "async function pmDeleteBloodline");
        assert.match(approval, /prepareAdminBloodlineApproval/);
        assert.match(approval, /bloodlineApprovalInFlightRef\.current\.has\(reviewKey\)/);
        assert.match(approval, /bloodlineApprovalInFlightRef\.current\.delete\(reviewKey\)/);
    });
});
