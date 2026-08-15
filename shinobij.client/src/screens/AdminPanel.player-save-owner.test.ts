import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const source = readFileSync(join(process.cwd(), "shinobij.client", "src", "screens", "AdminPanel.tsx"), "utf8");

function sourceBetween(start: string, end: string): string {
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex + start.length);
    assert.ok(startIndex >= 0, `missing source marker: ${start}`);
    assert.ok(endIndex > startIndex, `missing source marker after ${start}: ${end}`);
    return source.slice(startIndex, endIndex);
}

function assertOrdered(block: string, markers: string[]) {
    let prior = -1;
    for (const marker of markers) {
        const next = block.indexOf(marker, prior + 1);
        assert.ok(next > prior, `expected ${marker} after ${markers[Math.max(0, markers.indexOf(marker) - 1)]}`);
        prior = next;
    }
}

describe("AdminPanel player-save owner wiring", () => {
    it("invalidates every shared player target control through one handler", () => {
        assert.equal(
            source.match(/onChange=\{e => changePmTargetName\(e\.target\.value\)\}/g)?.length,
            4,
            "the account select, grant, subscription, and reset controls must share target invalidation",
        );
        assert.equal(
            source.match(/onChange=\{e => changePmEditName\(e\.target\.value\)\}/g)?.length,
            1,
            "the stat editor target must use its fenced invalidation handler",
        );
        assert.doesNotMatch(source, /onChange=\{e => setPm(?:TargetName|EditName)\(e\.target\.value\)/);
    });

    it("owner-tags both snapshots and fences both lookup responses", () => {
        assert.match(source, /useState<LoadedAdminPlayerSave \| null>/);
        assert.equal(source.match(/const lookupIsCurrent = \(\) => isAdminPlayerLookupCurrent\(/g)?.length, 2);

        const lookup = sourceBetween("async function pmLookup()", "async function pmGive()");
        assert.equal(lookup.match(/if \(!lookupIsCurrent\(\)\) return;/g)?.length, 2);
        assertOrdered(lookup, [
            "const res = await fetch(adminPlayerSaveUrl(ownerKey)",
            "if (!lookupIsCurrent()) return;",
            "data = await res.json()",
            "if (!lookupIsCurrent()) return;",
            "const loaded = tagLoadedAdminPlayerSave(ownerKey, data)",
            "Loaded save identity did not match the requested player.",
            "setPmLoadedSave(loaded)",
        ]);

        const editLookup = sourceBetween("async function pmEditLookup()", "async function pmEditPatch");
        assert.equal(editLookup.match(/if \(!lookupIsCurrent\(\)\) return;/g)?.length, 2);
        assertOrdered(editLookup, [
            "const res = await fetch(adminPlayerSaveUrl(ownerKey)",
            "if (!lookupIsCurrent()) return;",
            "const data = await res.json()",
            "if (!lookupIsCurrent()) return;",
            "const loaded = tagLoadedAdminPlayerSave(ownerKey, data)",
            "Loaded save identity did not match the requested player.",
            "setPmEditLoadedSave(loaded)",
        ]);
    });

    it("invalidates delayed lookups on credential/role changes and unmount", () => {
        const giveFence = sourceBetween("function setPmLoadedSave", "function playerWriteIdentityMessage");
        assert.match(giveFence, /useEffect\(\(\) => \{\s*invalidatePmLookup\(\)/s);
        assert.match(giveFence, /pmLookupEpochRef\.current \+= 1;\s*pmLoadedSaveRef\.current = null;/s);
        assert.match(giveFence, /\}, \[adminPw, adminRole\]\);/);

        const editFence = sourceBetween("function setPmEditLoadedSave", "async function pmEditLookup");
        assert.match(editFence, /useEffect\(\(\) => \{\s*invalidatePmEditLookup\(\)/s);
        assert.match(editFence, /pmEditLookupEpochRef\.current \+= 1;\s*pmEditLoadedSaveRef\.current = null;/s);
        assert.match(editFence, /\}, \[adminPw, adminRole\]\);/);
    });

    it("derives grant and edit writes from the loaded owner after identity validation", () => {
        const grant = sourceBetween("async function pmGive()", "// --- Comp/grant a Shinobi Supporter subscription");
        assert.match(grant, /prepareAdminPlayerSaveWrite\(loaded, pmTargetNameRef\.current/);
        assert.match(grant, /adminPlayerSaveUrl\(finalCheck\.write\.ownerKey, true\)/);
        assert.match(grant, /stringifyServerSavePayload\(finalCheck\.write\.snapshot\)/);
        assert.doesNotMatch(grant, /fetch\(`\/api\/save\//, "the grant route must not come from mutable input");
        assert.match(grant, /pmLoadedSaveRef\.current !== loaded/);
        assertOrdered(grant, [
            "if (!res.ok)",
            "invalidatePmLookup();",
            "Look up the player again before making another change.",
        ]);

        const edit = sourceBetween("async function pmEditPatch", "async function pmEditSave");
        assert.match(edit, /pmEditLoadedSaveRef\.current !== loaded/);
        assert.match(edit, /prepareAdminPlayerSaveWrite\(loaded, pmEditNameRef\.current, updatedSnap\)/);
        assert.match(edit, /adminPlayerSaveUrl\(checked\.write\.ownerKey, true\)/);
        assert.match(edit, /stringifyServerSavePayload\(checked\.write\.snapshot\)/);
        assert.doesNotMatch(edit, /fetch\(`\/api\/save\//, "the edit route must not come from mutable input");
        assertOrdered(edit, [
            "if (!res.ok)",
            "invalidatePmEditLookup();",
            "Look up the player again before making another change.",
        ]);
    });

    it("serializes all four player mutations through one synchronous operation fence", () => {
        assert.match(source, /const pmMutationInFlightRef = useRef\(false\)/);
        assert.match(source, /const pmMutationEpochRef = useRef\(0\)/);
        assert.match(source, /const pmMutationActiveEpochRef = useRef<number \| null>\(null\)/);
        assert.equal(source.match(/const mutation = beginPmMutation\(/g)?.length, 4);
        assert.match(source, /function beginPmMutation\([\s\S]*if \(pmMutationInFlightRef\.current\) return null;[\s\S]*pmMutationActiveEpochRef\.current = mutation\.epoch;[\s\S]*pmMutationInFlightRef\.current = true;/);
        assert.match(
            source,
            /function finishPmMutation\([\s\S]*if \(pmMutationActiveEpochRef\.current !== mutation\.epoch\) return;[\s\S]*pmMutationActiveEpochRef\.current = null;[\s\S]*pmMutationInFlightRef\.current = false;/,
            "a retired completion must not release a newer session's active mutation",
        );

        for (const [start, end] of [
            ["async function pmGive()", "// --- Comp/grant a Shinobi Supporter subscription"],
            ["async function pmEditPatch", "async function pmEditSave"],
            ["async function pmSoftReset()", "async function pmReset()"],
            ["async function pmReset()", "async function loadRankedSeasonStatus"],
        ]) {
            const operation = sourceBetween(start, end);
            assert.match(operation, /const mutation = beginPmMutation\(/);
            assert.match(operation, /finally \{\s*finishPmMutation\(mutation\);/s);
        }
    });

    it("fences every mutation completion before updating the current view", () => {
        const grant = sourceBetween("async function pmGive()", "// --- Comp/grant a Shinobi Supporter subscription");
        assertOrdered(grant, [
            "await gameConfirm",
            "if (!pmMutationIsCurrent(mutation) || !confirmed) return;",
            "await fetch(adminPlayerSaveUrl",
            "if (!pmMutationIsCurrent(mutation)) return;",
            "await res.json()",
            "if (!pmMutationIsCurrent(mutation)) return;",
        ]);

        const edit = sourceBetween("async function pmEditPatch", "async function pmEditSave");
        assertOrdered(edit, [
            "await fetch(adminPlayerSaveUrl",
            "if (!pmMutationIsCurrent(mutation)) return;",
            "await res.json()",
            "if (!pmMutationIsCurrent(mutation)) return;",
            "invalidatePmEditLookup();",
            "fetchAllKnownPlayersIfCurrent(() => pmMutationIsCurrent(mutation))",
        ]);

        const softReset = sourceBetween("async function pmSoftReset()", "async function pmReset()");
        assert.equal(softReset.match(/if \(!pmMutationIsCurrent\(mutation\)\)/g)?.length, 4);
        assertOrdered(softReset, [
            "await gameConfirm",
            "if (!pmMutationIsCurrent(mutation) || !confirmed) return;",
            "await fetch(adminPlayerSaveUrl(mutation.ownerKey)",
            "if (!pmMutationIsCurrent(mutation)) return;",
            "await res.json()",
            "if (!pmMutationIsCurrent(mutation)) return;",
            "await fetch(adminPlayerSaveUrl(checked.write.ownerKey, true)",
            "if (!pmMutationIsCurrent(mutation)) return;",
            "invalidatePmLookup();",
            "fetchAllKnownPlayersIfCurrent(() => pmMutationIsCurrent(mutation))",
        ]);

        const reset = sourceBetween("async function pmReset()", "async function loadRankedSeasonStatus");
        assertOrdered(reset, [
            "await gameConfirm",
            "if (!pmMutationIsCurrent(mutation) || !confirmed) return;",
            "await fetch(adminPlayerSaveUrl(mutation.ownerKey)",
            "if (!pmMutationIsCurrent(mutation)) return;",
            "await res.json()",
            "if (!pmMutationIsCurrent(mutation)) return;",
            "invalidatePmLookup();",
            "fetchAllKnownPlayersIfCurrent(() => pmMutationIsCurrent(mutation))",
        ]);
    });

    it("invalidates mutation epochs on either target, credential/role changes, and unmount", () => {
        assert.match(sourceBetween("function changePmTargetName", "useEffect"), /invalidatePmMutationContext\(\)/);
        assert.match(sourceBetween("function changePmEditName", "useEffect"), /invalidatePmMutationContext\(\)/);
        assert.match(source, /useEffect\(\(\) => \{\s*invalidatePmMutationContext\(\);\s*return \(\) => \{\s*invalidatePmMutationContext\(\);\s*pmMutationActiveEpochRef\.current = null;\s*pmMutationInFlightRef\.current = false;\s*\};\s*\}, \[adminPw, adminRole\]\);/s);
    });
});
