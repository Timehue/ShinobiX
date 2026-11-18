import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { silenceRefusal } from './moderation.js';

const until = Date.UTC(2026, 10, 19, 3, 0, 0);

test('a silence refusal names the end, the recorded reason and the appeal address', () => {
    const out = silenceRefusal({ until, reason: 'Spamming sector chat', by: 'admin', at: 0 });
    assert.equal(out.error,
        'You are silenced until Thu, 19 Nov 2026 03:00 UTC. Reason: Spamming sector chat. To appeal, write to support@shinobijourney.com.');
    assert.deepEqual(out.silence, { until, reason: 'Spamming sector chat' });
});

test('a reason that already ends a sentence gets no second full stop', () => {
    assert.match(silenceRefusal({ until, reason: 'Slurs in clan chat!', by: 'a', at: 0 }).error, /Reason: Slurs in clan chat! To appeal/);
});

test('a silence with no recorded reason still says when it ends', () => {
    assert.equal(silenceRefusal({ until, reason: '  ', by: 'a', at: 0 }).error,
        'You are silenced until Thu, 19 Nov 2026 03:00 UTC. To appeal, write to support@shinobijourney.com.');
});

test('no API surface answers a silenced author with the bare message any more', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
        // Directory entries carry their type, so there is no separate stat to race.
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const name = entry.name, path = join(dir, name);
            if (entry.isDirectory()) { walk(path); continue; }
            if (!entry.isFile() || !name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
            if (readFileSync(path, 'utf8').includes("error: 'You are silenced.'")) offenders.push(path);
        }
    };
    walk('api');
    assert.deepEqual(offenders, [], 'use silenceRefusal() so the player sees the end and the reason');
});
