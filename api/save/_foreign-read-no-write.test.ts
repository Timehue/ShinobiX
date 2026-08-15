import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * A read of someone ELSE'S save must never write to it.
 *
 * `GET /api/save/:name` is readable by any logged-in player — PvP scouting and
 * profile views both rely on it. The handler settles elapsed state (vitals regen,
 * travel leases, expired Hollow Gate runs) before projecting, and persisting that
 * settle bumps `_saveVersion`.
 *
 * With `persist: true` for every reader, and vitals regenerating every second, a
 * foreign read of any save below full HP reliably bumped the owner's version. The
 * owner is not part of that request and learns nothing; their next autosave then
 * echoes a stale `_baseSaveVersion`, takes a 409, and the client's conflict recovery
 * replaces local state with the server snapshot — so an opponent opening your
 * profile could roll your progress back. The rate scaled with player count, which
 * made it look unreproducible in a small test group.
 *
 * `persist: false` still returns the settled projection, so foreign readers see
 * correct regen; only the durable write is skipped.
 */

const handlerSource = readFileSync(join(process.cwd(), 'api', 'save', '[name].ts'), 'utf8');

test('the settle-on-read write is gated on the reader owning the save', () => {
    assert.match(
        handlerSource,
        /settleSaveRecordForRead\(name, stored, \{ persist: isPlayerSelfRead \}\)/,
        'GET must persist the settle only for the owner',
    );

    assert.doesNotMatch(
        handlerSource,
        /settleSaveRecordForRead\([^)]*\{\s*persist:\s*true\s*\}\)/,
        'no read path may unconditionally persist — that is the version-bump-on-foreign-read bug',
    );
});

test('ownership is resolved before the settle that depends on it', () => {
    // Write authority is intentionally narrower than full-read authorization. If its
    // declaration ever moves back below the settle, `persist: isPlayerSelfRead` would read a
    // temporal-dead-zone binding and throw on every save read.
    const ownerDecl = handlerSource.indexOf('const isPlayerSelfRead =');
    const settleCall = handlerSource.indexOf('settleSaveRecordForRead(name, stored');

    assert.ok(ownerDecl > 0, 'the GET path must still compute player self-read authority');
    assert.ok(settleCall > 0, 'the GET path must still settle elapsed state on read');
    assert.ok(
        ownerDecl < settleCall,
        'isPlayerSelfRead must be declared before the settle call that consumes it',
    );
});

test('authorized admin visibility cannot grant elapsed-state write authority', () => {
    assert.match(
        handlerSource,
        /const canReadFullSave = adminCanReadTarget \|\| isClanSave \|\| isPlayerSelfRead/,
        'authorized admins and clan readers retain their full response projection',
    );
    assert.doesNotMatch(
        handlerSource,
        /persist:\s*(?:adminCanReadTarget|canReadFullSave)/,
        'full-read authorization must never be reused as elapsed-state write authority',
    );
});

test('only one settle-on-read call exists, so the gate cannot be bypassed', () => {
    const calls = handlerSource.match(/settleSaveRecordForRead\(/g) ?? [];
    assert.equal(
        calls.length,
        1,
        'a second settle-on-read call would need its own ownership gate; keep this to one site',
    );
});
