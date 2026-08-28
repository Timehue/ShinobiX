import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = (() => {
    let dir = process.cwd();
    for (let i = 0; i < 8; i++) {
        if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'api'))) return dir;
        const up = dirname(dir);
        if (up === dir) break;
        dir = up;
    }
    return process.cwd();
})();
const src = () => readFileSync(join(root, 'api/missions/ai-fight-start.ts'), 'utf8');

function productionTypeScriptFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return productionTypeScriptFiles(path);
        return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
            ? [path]
            : [];
    });
}

describe('generic AI fight standalone-runtime contract', () => {
    it('builds and persists a solo-pve session, never a Tower session', () => {
        const text = src();
        assert.match(text, /buildSoloPveAiEncounter\(/);
        assert.match(text, /writeSoloPveSession\(session\)/);
        assert.doesNotMatch(text, /buildAiFightEncounter\(|writeSession\(|_tower-store|TowerSession/);
    });

    it('does not reintroduce the retired Tower generic-AI constructor anywhere in production', () => {
        const retired = /\b(?:buildAiFightEncounter|buildAuthoritativeSoloEncounter|aiFightFloor|dynamicBossFloor|aiOpponentEnemyTemplate|AI_FIGHT_FLOOR_ID|ENDLESS_WAVE_FLOOR_ID)\b/;
        const offenders = productionTypeScriptFiles(join(root, 'api'))
            .filter((file) => retired.test(readFileSync(file, 'utf8')))
            .map((file) => file.slice(root.length + 1).replaceAll('\\', '/'));
        assert.deepEqual(offenders, []);
    });

    it('returns a mandatory sessionId and session', () => {
        const text = src();
        assert.match(text, /function genericStartBody\(/);
        assert.match(text, /sessionId: recovered\.pointer\.sessionId,\s*session: recovered\.session/);
        assert.match(text, /genericStartBody\(\{ pointer, token: record, session: sealed\.session \}, false\)/);
        assert.match(text, /if \(!sealed\) return \{ status: 404, body: \{ error: 'AI opponent is not published on the server\.' \} \}/);
        assert.doesNotMatch(text, /return undefined|serverAiCombatEnabled|DISABLE_SERVER_AI_COMBAT/);
    });

    it('binds the reward token to the explicit solo-pve runtime', () => {
        const text = src();
        assert.match(text, /sessionRuntime: 'solo-pve',\s*sessionId: sealed\.sessionId/);
        assert.doesNotMatch(text, /\brunId,\s*\n\s*\}\);/);
    });

    it('ignores hostLoadout and derives scaling from server state', () => {
        const text = src();
        assert.doesNotMatch(text, /hostLoadout/);
        assert.match(text, /resolveAiFightScaling\(\{/);
        const sealFn = text.slice(text.indexOf('async function sealAiFightEncounter'), text.indexOf('export default'));
        const code = sealFn.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        assert.doesNotMatch(code, /opponentLevel/);
    });

    it('reconciles a matured travel receipt before validating a World encounter sector', () => {
        const text = src();
        const settle = text.indexOf('settleMaturedTravelForAction(playerName, worldStartNow)');
        const saveRead = text.indexOf('kv.get<Record<string, unknown>>(`save:${playerName}`)', settle);
        const validate = text.indexOf('buildWorldAiFightSpec({', saveRead);
        assert.ok(settle >= 0 && saveRead > settle && validate > saveRead);
        assert.match(text, /const arrivedSector = worldRequest\s*\? await settleMaturedTravelForAction\(playerName, worldStartNow\)\s*: null;/);
        assert.match(text, /if \(save && arrivedSector != null\) save = \{ \.\.\.save, currentSector: arrivedSector \};/);
        assert.match(text.slice(validate), /now: worldStartNow/);
    });
});
