import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

function source(relativeUrl: string): string {
    return readFileSync(new URL(relativeUrl, import.meta.url), 'utf8');
}

function functionSlice(fileSource: string, name: string): string {
    const start = fileSource.indexOf(`function ${name}`);
    assert.notEqual(start, -1, `${name} must exist`);
    const remainder = fileSource.slice(start + 12);
    const nextOffset = remainder.search(/\n {4}(?:async )?function /);
    return fileSource.slice(start, nextOffset === -1 ? fileSource.length : start + 12 + nextOffset);
}

// The ranked queue lifecycle moved out of Arena.tsx into this hook so the lobby
// screen could return under its line budget. Arena owns direct session creation
// and the lobby JSX, so these contracts read whichever file now holds the
// asserted behavior.
const RANKED_QUEUE_HOOK = '../features/arena/hooks/use-ranked-queue.ts';

describe('player-ranked queue to session wiring', () => {
    it('carries one parsed queue capability into a direct session launch', () => {
        const queue = source(RANKED_QUEUE_HOOK);
        const queueParse = queue.indexOf('playerRankedAuthorityFromQueueMatch(data.match)');
        const launch = queue.indexOf('launchRankedMatch(', queueParse);
        assert.ok(queueParse >= 0 && launch > queueParse);
        assert.doesNotMatch(queue, /challengePlayer\(stub, "ranked"/);

        const arena = functionSlice(source('../screens/Arena.tsx'), 'launchRankedMatch');
        assert.match(arena, /createPvpSessionWithRecovery\(fetch, character\.name, createBody\)/);
        assert.match(arena, /rankedKind: "player"/);
        assert.match(arena, /p1Character: \{ name: character\.name \}/);
        assert.doesNotMatch(arena, /api\/player\/challenge/);
    });

    it('owns and serializes one confirmed ranked queue generation', () => {
        const arena = source('../screens/Arena.tsx');
        const queue = source(RANKED_QUEUE_HOOK);
        assert.match(queue, /const rankedQueueOwnerKey = accountKey\(character\.name\)/);
        assert.match(queue, /useCapabilityMutationAvailability\(\)/);
        assert.match(queue, /capabilityAdmissionAllowed\(mutationAvailability\(\)\)/);
        assert.match(queue, /disposeOwner\(rankedQueueOwnerKey\)/);
        assert.match(arena, /playerRankedEnabled=\{playerRankedEnabled && rankedMutationsAvailable\}/);
        assert.match(queue, /if \(owner\.phase === "launching" && !releaseConsumedMatch\) return/,
            'queue cleanup must not delete a consumed match proof during session launch');

        const join = functionSlice(queue, 'joinRankedQueue');
        const runJoin = join.indexOf('rankedQueueLifecycle.run(joiningSession, "join"');
        const confirmation = join.indexOf('data.enabled !== true || data.inQueue !== true', runJoin);
        const markQueued = join.indexOf('rankedQueueLifecycle.confirmJoined(joiningSession)', confirmation);
        assert.ok(runJoin >= 0 && confirmation > runJoin && markQueued > confirmation,
            'polling may begin only after an ok, enabled, inQueue Join response');
        assert.match(join, /run\(joiningSession, "join", async \(\) => \{\s*if \(!rankedMutationAllowedNow\(\)\)/,
            'serialized Join must recheck live mutation capability at its wire boundary');
        assert.match(join, /AbortSignal\.timeout\(RANKED_QUEUE_REQUEST_TIMEOUT_MS\)/);

        const runPoll = queue.indexOf('rankedQueueLifecycle.run(session, "poll"');
        const initiatorValidation = queue.indexOf('typeof match.initiator !== "boolean"', runPoll);
        const consume = queue.indexOf('rankedQueueLifecycle.consumeMatch(session)', runPoll);
        const responderWait = queue.indexOf('if (!battleId && match.initiator !== true)', initiatorValidation);
        const launch = queue.indexOf('launchRankedMatch(', consume);
        assert.ok(runPoll >= 0 && initiatorValidation > runPoll && responderWait > initiatorValidation && consume > responderWait && launch > consume,
            'one serialized poll waits for the responder and consumes its match before direct session launch');
        assert.match(queue, /run\(session, "poll", async \(\) => \{\s*if \(!rankedMutationAllowedNow\(\)\)/,
            'serialized Poll must recheck live mutation capability at its wire boundary');
        assert.doesNotMatch(queue, /window\.setInterval\(poll, 3000\)/);
    });

    it('uses the session launcher and retains the consumed proof only for recovery', () => {
        const arena = functionSlice(source('../screens/Arena.tsx'), 'launchRankedMatch');
        assert.match(arena, /if \(match\.battleId\)/);
        assert.match(arena, /setPvpRole\(match\.initiator \? "p1" : "p2"\)/);
        assert.match(arena, /stringifyPvpSessionPayload\(/);
        assert.match(arena, /pvpSessionEnvironment\(true, "central", undefined, undefined\)/);
        assert.match(source(RANKED_QUEUE_HOOK),
            /isRankedSessionCurrent: \(session: RankedQueueClientSession\) =>\s*rankedQueueLifecycle\.isCurrent\(session\) && rankedMutationAllowedNow\(\)/,
            'the session fence must still require a current generation and live mutation capability');
        const queue = source(RANKED_QUEUE_HOOK);
        assert.match(queue, /RANKED_SESSION_LAUNCH_TIMEOUT_MS/);
        assert.doesNotMatch(queue, /rankedChallengeSettlementDecision/);
        assert.doesNotMatch(queue, /TrackedRankedChallenge/);
        assert.match(source('./pvp-session-create.ts'), /fetchFn\("\/api\/pvp\/session", \{/,
            'the extracted creator is still the only PvP session POST');
    });

    it('scopes the crash-recovery PvP breadcrumb to the active account', () => {
        // The breadcrumb split in two: use-pvp-session-controller.ts persists it,
        // pvp-pending-session.ts validates it on restore. App only supplies the
        // expected owner and installs the result.
        const controller = source('./use-pvp-session-controller.ts');
        const persist = controller.indexOf('localStorage.setItem(options.storageKey');
        const owner = controller.indexOf('owner: ownerKey,', persist);
        assert.ok(persist >= 0 && owner > persist, 'persisted breadcrumb must carry its canonical owner');
        assert.match(controller, /const ownerKey = accountKey\(options\.characterName \?\? ""\)/,
            'the persisted owner must be the canonical account key');

        const reader = source('./pvp-pending-session.ts');
        assert.match(reader, /parsed\.owner !== expectedOwner/,
            'restore must reject a foreign owner');
        const rejects = reader.indexOf('parsed.owner !== expectedOwner');
        const clears = reader.indexOf('storage.removeItem(key)', rejects);
        assert.ok(clears > rejects, 'a foreign or malformed breadcrumb is cleared, not installed');

        const app = source('../App.tsx');
        const read = app.indexOf('readPvpBrowserBreadcrumb(');
        const expectedOwner = app.indexOf('accountKey(String(snap.character.name ?? ""))', read);
        const install = app.indexOf('restoredPvpBattleId = browserPvp.pvpBattleId', expectedOwner);
        assert.ok(read >= 0 && expectedOwner > read && install > expectedOwner,
            'App must pass the active account as expected owner before installing the battle id');
    });

    it('clears in-memory PvP identity before logout or account deletion can switch owners', () => {
        const logout = functionSlice(source('../App.tsx'), 'endLocalSession');
        const clear = logout.indexOf('clearPvpBattleState()');
        const removeCharacter = logout.indexOf('setCharacter(null)');
        assert.ok(clear >= 0 && removeCharacter > clear,
            'logout must clear A\'s battle before B can become the active character');
    });

    it('keeps consumables and thrown weapons off only for v1 in-flight sessions and Ranked', () => {
        const battle = source('../screens/PvpBattleScreen.tsx');
        assert.match(battle, /session\?\.pvpConsumableAuthorityVersion === 1/);
        assert.match(battle, /session\.realFighters\?\.\[role\] === true/);
        assert.match(battle, /session\?\.playerRankedAuthorityVersion === 2;/);
        assert.match(battle, /Consumables and thrown weapons are disabled in Ranked\./);
        assert.doesNotMatch(battle, /pvpConsumableAuthorityVersion === 2/,
            'the client must not special-case v2: a sealed budget is the default, not a feature flag');
        assert.match(battle, /disabled=\{!isMyTurn \|\| realPvpItemsDisabled \|\| submitting/);
        assert.match(battle, /if \(onCooldown \|\| realPvpItemsDisabled\) return/);
    });
});
