/**
 * A settlement reply that lands after its fight screen closed must still be adopted.
 * The server has already paid the rewards (and any gear drop) into the player's
 * save, and the App's commit refuses a reply for another account or an older save,
 * so adopting late is safe while dropping it hides the payout until the next refresh.
 *
 * These are source scans, so each one also proves it still finds the code it guards.
 * If a refactor moves it, the scan fails loudly instead of passing vacuously.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

function between(source: string, start: string, end: string): string {
    const from = source.indexOf(start);
    assert.ok(from >= 0, `could not find: ${start}`);
    const to = source.indexOf(end, from);
    assert.ok(to > from, `could not find the end marker: ${end}`);
    return source.slice(from, to);
}

describe("late settlement replies are still adopted", () => {
    const tower = read("./screens/BattleTowerFight.tsx");
    const block = between(tower, "const performSettlement = useCallback(", "}, [runId, me, meSlug, settleFn, onVersionedCharacter]);");

    it("clan boss and mission settlements adopt the character before checking the screen is mounted", () => {
        const awaited = block.indexOf("await withTowerRequestDeadline(() => settleFn(runId, me))");
        const adopt = block.indexOf("onVersionedCharacter?.(mutation.character, mutation._saveVersion)", awaited);
        const mounted = block.indexOf("!mountedRef.current", awaited);
        assert.ok(awaited >= 0 && adopt > awaited && mounted > awaited, "the settleFn branch is no longer where this guard expects");
        assert.ok(adopt < mounted, "adopt the paid character before bailing out of an unmounted screen");
    });

    it("tower settlement adopts the character before checking the screen is mounted", () => {
        const awaited = block.indexOf("await settleTowerRun(runId, me)");
        const adopt = block.indexOf("onVersionedCharacter?.(response.character, response._saveVersion)", awaited);
        const mounted = block.indexOf("!mountedRef.current", awaited);
        assert.ok(awaited >= 0 && adopt > awaited && mounted > awaited, "the tower branch is no longer where this guard expects");
        assert.ok(adopt < mounted, "adopt the paid character before bailing out of an unmounted screen");
    });

    it("an AI fight reply for the same account is handed to the App even when the fight screen is gone", () => {
        const host = read("./components/AiFightHost.tsx");
        const settle = between(host, "async function settle(", "async function closeFight()");
        const scoped = settle.search(/if \(scopeIsCurrent\(\)\) \{\s*settledRef\.current = true;/);
        assert.ok(scoped >= 0, "the in scope branch is no longer where this guard expects");
        const lateMatch = /\}\s*else if \(activePlayerKeyRef\.current === originatingPlayerKey\) \{/.exec(settle.slice(scoped));
        assert.ok(lateMatch, "an out of scope reply for the same account must still reach the App");
        const late = scoped + lateMatch.index;
        assert.ok(settle.indexOf("latestOnSettled.current(settled)", late) > late, "the late branch must hand the reply to the App");
        // The fight specific steps must stay inside the in scope branch only.
        const resolved = settle.indexOf("currentFight.request.onResolved", scoped);
        assert.ok(resolved > scoped && resolved < late, "onResolved must stay in the in scope branch");
    });
});
