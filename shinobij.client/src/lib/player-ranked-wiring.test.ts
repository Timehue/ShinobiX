import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

function source(relativeUrl: string): string {
    return readFileSync(new URL(relativeUrl, import.meta.url), 'utf8');
}

function functionSlice(fileSource: string, name: string): string {
    const start = fileSource.indexOf(`function ${name}`);
    assert.notEqual(start, -1, `${name} must exist`);
    const next = fileSource.indexOf('\n    function ', start + 12);
    return fileSource.slice(start, next === -1 ? fileSource.length : next);
}

// The ranked queue lifecycle moved out of Arena.tsx into this hook so the lobby
// screen could return under its line budget. Arena still owns the challenge
// sender and the lobby JSX, so these contracts read whichever file now holds the
// asserted behavior. The assertions themselves are unchanged.
const RANKED_QUEUE_HOOK = '../features/arena/hooks/use-ranked-queue.ts';

describe('player-ranked queue to session wiring', () => {
    it('carries one parsed queue capability into the durable challenge', () => {
        const queue = source(RANKED_QUEUE_HOOK);
        const queueParse = queue.indexOf('playerRankedAuthorityFromQueueMatch(data.match)');
        const challengeCall = queue.indexOf(
            'challengePlayer(stub, "ranked", 0, false, rankedAuthority, launchingSession)',
            queueParse,
        );
        assert.ok(queueParse >= 0 && challengeCall > queueParse);

        const challenge = functionSlice(source('../screens/Arena.tsx'), 'challengePlayer');
        assert.match(challenge, /mode === "ranked" && !rankedAuthority/);
        assert.match(challenge, /\.\.\.\(mode === "ranked" \? rankedAuthority : \{\}\)/);
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
            'queue cleanup must not delete a consumed match proof during challenge launch');

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
        const challenge = queue.indexOf(
            'challengePlayer(stub, "ranked", 0, false, rankedAuthority, launchingSession)',
            consume,
        );
        assert.ok(runPoll >= 0 && initiatorValidation > runPoll && consume > initiatorValidation && challenge > consume,
            'one serialized poll must validate the initiator and consume its match before challenging');
        assert.match(queue, /run\(session, "poll", async \(\) => \{\s*if \(!rankedMutationAllowedNow\(\)\)/,
            'serialized Poll must recheck live mutation capability at its wire boundary');
        assert.doesNotMatch(queue, /window\.setInterval\(poll, 3000\)/);
    });

    it('fences ranked challenge continuations and uses functional inbox updates', () => {
        const challenge = functionSlice(source('../screens/Arena.tsx'), 'challengePlayer');
        const request = challenge.indexOf('await fetch("/api/player/challenge"');
        const afterRequest = challenge.indexOf('if (!rankedChallengeCurrent()) return result("retired");', request);
        const errorJson = challenge.indexOf('await response.json()', afterRequest);
        const afterJson = challenge.indexOf('if (!rankedChallengeCurrent()) return result("retired");', errorJson);
        const update = challenge.indexOf('setDuelChallenges((current) => [', afterRequest);
        assert.ok(request >= 0 && afterRequest > request && errorJson > afterRequest && afterJson > errorJson,
            'ranked queue ownership must be rechecked after each challenge await');
        assert.ok(update > afterRequest, 'the durable challenge response uses a functional inbox update');
        // Arena asks the hook rather than reaching into the lifecycle directly;
        // the hook still gates on both currency and live mutation capability.
        assert.match(challenge, /isRankedSessionCurrent\(rankedSession\)/);
        assert.match(source(RANKED_QUEUE_HOOK),
            /isRankedSessionCurrent: \(session: RankedQueueClientSession\) =>\s*rankedQueueLifecycle\.isCurrent\(session\) && rankedMutationAllowedNow\(\)/,
            'the session fence must still require a current generation and live mutation capability');
        assert.match(challenge, /signal: AbortSignal\.timeout\(RANKED_QUEUE_REQUEST_TIMEOUT_MS\)/);
        assert.match(challenge, /const definitiveRejection = response\.status >= 400 && response\.status < 500/,
            '5xx must preserve a possibly committed challenge; only explicit 4xx releases its admission');
        assert.match(challenge, /Ranked challenge delivery could not be confirmed\. It may still arrive; matchmaking will unlock when it settles or expires\./,
            'ranked transport-unknown copy must describe the preserved recovery state');

        const queue = source(RANKED_QUEUE_HOOK);
        const preserveOutcome = queue.indexOf('challengeResult.outcome !== "rejected"');
        const release = queue.indexOf('leaveRankedQueueOnServer(retired, true)', preserveOutcome);
        assert.ok(preserveOutcome >= 0 && release > preserveOutcome,
            'success/unknown stays launching and only a definitive rejection releases the server admission');
    });

    it('settles one exact outgoing ranked challenge without releasing a live proof', () => {
        const queue = source(RANKED_QUEUE_HOOK);
        assert.match(queue, /challengeId: challengeResult\.challengeId,\s*observed: false,\s*expiresAt: Date\.now\(\) \+ RANKED_CHALLENGE_SETTLEMENT_TIMEOUT_MS/,
            'sent and unknown outcomes must retain their exact generated challenge id');
        assert.match(queue, /rankedChallengeSettlementDecision\(tracked, duelChallenges, Date\.now\(\)\)/);
        assert.match(queue, /candidate\.challengeId === tracked\.challengeId/);
        assert.match(queue, /decision === "resolved" \|\| decision === "disappeared"\) \{[\s\S]*?retireTracked\(false\)/,
            'decline consumption or observed disappearance retires locally without deleting a live proof');
        assert.match(queue, /decision === "expired"\) \{\s*retireTracked\(true\)/,
            'only the conservative settlement deadline performs consumed-proof cleanup');
        assert.match(queue, /setTrackedRankedChallenge\(null\)/,
            'owner, capability, and explicit local clearing must drop settlement metadata');
    });

    it('delegates one fail-closed session-create path to App', () => {
        const arena = source('../screens/Arena.tsx');
        const app = source('../App.tsx');
        const appAccept = functionSlice(app, 'acceptChallengeGlobal');
        const validate = appAccept.indexOf('playerRankedAuthorityFromChallenge(challenge)');
        const failClosed = appAccept.indexOf('challenge.mode === "ranked" && !rankedAuthority', validate);
        const payload = appAccept.indexOf('...(rankedAuthority ?? {})', failClosed);
        // The raw POST moved into lib/pvp-session-create.ts, which owns the
        // ambiguous-commit retry. App now builds createBody first and hands it to
        // that helper, so the payload is assembled before the request rather than
        // inline inside the fetch. The fail-closed ordering is what matters.
        const request = appAccept.indexOf('createPvpSessionWithRecovery(fetch, acceptingCharacter.name, createBody', payload);
        assert.ok(validate >= 0 && failClosed > validate, 'ranked challenge authority must be revalidated');
        assert.ok(payload > failClosed, 'authority enters the session payload only after the fail-closed guard');
        assert.ok(request > payload, 'the create request carries that guarded payload');
        assert.match(source('./pvp-session-create.ts'), /fetchFn\("\/api\/pvp\/session", \{/,
            'the extracted creator is still the only PvP session POST');

        assert.match(app, /onAcceptChallenge=\{\(challenge\) => \{ void acceptChallengeGlobal\(challenge\); \}\}/);
        assert.match(arena, /if \(challenge\.mode !== "clanWarPet"\) \{\s*onAcceptChallenge\(challenge\);\s*return;/);
        assert.match(arena, /onAcceptChallenge=\{onAcceptChallenge\}/);
        assert.doesNotMatch(arena, /function acceptChallenge\(/);
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

    it('disables consumables and thrown weapons for every versioned real PvP fighter', () => {
        const battle = source('../screens/PvpBattleScreen.tsx');
        assert.match(battle, /session\?\.pvpConsumableAuthorityVersion === 1/);
        assert.match(battle, /session\.realFighters\?\.\[role\] === true/);
        assert.match(battle, /Consumables and thrown weapons are disabled for real fighters in server-authoritative PvP/);
        assert.match(battle, /disabled=\{!isMyTurn \|\| realPvpItemsDisabled \|\| submitting/);
        assert.match(battle, /if \(onCooldown \|\| realPvpItemsDisabled\) return/);
    });
});
