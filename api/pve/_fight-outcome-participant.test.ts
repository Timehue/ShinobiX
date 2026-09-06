import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TowerActor, TowerSession } from '../towers/_tower-session.js';
import { aiFightParticipantActor, aiFightPlayerActor } from '../missions/_ai-fight-outcome.js';
import { applyPveOutcomeWithReceipt, legacyReceiptSettledPlayer } from './_fight-outcome-settlement.js';

const NOW = 1_800_000_000_000;

function actor(over: Partial<TowerActor>): TowerActor {
    return { id: 'a', side: 'squad', ai: false, ownerSlug: 'rill', hp: 100, maxHp: 100, statuses: [], ...over } as unknown as TowerActor;
}

function session(actors: TowerActor[], over: Partial<TowerSession> = {}): TowerSession {
    return { runId: 'shared-run', towerId: 'story-tower', status: 'done', winner: 'enemy', actors, ...over } as unknown as TowerSession;
}

const idOf = (combatant: unknown): string | undefined => (combatant as { id?: string } | undefined)?.id;

describe('aiFightParticipantActor — the body an outcome may be written to', () => {
    const rill = actor({ id: 'sq-0', ownerSlug: 'rill', hp: 40 });
    const dopey = actor({ id: 'sq-1', ownerSlug: 'Dopey', hp: 0 });
    const companion = actor({ id: 'sq-2', ownerSlug: null, ai: true, hp: 5 });

    it('chooses by canonical owner slug, never the first squad actor', () => {
        const s = session([rill, dopey, companion]);
        assert.equal(idOf(aiFightParticipantActor(s, 'dopey')), 'sq-1', 'case-insensitive owner match');
        assert.equal(idOf(aiFightParticipantActor(s, 'rill')), 'sq-0');
        // The old helper answered the host for everyone — the F06 defect.
        assert.equal(idOf(aiFightPlayerActor(s)), 'sq-0');
    });

    it('prefers the live human over an AFK-flagged one, and never a companion', () => {
        const afk = actor({ id: 'sq-afk', ownerSlug: 'rill', ai: true, hp: 7 });
        assert.equal(idOf(aiFightParticipantActor(session([afk, rill]), 'rill')), 'sq-0');
        assert.equal(idOf(aiFightParticipantActor(session([afk]), 'rill')), 'sq-afk', 'an AFK human still owns their body');
        assert.equal(aiFightParticipantActor(session([companion]), 'rill'), undefined);
        assert.equal(aiFightParticipantActor(null, 'rill'), undefined);
    });

    it('settles each participant against their own actor, and refuses a member with no body without a receipt', () => {
        const s = session([rill, dopey]);
        const rillOut = applyPveOutcomeWithReceipt({ character: { name: 'rill', hp: 100, maxHp: 100 }, session: s, playerName: 'rill', outcome: 'loss', now: NOW });
        assert.equal(rillOut.ok, true);
        if (rillOut.ok) {
            assert.equal(rillOut.character.hp, 40);
            assert.equal(rillOut.character.hospitalized, undefined);
        }
        const dopeyOut = applyPveOutcomeWithReceipt({ character: { name: 'dopey', hp: 100, maxHp: 100 }, session: s, playerName: 'dopey', outcome: 'loss', now: NOW });
        assert.equal(dopeyOut.ok, true);
        if (dopeyOut.ok) {
            assert.equal(dopeyOut.character.hp, 0);
            assert.equal(dopeyOut.character.hospitalized, true);
        }
        const ghost = applyPveOutcomeWithReceipt({ character: { name: 'ghost', hp: 100, maxHp: 100 }, session: session([companion]), playerName: 'ghost', outcome: 'loss', now: NOW });
        assert.equal(ghost.ok, false, 'no actor of yours → refused');
        if (!ghost.ok) assert.equal(ghost.status, 409);
    });
});

describe('legacyReceiptSettledPlayer — the shared marker is inspected, not counted', () => {
    it('only a marker naming this player proves this player was settled', () => {
        assert.equal(legacyReceiptSettledPlayer({ playerName: 'Rill', at: NOW }, 'rill'), true);
        assert.equal(legacyReceiptSettledPlayer({ playerName: 'rill', at: NOW }, 'dopey'), false, 'a teammate\'s marker is evidence about someone else');
        assert.equal(legacyReceiptSettledPlayer(true, 'rill'), false, 'a bare truthy value is not a receipt');
        assert.equal(legacyReceiptSettledPlayer(null, 'rill'), false);
    });
});
