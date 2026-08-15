import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const screen = readFileSync(new URL('./VillageWarMap.tsx', import.meta.url), 'utf8');
const client = readFileSync(new URL('../lib/village-war-map.ts', import.meta.url), 'utf8');

describe('Village War Map retired garrison UI contract', () => {
    it('does not expose a garrison attack button or request wrapper', () => {
        assert.doesNotMatch(screen, /Assault Garrison|assaultSectorGarrison|garrisonAssaultable|gar-\$\{/);
        assert.doesNotMatch(client, /assaultSectorGarrison|action:\s*["']garrison["']/);
    });

    it('keeps human Sector PvP registration and resolution available', () => {
        assert.match(client, /export function registerSectorBattle\(/);
        assert.match(client, /action:\s*"attack"/);
        assert.match(client, /export function resolveSectorBattle\(/);
        assert.match(client, /action:\s*"resolve"/);
    });
});
