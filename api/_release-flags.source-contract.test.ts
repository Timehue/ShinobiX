import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

const ROOT = process.cwd();
const RELEASE_FLAGS_PATH = join(ROOT, 'api', '_release-flags.ts');

function productionTypeScriptFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return productionTypeScriptFiles(path);
        if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) return [];
        return [path];
    });
}

function source(relativePath: string): string {
    return readFileSync(join(ROOT, relativePath), 'utf8');
}

const CANONICAL_GATE_CONSUMERS = {
    villageWarMapEnabled: [
        'server.ts',
        'api/player/_public-capabilities.ts',
        'api/sector/merc-roam.ts',
        'api/village/war-map.ts',
        'api/village/war-structure.ts',
        'api/village/war-win-condition.ts',
        'api/village/war-terrain.ts',
        'api/village/sector-war.ts',
        'api/village/sector-card.ts',
        'api/village/sector-pet.ts',
        'api/village/war-merc.ts',
        'api/world-state.ts',
        'api/_war-tax-apply.ts',
        'api/_war-daily.ts',
        'api/_merc-auto.ts',
    ],
    anbuInfiltrationEnabled: [
        'api/player/_public-capabilities.ts',
        'api/village/anbu-infiltration.ts',
    ],
    clanBossEnabled: [
        'api/player/_public-capabilities.ts',
        'api/clan-boss/get.ts',
        'api/clan-boss/assault-start.ts',
        'api/clan-boss/assault-settle.ts',
        'api/cron/_clan-boss-weekly.ts',
        'api/admin/clan-boss-operations.ts',
    ],
    clanBossPartiesEnabled: [
        'api/player/_public-capabilities.ts',
        'api/clan-boss/party.ts',
        'api/clan-boss/assault-start.ts',
        'api/admin/clan-boss-operations.ts',
    ],
} as const;

describe('canonical public release-flag source contract', () => {
    it('keeps obsolete positive flags out of production and certification code', () => {
        const productionFiles = [join(ROOT, 'server.ts'), ...productionTypeScriptFiles(join(ROOT, 'api'))];
        for (const file of productionFiles) {
            if (file === RELEASE_FLAGS_PATH) continue;
            assert.doesNotMatch(
                readFileSync(file, 'utf8'),
                /\bENABLE_(?:VILLAGE_WAR|CLAN_BOSS)\b/,
                `${relative(ROOT, file)} must not depend on an obsolete positive flag`,
            );
        }
        assert.doesNotMatch(
            source('scripts/clan-boss-operation-certification.ts'),
            /\bENABLE_(?:VILLAGE_WAR|CLAN_BOSS)\b/,
        );
    });

    it('centralizes every public kill-switch read in _release-flags.ts', () => {
        const directFlagAccess = /\b(?:process\.)?env\s*(?:\.\s*(?:DISABLE_VILLAGE_WAR|DISABLE_CLAN_BOSS|DISABLE_CLAN_BOSS_PARTIES|DISABLE_ANBU_INFILTRATION)|\[\s*['"](?:DISABLE_VILLAGE_WAR|DISABLE_CLAN_BOSS|DISABLE_CLAN_BOSS_PARTIES|DISABLE_ANBU_INFILTRATION)['"]\s*\])/;
        for (const file of [join(ROOT, 'server.ts'), ...productionTypeScriptFiles(join(ROOT, 'api'))]) {
            if (file === RELEASE_FLAGS_PATH) continue;
            assert.doesNotMatch(
                readFileSync(file, 'utf8'),
                directFlagAccess,
                `${relative(ROOT, file)} must call a canonical release helper`,
            );
        }
    });

    it('keeps every mapped consumer on its canonical helper', () => {
        for (const [helper, files] of Object.entries(CANONICAL_GATE_CONSUMERS)) {
            const call = new RegExp(`\\b${helper}\\(`);
            for (const file of files) {
                assert.match(source(file), call, `${file} must call ${helper}`);
            }
        }
    });

    it('keeps world-state legacy Village War available with branch-only campaign fallbacks', () => {
        const worldState = source('api/world-state.ts');
        assert.equal(
            worldState.match(/\bvillageWarMapEnabled\(\)/g)?.length,
            2,
            'world-state should branch only at sector-war exclusion and WR-vs-seal declaration cost',
        );
        assert.doesNotMatch(worldState, /if\s*\(\s*!villageWarMapEnabled\(\)\s*\)\s*(?:return|\{)/);
    });
});
