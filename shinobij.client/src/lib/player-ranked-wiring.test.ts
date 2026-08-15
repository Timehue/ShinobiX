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

describe('player-ranked queue to session wiring', () => {
    it('carries one parsed queue capability into the durable challenge', () => {
        const arena = source('../screens/Arena.tsx');
        const queueParse = arena.indexOf('playerRankedAuthorityFromQueueMatch(data.match)');
        const challengeCall = arena.indexOf(
            'challengePlayer(stub, "ranked", 0, false, rankedAuthority, launchingSession)',
            queueParse,
        );
        assert.ok(queueParse >= 0 && challengeCall > queueParse);

        const challenge = functionSlice(arena, 'challengePlayer');
        assert.match(challenge, /mode === "ranked" && !rankedAuthority/);
        assert.match(challenge, /\.\.\.\(mode === "ranked" \? rankedAuthority : \{\}\)/);
    });

    it('owns and serializes one confirmed ranked queue generation', () => {
        const arena = source('../screens/Arena.tsx');
        assert.match(arena, /const rankedQueueOwnerKey = accountKey\(character\.name\)/);
        assert.match(arena, /useCapabilityMutationAvailability\(\)/);
        assert.match(arena, /capabilityAdmissionAllowed\(mutationAvailability\(\)\)/);
        assert.match(arena, /disposeOwner\(rankedQueueOwnerKey\)/);
        assert.match(arena, /playerRankedEnabled=\{playerRankedEnabled && rankedMutationsAvailable\}/);
        assert.match(arena, /if \(owner\.phase === "launching" && !releaseConsumedMatch\) return/,
            'queue cleanup must not delete a consumed match proof during challenge launch');

        const join = functionSlice(arena, 'joinRankedQueue');
        const runJoin = join.indexOf('rankedQueueLifecycle.run(joiningSession, "join"');
        const confirmation = join.indexOf('data.enabled !== true || data.inQueue !== true', runJoin);
        const markQueued = join.indexOf('rankedQueueLifecycle.confirmJoined(joiningSession)', confirmation);
        assert.ok(runJoin >= 0 && confirmation > runJoin && markQueued > confirmation,
            'polling may begin only after an ok, enabled, inQueue Join response');
        assert.match(join, /run\(joiningSession, "join", async \(\) => \{\s*if \(!rankedMutationAllowedNow\(\)\)/,
            'serialized Join must recheck live mutation capability at its wire boundary');
        assert.match(join, /AbortSignal\.timeout\(RANKED_QUEUE_REQUEST_TIMEOUT_MS\)/);

        const runPoll = arena.indexOf('rankedQueueLifecycle.run(session, "poll"');
        const initiatorValidation = arena.indexOf('typeof match.initiator !== "boolean"', runPoll);
        const consume = arena.indexOf('rankedQueueLifecycle.consumeMatch(session)', runPoll);
        const challenge = arena.indexOf(
            'challengePlayer(stub, "ranked", 0, false, rankedAuthority, launchingSession)',
            consume,
        );
        assert.ok(runPoll >= 0 && initiatorValidation > runPoll && consume > initiatorValidation && challenge > consume,
            'one serialized poll must validate the initiator and consume its match before challenging');
        assert.match(arena, /run\(session, "poll", async \(\) => \{\s*if \(!rankedMutationAllowedNow\(\)\)/,
            'serialized Poll must recheck live mutation capability at its wire boundary');
        assert.doesNotMatch(arena, /window\.setInterval\(poll, 3000\)/);
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
        assert.match(challenge, /rankedQueueLifecycle\.isCurrent\(rankedSession\)/);
        assert.match(challenge, /signal: AbortSignal\.timeout\(RANKED_QUEUE_REQUEST_TIMEOUT_MS\)/);
        assert.match(challenge, /const definitiveRejection = response\.status >= 400 && response\.status < 500/,
            '5xx must preserve a possibly committed challenge; only explicit 4xx releases its admission');
        assert.match(challenge, /Ranked challenge delivery could not be confirmed\. It may still arrive; matchmaking will unlock when it settles or expires\./,
            'ranked transport-unknown copy must describe the preserved recovery state');

        const arena = source('../screens/Arena.tsx');
        const preserveOutcome = arena.indexOf('challengeResult.outcome !== "rejected"');
        const release = arena.indexOf('leaveRankedQueueOnServer(retired, true)', preserveOutcome);
        assert.ok(preserveOutcome >= 0 && release > preserveOutcome,
            'success/unknown stays launching and only a definitive rejection releases the server admission');
    });

    it('settles one exact outgoing ranked challenge without releasing a live proof', () => {
        const arena = source('../screens/Arena.tsx');
        assert.match(arena, /challengeId: challengeResult\.challengeId,\s*observed: false,\s*expiresAt: Date\.now\(\) \+ RANKED_CHALLENGE_SETTLEMENT_TIMEOUT_MS/,
            'sent and unknown outcomes must retain their exact generated challenge id');
        assert.match(arena, /rankedChallengeSettlementDecision\(tracked, duelChallenges, Date\.now\(\)\)/);
        assert.match(arena, /candidate\.challengeId === tracked\.challengeId/);
        assert.match(arena, /decision === "resolved" \|\| decision === "disappeared"\) \{[\s\S]*?retireTracked\(false\)/,
            'decline consumption or observed disappearance retires locally without deleting a live proof');
        assert.match(arena, /decision === "expired"\) \{\s*retireTracked\(true\)/,
            'only the conservative settlement deadline performs consumed-proof cleanup');
        assert.match(arena, /setTrackedRankedChallenge\(null\)/,
            'owner, capability, and explicit local clearing must drop settlement metadata');
    });

    it('delegates one fail-closed session-create path to App', () => {
        const arena = source('../screens/Arena.tsx');
        const app = source('../App.tsx');
        const appAccept = functionSlice(app, 'acceptChallengeGlobal');
        const validate = appAccept.indexOf('playerRankedAuthorityFromChallenge(challenge)');
        const failClosed = appAccept.indexOf('challenge.mode === "ranked" && !rankedAuthority', validate);
        const payload = appAccept.indexOf('...(rankedAuthority ?? {})', failClosed);
        const request = appAccept.indexOf("fetch('/api/pvp/session'", failClosed);
        assert.ok(validate >= 0 && failClosed > validate, 'ranked challenge authority must be revalidated');
        assert.ok(request > failClosed && payload > request, 'session payload must include authority after the fail-closed guard');

        assert.match(app, /onAcceptChallenge=\{\(challenge\) => \{ void acceptChallengeGlobal\(challenge\); \}\}/);
        assert.match(arena, /if \(challenge\.mode !== "clanWarPet"\) \{\s*onAcceptChallenge\(challenge\);\s*return;/);
        assert.match(arena, /onAcceptChallenge=\{onAcceptChallenge\}/);
        assert.doesNotMatch(arena, /function acceptChallenge\(/);
    });

    it('scopes the crash-recovery PvP breadcrumb to the active account', () => {
        const app = source('../App.tsx');
        const persist = app.indexOf('localStorage.setItem(PVP_SESSION_KEY');
        const owner = app.indexOf('owner: accountKey(character.name)', persist);
        const restore = app.indexOf('const expectedOwner = accountKey(String(snap.character.name ?? ""))', owner);
        const guard = app.indexOf('parsed.owner === expectedOwner && parsed.pvpBattleId', restore);
        const install = app.indexOf('setPvpBattleId(parsed.pvpBattleId)', guard);
        assert.ok(persist >= 0 && owner > persist, 'persisted breadcrumb must carry its canonical owner');
        assert.ok(restore > owner && guard > restore && install > guard,
            'restore must reject a foreign or legacy owner before installing the battle id');
    });

    it('clears in-memory PvP identity before logout or account deletion can switch owners', () => {
        const logout = functionSlice(source('../App.tsx'), 'endLocalSession');
        const clear = logout.indexOf('clearPvpBattleState()');
        const removeCharacter = logout.indexOf('setCharacter(null)');
        assert.ok(clear >= 0 && removeCharacter > clear,
            'logout must clear A\'s battle before B can become the active character');
    });

    it('disables V2 consumables and thrown weapons with an explicit player reason', () => {
        const battle = source('../screens/PvpBattleScreen.tsx');
        assert.match(battle, /playerRankedV2ItemsDisabled = session\?\.playerRankedAuthorityVersion === 2/);
        assert.match(battle, /Consumables and thrown weapons are disabled in Player Ranked during the V2 rollout/);
        assert.match(battle, /disabled=\{!isMyTurn \|\| playerRankedV2ItemsDisabled \|\| submitting/);
        assert.match(battle, /if \(onCooldown \|\| playerRankedV2ItemsDisabled\) return/);
    });
});
