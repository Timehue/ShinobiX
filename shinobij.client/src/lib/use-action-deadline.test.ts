import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the live deadline hook only subscribes to the 1s clock while a cooldown is ahead", () => {
    const source = read("./use-action-deadline.ts");
    assert.match(source, /const live = deadline > getSharedNow\(\);/);
    assert.match(source, /useSyncExternalStore\(live \? subscribeSharedNow : noSubscription, getSharedNow, getSharedNow\)/);
    assert.match(source, /return Math\.max\(0, deadline - now\);/);
});

// A render-time clock read: the UTC day behind the daily counters, the Apex ISO
// week, a countdown. Event handlers read the clock when they run and are exempt.
const CLOCK_READ = /\b(?:currentDateKey|dailyMissionsCompleted|hasDailyMissionSlot|dailyHuntsCompleted|hasDailyHuntSlot|isoWeekKey|timeLeftLabel|serverNow|getSharedNow|useSharedNow)\(|Date\.now\(\)|new Date\(\)/g;

function closingIndex(source: string, openAt: number, open: string, close: string): number {
    let depth = 0;
    for (let at = openAt; at < source.length; at += 1) {
        if (source[at] === open) depth += 1;
        else if (source[at] === close && --depth === 0) return at;
    }
    throw new Error(`unbalanced ${open}${close} at ${openAt}`);
}

/**
 * The component's body with its nested handler functions and every
 * SharedClockLeaf's children blanked out: whatever clock read is left would
 * only refresh when something else re-renders the whole screen.
 */
function clockReadsOutsideLeaves(source: string, component: string): string[] {
    const body = source.slice(source.indexOf(`export function ${component}(`));
    const exempt: Array<[number, number]> = [];
    for (const handler of body.matchAll(/\n[ ]+(?:async )?function \w+[^(]*\(/g)) {
        const paramsClose = closingIndex(body, handler.index + handler[0].length - 1, "(", ")");
        exempt.push([handler.index, closingIndex(body, body.indexOf("{", paramsClose), "{", "}")]);
    }
    for (let at = body.indexOf("<SharedClockLeaf>"); at !== -1; at = body.indexOf("<SharedClockLeaf>", at + 1)) {
        exempt.push([at, body.indexOf("</SharedClockLeaf>", at)]);
    }
    return [...body.matchAll(CLOCK_READ)]
        .filter((read) => !exempt.some(([from, to]) => read.index >= from && read.index <= to))
        .map((read) => read[0]);
}

test("the Hunting board and Mission Hall re-render each second only for a live claim cooldown; their clock reads tick in leaves", () => {
    const leaf = read("../components/SharedClockLeaf.tsx");
    assert.match(leaf, /useSharedNow\(\);\s*return children\(\);/, "the leaf owns the one-second subscription");
    for (const [file, component] of [
        ["../screens/HunterBoard.tsx", "HunterBoard"],
        ["../screens/Missions.tsx", "Missions"],
        ["../components/WeeklyBoard.tsx", "WeeklyBoard"],
    ] as const) {
        const source = read(file);
        assert.doesNotMatch(source, /\buseActionDeadline\(/, `${component} must not re-render every second for a zero cooldown`);
        assert.deepEqual(clockReadsOutsideLeaves(source, component), [],
            `${component} reads the clock during render outside a SharedClockLeaf, so that value would go stale`);
    }
    const board = read("../screens/HunterBoard.tsx");
    const missions = read("../screens/Missions.tsx");
    for (const source of [board, missions]) {
        assert.match(source, /const claimCooldownMs = useLiveActionDeadline\(missionClaimActionScope\(character\.name\)\);/);
    }
    // The Apex fight starts against the week its card rendered.
    assert.match(board, /\{canTakeApex\(character\) && <SharedClockLeaf>\{\(\) => \{\s*const apexWeek = isoWeekKey\(new Date\(\)\);/);
    assert.match(board, /onClick=\{\(\) => faceApex\(apexWeek\)\}/);
    // The inline mission fight keeps its every-second re-render; the hall does not.
    assert.match(missions, /const hallClock = \(\) => 0;/);
    assert.match(missions, /useSyncExternalStore\(subscribeSharedNow, authoritativeFight \? getSharedNow : hallClock, authoritativeFight \? getSharedNow : hallClock\);/);
    assert.match(read("../components/WeeklyBoard.tsx"), /<SharedClockLeaf>\{\(\) => timeLeftLabel\(board\.endsAt\)\}<\/SharedClockLeaf>/);
});

test("the World Map uses the live deadline and a coarse visible-only clock, not a per-second re-render", () => {
    const map = read("../screens/WorldMap.tsx");
    assert.match(map, /const raidStartCooldownMs = useLiveActionDeadline\(raidStartActionScope\(character\.name\)\);/);
    assert.doesNotMatch(map, /\buseActionDeadline\(/, "the World Map must not re-render every second for a zero cooldown");
    assert.match(map, /visiblePoll\(\(\) => setMapClockTick\(\(tick\) => tick \+ 1\), 5_000, 0\)/);
});
