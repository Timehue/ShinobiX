import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { adminTokenProblem, BATCH_SIZE, batches, classify, cleanAdminToken, plannedSlots, RETIRED_AVATAR_SLOTS } from './retire-old-vn-images.mts';
import { BATCH_DELETE_MAX } from '../api/images.ts';

test('removal goes out in batches the server accepts, covering every slot exactly once', () => {
    const ids = plannedSlots().map(p => p.slot);
    const chunks = batches(ids, BATCH_SIZE);
    assert.ok(BATCH_SIZE <= BATCH_DELETE_MAX);
    assert.ok(chunks.every(c => c.length > 0 && c.length <= BATCH_SIZE));
    assert.deepEqual(chunks.flat(), ids);
    assert.equal(chunks.length, Math.ceil(ids.length / BATCH_SIZE));
});

test('a token pasted from the browser console works with or without its quotes; unusable values stop the run first', () => {
    const now = Date.UTC(2026, 8, 19, 12);
    const valid = `av1.full.${now + 3_600_000}.0.c2lnbmF0dXJl`;
    for (const pasted of [valid, `'${valid}'`, `"${valid}"`, `  '${valid}'  `]) assert.equal(cleanAdminToken(pasted), valid);
    assert.equal(adminTokenProblem(valid, now), undefined);
    assert.equal(adminTokenProblem(`av1.content.${now + 1}.0.sig`, now), undefined);
    assert.match(adminTokenProblem(cleanAdminToken("'null'")!, now)!, /same browser tab/);
    assert.match(adminTokenProblem('my-admin-password', now)!, /av1\.full\./);
    assert.match(adminTokenProblem(`av1.full.${now - 1}.0.sig`, now)!, /expired/);
    assert.equal(cleanAdminToken('   '), undefined);
});
import { RETIRED_VN_ART } from '../shinobij.client/src/lib/vn-retired-artwork.ts';

test('only bytes that still equal a retired hash are deleted; newer uploads and missing slots are left alone', () => {
    const expected = new Set(['aaa']);
    assert.equal(classify(expected, { status: 200, sha: 'aaa' }), 'retire');
    assert.equal(classify(expected, { status: 200, sha: 'bbb' }), 'keep-newer-upload');
    assert.equal(classify(expected, { status: 404 }), 'already-gone');
    assert.equal(classify(expected, { status: 503 }), 'unreadable');
});

test('the code list, the cleanup manifest and the art review record agree slot for slot', () => {
    const manifest = JSON.parse(readFileSync(new URL('../docs/art-audit/live-cleanup-manifest.json', import.meta.url), 'utf8')) as
        { count: number; candidates: { id: string; sha256: string; rollbackFixture: string }[] };
    const record = JSON.parse(readFileSync(new URL('../docs/art-audit/live-art-recheck.json', import.meta.url), 'utf8')) as
        { rows: { id: string; decision?: string }[] };
    const plan = new Map(plannedSlots().map(p => [p.slot, p.expected]));
    const planned = [...plan.keys()].sort();
    assert.equal(manifest.count, manifest.candidates.length);
    assert.deepEqual(manifest.candidates.map(c => c.id).sort(), planned, 'cleanup manifest = code list');
    for (const c of manifest.candidates) {
        assert.ok(plan.get(c.id)!.has(c.sha256), `${c.id}: manifest hash is not the retired hash`);
        assert.ok(existsSync(new URL(`../${c.rollbackFixture}`, import.meta.url)), `${c.id}: rollback fixture missing`);
    }
    const retiredInRecord = record.rows.filter(r => /^(?:retire|unused premium avatar)/.test(r.decision ?? '')).map(r => r.id).sort();
    assert.deepEqual(retiredInRecord, planned, 'review record = code list');
    const kept = record.rows.filter(r => (r.decision ?? '').startsWith('keep')).map(r => r.id);
    assert.equal(kept.length, 15);
    assert.ok(kept.every(id => /^event:craft-dungeon-[a-z]+:(?:warden|tilescene|pet)$/.test(id)), 'only dungeon warden, altar and rare-pet art is kept');
});

test('the plan covers every retired slot plus the four draft avatars, and avatars only match retired bytes', () => {
    const plan = plannedSlots();
    assert.equal(plan.length, Object.keys(RETIRED_VN_ART).length + RETIRED_AVATAR_SLOTS.length);
    const avatar = plan.find(p => p.slot === 'event:builtin-awakening-lv2:avatar')!;
    assert.ok([...avatar.expected].every(sha => Object.values(RETIRED_VN_ART).includes(sha)));
    assert.ok(plan.every(p => /^(?:vn|event):/.test(p.slot)), 'never targets non-VN image categories');
});
