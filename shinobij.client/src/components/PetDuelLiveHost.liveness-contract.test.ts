// Connection-liveness contracts for live pet duels (2026-08-20 stuck-UI audit).
//
// Text contracts, like PetDuelLiveHost.roster-contract.test.ts: node tests
// cannot mount these components (CSS imports), but the stuck states these
// guard against were real — a "waiting to accept" panel that never lapsed, and
// a frozen fight whose only exit recorded a forfeit the server never declared.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const host = read('./PetDuelLiveHost.tsx');
const coliseum = read('./PetColiseum.tsx');
const transport = read('../lib/pet-duel-transport.ts');

/** Server constants, read as text — the client build must not import from
 *  `api/` (different module system), but the relationship still matters.
 *  Resolved from the repo root — this suite always runs from there. */
function serverConst(name: string): number {
    const src = readFileSync(join(process.cwd(), 'api', '_realtime', 'pet-duel-session.ts'), 'utf8');
    const m = new RegExp(`export const ${name}\\s*=\\s*([\\d_]+)\\s*;`).exec(src);
    assert.ok(m, `could not find ${name} in pet-duel-session.ts — did it get renamed?`);
    return Number(m![1].replace(/_/g, ''));
}

const clientConst = (src: string, name: string): number => {
    const m = new RegExp(`const ${name}\\s*=\\s*([\\d_]+)\\s*;`).exec(src);
    assert.ok(m, `could not find ${name}`);
    return Number(m![1].replace(/_/g, ''));
};

describe('live pet-duel connection-liveness contracts', () => {
    it('lapses the "waiting to accept" panel just after the server invite TTL', () => {
        const lapse = clientConst(host, 'CHALLENGE_LAPSE_MS');
        const ttl = serverConst('DUEL_INVITE_TTL_MS');
        assert.ok(lapse > ttl,
            `client lapse ${lapse}ms must sit past the server TTL ${ttl}ms so the server's own expiry notice wins the race`);
        // The timer must actually clear the awaiting state, not just fire.
        assert.match(host, /CHALLENGE_LAPSE_MS\);\s*\n\s*return \(\) => window\.clearTimeout\(timer\)/);
        assert.match(host, /window\.setTimeout\(\(\) => \{\s*\n\s*setAwaiting\(null\);/);
    });

    it('escalates a stall only after the server\'s own drop window has passed', () => {
        const escalate = clientConst(coliseum, 'CONNECTION_LOST_AFTER_MS');
        const stall = serverConst('DUEL_STALL_MS');
        assert.ok(escalate > stall,
            `escalation at ${escalate}ms must outlast the server's ${stall}ms drop-and-unblock window — an intact connection clears any stall inside it`);
    });

    it('offers a connection-lost exit that is NOT the forfeit exit', () => {
        assert.match(coliseum, /data-testid="pet-duel-connection-lost-exit"\s*\n\s*onClick=\{onConnectionLost\}/,
            'the escalated banner exits through the dedicated handler, never through exitDuel');
        assert.match(host, /onConnectionLost=\{exitConnectionLost\}/);
        const block = /const exitConnectionLost = useCallback\(\(\) => \{[\s\S]*?\}, \[finish\]\);/.exec(host);
        assert.ok(block, 'exitConnectionLost must exist in the host');
        assert.doesNotMatch(block![0], /resign/,
            'the connection-lost exit must never resign — the server may have settled the fight in this player\'s favour');
        assert.match(block![0], /requestDuelResult\(b\.start\.id\)/,
            'it asks the server for the authoritative verdict before settling locally');
    });

    it('replays missed hand-overs on rejoin without mislabeling them as the opponent', () => {
        assert.match(transport, /if \(p\.side !== start\.side\) hooks\.onPeerGone\?\.\(\)/,
            'a reconnecting client can be replayed its OWN hand-over; the "opponent disconnected" notice only fits the peer');
    });
});
