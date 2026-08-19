import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

/*
 * Replaces VillageWarMap.garrison-retired.test.ts (deleted). That file pinned
 * the retired UI's absence (no button, no request wrapper). This is the real,
 * rebuilt contract: the "Assault Garrison" button is back, wired to the
 * two-step garrison-start / garrison-resolve flow on a dedicated screen — a
 * genuine Solo PvE fight against the defending village's sealed ANBU, not the
 * old single-shot headless roll.
 */

const screen = readFileSync(new URL('./VillageWarMap.tsx', import.meta.url), 'utf8');
const client = readFileSync(new URL('../lib/village-war-map.ts', import.meta.url), 'utf8');
const garrisonApi = readFileSync(new URL('../lib/sector-war-garrison-api.ts', import.meta.url), 'utf8');
const garrisonScreen = readFileSync(new URL('./SectorWarGarrisonAssault.tsx', import.meta.url), 'utf8');

describe('Village War Map garrison UI contract', () => {
    it('exposes the Assault Garrison button, gated on garrisonAssaultable, only for the attacking Kage\'s own village', () => {
        assert.match(screen, /Assault Garrison/);
        assert.match(screen, /garrisonAssaultable\(contest\)/);
        assert.match(screen, /contest\.attackerVillage === myVillage/);
        assert.match(screen, /launchGarrisonAssault\(sec\.sector\)/);
    });

    it('launches the garrison screen by stashing the sector, not by calling the old single-shot request directly', () => {
        assert.match(screen, /sessionStorage\.setItem\("sectorWarGarrison\.v1", JSON\.stringify\(\{ sector \}\)\)/);
        assert.match(screen, /setScreen\("sectorGarrison"\)/);
        // The retired one-shot client wrapper (action: "garrison") must never
        // come back — the server 410s it, and it bypassed the Solo PvE fight
        // entirely.
        assert.doesNotMatch(screen, /action:\s*["']garrison["']/);
        assert.doesNotMatch(client, /action:\s*["']garrison["']/);
    });

    it('keeps human Sector PvP registration and resolution available', () => {
        assert.match(client, /export function registerSectorBattle\(/);
        assert.match(client, /action:\s*"attack"/);
        assert.match(client, /export function resolveSectorBattle\(/);
        assert.match(client, /action:\s*"resolve"/);
    });

    it('client and server agree on the garrison liveness-unlock window', () => {
        assert.match(client, /GARRISON_UNLOCK_IDLE_MS = 2 \* 60 \* 60 \* 1000/);
        assert.match(client, /export function garrisonAssaultable\(/);
    });

    it('the garrison API wraps the real two-step actions, never a client-reported outcome', () => {
        assert.match(garrisonApi, /action:\s*'garrison-start'/);
        assert.match(garrisonApi, /action:\s*'garrison-resolve'/);
        assert.match(garrisonApi, /ROUTE = '\/api\/village\/sector-war'/);
        // The RESOLVE request body carries only the runId + playerName — no
        // win/loss/outcome field the client could claim. (attackerWon/outcome
        // only appear as RESPONSE-shape fields the server hands back.)
        const resolveCallBody = garrisonApi.match(/return post\(\{ action: 'garrison-resolve'[^)]*\}\);/)?.[0];
        assert.ok(resolveCallBody, 'expected to find the garrison-resolve request body');
        assert.doesNotMatch(resolveCallBody!, /winner|attackerWon|outcome/);
        assert.match(resolveCallBody!, /runId, playerName/);
    });

    it('the garrison screen reuses the normal Solo PvE Arena shell, not a bespoke combat loop', () => {
        assert.match(garrisonScreen, /import \{ MissionArenaFight \} from "\.\/MissionArenaFight"/);
        assert.match(garrisonScreen, /settleFn=\{settleGarrison\}/);
        assert.match(garrisonScreen, /settleOnAnyDone/);
        assert.match(garrisonScreen, /onVersionedCharacter\(r\.character, r\._saveVersion\)/);
    });
});
