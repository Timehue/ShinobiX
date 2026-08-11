import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(join(process.cwd(), 'api', 'player', 'challenge.ts'), 'utf8');
const storageSource = readFileSync(join(process.cwd(), 'api', '_storage.ts'), 'utf8');

test('incoming Arena challenge hides setup, roster, and server seed until acceptance', () => {
    assert.match(source, /arena-challenge-setup:/);
    assert.match(source, /challengerWarfrontSetup: _hiddenSetup/);
    assert.match(source, /challengerTeamIds: _hiddenTeamIds/);
    assert.match(source, /petBattleSeed: _hiddenSeed/);
    assert.match(source, /Object\.entries\(projectedChallenger\)\.filter\(\(\[key\]\) => key !== 'pets'\)/);
    assert.match(source, /petBattleSeed: freshArenaSeed\(\)/, 'the challenger must not choose the deterministic PvP seed');
    assert.match(source, /challengerSetupSealed: true/);
    assert.match(source, /\{ nx: true, ex: CHALLENGE_TTL \}/, 'the initial setup commitment must not be replaceable');
});

test('accepted Arena payload atomically reveals both server-authoritative setups and rosters', () => {
    const acceptanceLock = source.indexOf('withKvLock(setupKey');
    const acceptedReceipt = source.indexOf('const sealedAcceptance: SealedArenaSetup', acceptanceLock);
    const reveal = source.indexOf('routedChallenge = acceptedArenaChallenge(id', acceptedReceipt);
    const response = source.indexOf('challenge: safeChallenge', reveal);
    assert.ok(acceptanceLock >= 0 && acceptedReceipt > acceptanceLock, 'the responder plan must be sealed under the private setup lock');
    assert.ok(reveal > acceptedReceipt && response > reveal, 'both clients must receive the same post-commit reveal');
    assert.match(source, /save:\$\{actorName\}/, 'selected rosters must resolve from authenticated saves');
});

test('cancelled or superseded Arena challenges cannot accept or clear a newer outgoing slot', () => {
    const acceptance = source.indexOf('const challengerOutgoingKey = outgoingKey(targetName)');
    const currentCheck = source.indexOf('outgoingMatches(currentOutgoing, id, actorName)', acceptance);
    const acceptedReceipt = source.indexOf('const sealedAcceptance: SealedArenaSetup', acceptance);
    assert.ok(acceptance >= 0 && currentCheck > acceptance && acceptedReceipt > currentCheck,
        'first acceptance must verify the challenge is still the current outgoing commitment');
    assert.match(source, /outgoingMatches\(current, id, fromName\)\) await kv\.del\(senderKey\)/,
        'an old response may only clear its matching outgoing slot');
    assert.match(source, /previous && !previous\.accepted[\s\S]*cancelledArenaSetup\(previous\)/,
        'superseding must retain a terminal tombstone for the unanswered commitment');
    assert.match(source, /isArenaSetupTombstone\(existing\)[\s\S]*already cancelled or superseded/,
        'a delayed retry must not recreate a tombstoned commitment');
    assert.match(source, /challengeClientCreatedAt <= existingOutgoing\.clientCreatedAt[\s\S]*outgoingUpdate\.stale/,
        'a delayed request that never reached the server before supersession must lose to the newer generation');
});

test('challenge deletion trusts stored parties and makes an accepted Arena reveal recipient-only', () => {
    const deleteBranch = source.indexOf("if (req.method === 'DELETE')");
    const storedLookup = source.indexOf('existing.find(challenge => challengeId(challenge) === normalizedId)', deleteBranch);
    const storedParties = source.indexOf('const actualFrom = safeName(challengeFromName(matched))', storedLookup);
    const acceptedArena = source.indexOf('const acceptedArenaNotice =', storedParties);
    const recipientOnly = source.indexOf('callerIsRecipient || (!acceptedArenaNotice && callerIsSender)', acceptedArena);
    const inboxMutation = source.indexOf('const updated = existing.filter', recipientOnly);
    assert.ok(deleteBranch >= 0 && storedLookup > deleteBranch && storedParties > storedLookup,
        'DELETE must resolve the exact stored notice before deriving either party');
    assert.ok(acceptedArena > storedParties && recipientOnly > acceptedArena && inboxMutation > recipientOnly,
        'an accepted Arena notice must authorize its recipient before any inbox mutation');
    assert.match(source, /function challengeToName\(challenge: unknown\)/,
        'the recipient must come from the stored challenge rather than the request body');
    assert.match(source, /if \(inboxDeleteDenied\)[\s\S]*status\(403\)/,
        'a forged party name must fail closed without filtering the inbox');
});

test('accepted Arena reveal is terminal against decline or alternate routing', () => {
    const serverStateRead = source.indexOf('const serverArenaState =');
    const serverStateGate = source.indexOf('const isArenaChallenge = challengeRecord.arenaMatch === true || Boolean(serverArenaState)');
    const arenaBranch = source.indexOf('if (isArenaChallenge)', serverStateGate);
    const declineBranch = source.indexOf('} else if (record.declined) {', arenaBranch);
    const declineLock = source.indexOf('withKvLock(setupKey', declineBranch);
    const acceptedGuard = source.indexOf('if (stored.accepted)', declineLock);
    const terminalConflict = source.indexOf('its reveal is final', acceptedGuard);
    const tombstoneWrite = source.indexOf('cancelledArenaSetup(stored)', terminalConflict);
    const unsupportedTransition = source.indexOf('Unsupported Arena challenge transition', tombstoneWrite);
    const inboxRouting = source.indexOf('let safeChallenge =', unsupportedTransition);
    assert.ok(serverStateRead >= 0 && serverStateGate > serverStateRead && arenaBranch > serverStateGate,
        'a server-held Arena id must force the state machine even when the client strips arenaMatch');
    assert.ok(declineBranch > arenaBranch && declineLock > declineBranch,
        'decline must race acceptance on the same private setup lock');
    assert.ok(acceptedGuard > declineLock && terminalConflict > acceptedGuard && tombstoneWrite > terminalConflict,
        'a sealed acceptance must reject decline before it can write a tombstone');
    assert.ok(unsupportedTransition > tombstoneWrite && inboxRouting > unsupportedTransition,
        'other Arena transitions must be rejected before they can replace the accepted inbox notice');
});

test('Arena notices use server-held parties and mode flags', () => {
    const acceptedRoute = source.indexOf('function acceptedArenaChallenge');
    const acceptedEnd = source.indexOf('\n}', acceptedRoute);
    const acceptedPayload = source.slice(acceptedRoute, acceptedEnd);
    assert.match(acceptedPayload, /arenaMatch: true/);
    assert.match(acceptedPayload, /accepted: true/);
    assert.match(acceptedPayload, /declined: false/);
    assert.match(acceptedPayload, /fromName: secret\.responderName/);
    assert.match(acceptedPayload, /toName: secret\.challengerName/,
        'a responder must not be able to forge the accepted notice recipient');

    const decline = source.indexOf("if ('error' in decline)");
    const declinedRoute = source.indexOf('routedChallenge = {', decline);
    const declinedEnd = source.indexOf('};', declinedRoute);
    const declinedPayload = source.slice(declinedRoute, declinedEnd);
    assert.match(declinedPayload, /arenaMatch: true/);
    assert.match(declinedPayload, /fromName: decline\.state\.responderName/);
    assert.match(declinedPayload, /toName: decline\.state\.challengerName/);
});

test('Arena commitments and outgoing generations bypass the process read cache', () => {
    assert.match(storageSource, /'arena-challenge-setup:'/, 'mode detection must not reuse a stale cached null across workers');
    assert.match(storageSource, /'challenge-outgoing:'/, 'acceptance must read the current outgoing generation across workers');
});
