import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./TownHall.tsx', import.meta.url), 'utf8');

test('the orders composer is locked to current leadership, never a personal focus', () => {
    const permissions = source.slice(source.indexOf('const villageOrderRole ='), source.indexOf('async function declareChallenge'));
    assert.match(permissions, /serverKage\?\.seatedKage/);
    assert.match(permissions, /isSeatedElder \? "Village Elder" : isAnbu \? "ANBU" : null/);
    assert.doesNotMatch(permissions, /character\.elderFocus|rankTitle|storyTitle/);
    assert.match(permissions, /if \(!canPostVillageOrder\) return alert/);
    assert.match(source, /!canPostVillageOrder && <p className="hint town-orders-locked"/);
    assert.match(source, /\{canPostVillageOrder && <div className="summary-box">/);
});

test('pin and delete controls and handlers require current leadership ownership', () => {
    assert.match(source, /const canEditNotice = canManageVillageNotice\(notice.author\)/);
    assert.match(source, /canPostVillageOrder && \(villageOrderRole === "Kage" \|\| author\.toLowerCase\(\)/);
    const handlers = source.slice(source.indexOf('function removeVillageNotice'), source.indexOf('async function declareChallenge'));
    assert.equal(handlers.match(/!canManageVillageNotice\(notice.author\)/g)?.length, 2);
});

test('order actions adopt server confirmation instead of replacing the shared board', () => {
    const actions = source.slice(source.indexOf('async function submitVillageOrder'), source.indexOf('async function declareChallenge'));
    assert.match(actions, /fetch\('\/api\/village\/orders'/);
    assert.match(actions, /adoptVillageOrders\(character\.village, noticePosts\)/);
    assert.doesNotMatch(actions, /updateVillageState/);
    assert.match(actions, /if \(!await submitVillageOrder\("post", notice\)\) return/);
    assert.match(source, /disabled=\{villageOrderBusy \|\| !villageNoticeTitle/);
});
