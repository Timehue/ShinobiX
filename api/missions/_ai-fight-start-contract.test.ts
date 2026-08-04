import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
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

describe('generic AI fight standalone-runtime contract', () => {
    it('builds and persists a solo-pve session, never a Tower session', () => {
        const text = src();
        assert.match(text, /buildSoloPveAiEncounter\(/);
        assert.match(text, /writeSoloPveSession\(session\)/);
        assert.doesNotMatch(text, /buildAiFightEncounter\(|writeSession\(|_tower-store|TowerSession/);
    });

    it('returns a mandatory sessionId and session', () => {
        const text = src();
        assert.match(text, /sessionId: sealed\.sessionId,\s*session: sealed\.session/);
        assert.match(text, /if \(!sealed\) return res\.status\(404\)/);
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
});
