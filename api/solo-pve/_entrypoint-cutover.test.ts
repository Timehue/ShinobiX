import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

function source(relative: string): string {
    return readFileSync(resolve(process.cwd(), 'api/solo-pve', relative), 'utf8');
}

const serverEntrypoints = [
    '../missions/combat-start.ts',
    '../missions/queue-combat-claim.ts',
    '../story/boss-start.ts',
    '../story/spar-start.ts',
    '../story/settle.ts',
];

test('migrated mission and story endpoints have no Tower or client-trust authority path', () => {
    for (const path of serverEntrypoints) {
        const text = source(path);
        assert.doesNotMatch(text, /towers\//, `${path} imports Tower runtime code`);
        assert.doesNotMatch(text, /hostLoadout|clientTrusted|aiFightToken|legacy-client/, `${path} retains client combat authority`);
        assert.match(text, /solo-pve|SoloPve/, `${path} is not wired to the solo-PvE runtime`);
    }
});

test('all built-in mission ranks and both story lanes use the solo-PvE arena adapter', () => {
    const missions = source('../../shinobij.client/src/screens/Missions.tsx');
    const storyHost = source('../../shinobij.client/src/components/StoryBossFightHost.tsx');
    const storyApi = source('../../shinobij.client/src/lib/story-combat-api.ts');
    for (const [name, text] of [['Missions', missions], ['StoryBossFightHost', storyHost], ['story-combat-api', storyApi]] as const) {
        assert.doesNotMatch(text, /towers-api|towerArenaTransport|TowerSession|TowerHostLoadout|hostLoadout/, `${name} retains Tower wire semantics`);
    }
    assert.match(missions, /soloPveArenaTransport/);
    assert.match(storyHost, /soloPveArenaTransport/);
    assert.doesNotMatch(missions, /mission\.min\s*>\s*5|setPendingAiProfileId\(ai\.id\)/, 'E/D missions can still resolve locally');
    assert.doesNotMatch(storyHost, /playLocally/);
    const missionClaim = source('../missions/queue-combat-claim.ts');
    assert.match(missionClaim, /settleSoloPveTerminalUsage\(initialSession!, playerName\)[\s\S]{0,240}settlePveFightOutcome\(usage\.session, playerName\)/);
    assert.doesNotMatch(missionClaim, /solo-pve-usage:mission:/, 'legacy eviction-prone NX usage receipt remains');
    assert.match(source('_pet-battle-authority.ts'), /SOLO_PVE_COMPANION_SETTLEMENTS_FIELD/);
    assert.match(source('_item-usage-authority.ts'), /SOLO_PVE_ITEM_SETTLEMENTS_FIELD/);
});

test('shared PvE outcome reporting can read solo sessions before legacy Tower sessions', () => {
    const text = source('../pve/fight-outcome.ts');
    assert.match(text, /readSoloPveSession\(runId\)[\s\S]{0,120}\?\? await readSession\(runId\)/);
});
