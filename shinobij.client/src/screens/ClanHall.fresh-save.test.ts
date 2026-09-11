import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// The Clan Hall loads the clan once and does not poll, but every change writes
// the WHOLE document back. Writing from the hall's own copy replayed members,
// join requests, notices and (until the validator stopped it) the treasury from
// before other players' changes. Source-level, because the screen cannot be
// rendered in node without its whole App graph.
const screen = readFileSync(new URL('./ClanHall.tsx', import.meta.url), 'utf8');

test('every clan change is applied to a copy read just before the write', () => {
    assert.match(screen, /async function saveClan\(change: \(latest: EnhancedClanData\) => EnhancedClanData\)/);
    const save = screen.slice(screen.indexOf('async function saveClan('), screen.indexOf('// Claim a completed clan mission'));
    assert.match(save, /const latest = await fetchClanDataDetailed\(clanData\.name\);/);
    assert.match(save, /const enhanced = enhanceClanData\(change\(enhanceClanData\(latest\.data\)\)\);/);
    assert.match(save, /await writeClanUpdate\(enhanced\);/);
    // No call site may hand saveClan the hall's own copy again.
    assert.doesNotMatch(screen, /saveClan\(\{ \.\.\.clanData/);
    assert.doesNotMatch(screen, /saveClan\(updated\)/);
});

test('only founding and reclaiming a clan send the whole record, treasury included', () => {
    assert.equal(screen.match(/writeClanData\(/g)?.length, 2);
    assert.match(screen, /try \{ await writeClanData\(newClan\); \}/);
    // The load-time member sync and the join request are updates to a clan
    // that already exists.
    assert.match(screen, /writeClanUpdate\(synced\)\.catch/);
    assert.match(screen, /try \{ await writeClanUpdate\(updated\); \}/);
});

test('a join request is appended to the clan as it stands now, not the browser list copy', () => {
    const request = screen.slice(screen.indexOf('async function requestJoinClan('), screen.indexOf('async function acceptJoinRequest('));
    assert.match(request, /const latest = await fetchClanDataDetailed\(targetClan\.name\);/);
    assert.match(request, /joinRequests: \[\.\.\.fresh\.joinRequests, request\]/);
});

test('collecting War Supply adopts the credited treasury without re-saving the clan', () => {
    const collect = screen.slice(screen.indexOf('async function collectTerritoryWarSupply('), screen.indexOf('function refreshTerritoryPanel('));
    assert.doesNotMatch(collect, /saveClan\(/);
    assert.match(collect, /setClanData\(\(previous\) => previous \? enhanceClanData\(\{ \.\.\.previous, treasury: cleanClanTreasury\(/);
    // The dead blob-spend of War Supply is gone: the validator refuses it now.
    assert.doesNotMatch(screen, /_spendWarSupplyOnActiveWar/);
});
