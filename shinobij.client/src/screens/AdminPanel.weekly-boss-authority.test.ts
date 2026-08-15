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
        assert.ok(next > prior, `expected ${marker} after ${prior >= 0 ? markers[markers.indexOf(marker) - 1] : "block start"}`);
        prior = next;
    }
}

describe("AdminPanel Weekly Boss authority", () => {
    it("keeps AI authoring content-accessible while projecting full-admin boss operations", () => {
        assert.match(source, /const canOperateWeeklyBoss = adminRole === 'full';/);
        assert.match(source, /\{activeAdminPanel === "aiCreator" && \(/,
            "the AI authoring panel must remain available to content admins");
        const aiPanel = sourceBetween(
            '{activeAdminPanel === "aiCreator" && (',
            '{activeAdminPanel === "jutsuBloodlines" && (',
        );
        assert.match(aiPanel, /\{canOperateWeeklyBoss && \(\s*<>\s*<h3>Weekly Boss<\/h3>/s,
            "only the Weekly Boss operation section is full-admin projected");
        assert.equal(aiPanel.match(/disabled=\{!canOperateWeeklyBoss \|\| weeklyBossOperationBusy/g)?.length, 3);
    });

    it("guards callbacks and reports success only after awaited 2xx results", () => {
        const begin = sourceBetween("function beginWeeklyBossOperation", "function finishWeeklyBossOperation");
        assert.match(begin, /const operationToken = weeklyBossOperationFence\.begin\(\);[\s\S]*if \(!operationToken\) return null;/);
        assert.match(source, /weeklyBossOperationFence\.syncContext\(\{ adminCredential: adminPw, adminRole \}\);/,
            "credential or role replacements must synchronously retire delayed continuations");
        assert.match(source, /useLayoutEffect\(\(\) => \{\s*weeklyBossOperationFence\.activate\(\);[\s\S]*return \(\) => \{[\s\S]*weeklyBossOperationFence\.dispose\(\);[\s\S]*bloodlineEditOperationEpochRef\.current \+= 1;[\s\S]*\};/,
            "layout-synchronous unmount cleanup must retire delayed operation continuations");

        const setOverride = sourceBetween("async function setWeeklyBossOverride", "async function clearWeeklyBossOverride");
        assertOrdered(setOverride, [
            "await persistAdminWeeklyBossOverride",
            "if (!weeklyBossOperationIsCurrent(operationToken)) return;",
            "if (!result.ok)",
            "Override set to",
        ]);

        const clearOverride = sourceBetween("async function clearWeeklyBossOverride", "async function spawnWeeklyBossNow");
        assertOrdered(clearOverride, [
            "await persistAdminWeeklyBossOverride",
            "if (!weeklyBossOperationIsCurrent(operationToken)) return;",
            "if (!result.ok)",
            "Override cleared.",
        ]);

        const spawn = sourceBetween("async function spawnWeeklyBossNow", "// Tabs Admin 2");
        assertOrdered(spawn, [
            "await spawnAdminWeeklyBoss",
            "if (!weeklyBossOperationIsCurrent(operationToken)) return;",
            "if (!result.ok)",
            "Boss spawned:",
        ]);
        assert.doesNotMatch(source, /persistSharedGameState\(\{ kind: "weeklyBossOverride"/,
            "Weekly Boss override writes must not use the fire-and-forget shared-state helper");
    });
});
