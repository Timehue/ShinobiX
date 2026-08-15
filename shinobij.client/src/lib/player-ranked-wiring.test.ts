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
        const challengeCall = arena.indexOf('challengePlayer(stub, "ranked", 0, false, rankedAuthority)', queueParse);
        assert.ok(queueParse >= 0 && challengeCall > queueParse);

        const challenge = functionSlice(arena, 'challengePlayer');
        assert.match(challenge, /mode === "ranked" && !rankedAuthority/);
        assert.match(challenge, /\.\.\.\(mode === "ranked" \? rankedAuthority : \{\}\)/);
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
