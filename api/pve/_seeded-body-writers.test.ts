import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';

/*
 * A fight seeded from the save settles by charging what the save has lost since
 * the fight was sealed (missions/_ai-fight-outcome.ts `vitalLostSinceSeal`).
 * Unlike the absolute write it replaced, that is NOT idempotent: written twice,
 * the fight's own cost would be read as "lost since" and charged again. So a
 * fight's body is written at most once, against the shared pve-outcome receipt
 * (api/pve/_fight-outcome-settlement.ts) that every settling path checks and
 * stamps: the generic path, a mode's own settlement, a later fight's start.
 *
 * The ratchet: a non-test api file that reads a fight's seal must also go
 * through that receipt, or be listed below with the reason it need not. A new
 * settle path fails here until someone makes that decision on purpose. The
 * behaviour of each listed path is pinned in _delayed-settlement-paths.test.ts
 * and _delayed-settlement-journeys.test.ts.
 */

/** Reading a seal is the only way to apply one. */
const READS_A_SEAL = /\b(?:sessionSeededVitals|vitalLostSinceSeal)\(/;
/** The shared receipt, checked and stamped. */
const ONCE_ONLY = /\b(?:applyPveOutcomeWithReceipt|applyPveOutcomeBodyOnce|pveOutcomeBodyWritten|stampPveOutcomeBody)\(/;

/** Files that read a seal WITHOUT the shared receipt, and why that is right. */
const EXEMPT: Record<string, string> = {
    'api/missions/_ai-fight-outcome.ts': 'defines the seal readers and the pure settlement they feed',
};

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;
        const absolute = join(dir, entry.name);
        if (entry.isDirectory()) sourceFiles(absolute, out);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(absolute);
    }
    return out;
}

describe('every path that applies a fight\'s seal writes its body at most once', () => {
    // process.cwd(), like the other api source scans: api tests also compile
    // into the CommonJS server build, where import.meta is not allowed.
    const root = process.cwd();
    const readers = sourceFiles(join(root, 'api'))
        .filter((file) => READS_A_SEAL.test(readFileSync(file, 'utf8')))
        .map((file) => relative(root, file).replaceAll('\\', '/'));

    it('still finds the paths that apply a seal (the scan matches real code)', () => {
        for (const known of ['api/pve/_fight-outcome-settlement.ts', 'api/story/settle.ts', 'api/hollow-gate/combat-settle.ts']) {
            assert.ok(readers.includes(known), `${known} should be detected as applying a fight's seal`);
        }
    });

    it('each one goes through the shared pve-outcome receipt or carries a reason', () => {
        const unguarded = readers.filter((file) => !EXEMPT[file] && !ONCE_ONLY.test(readFileSync(join(root, file), 'utf8')));
        assert.deepEqual(unguarded, [], `These files apply a fight's seal without the shared once-only receipt, so a second settlement would charge the fight twice. Write the body through applyPveOutcomeBodyOnce (or check pveOutcomeBodyWritten and stampPveOutcomeBody) in api/pve/_fight-outcome-settlement.ts, or add the file to EXEMPT with the reason:\n${unguarded.join('\n')}`);
    });

    it('lists no stale exemptions', () => {
        const stale = Object.keys(EXEMPT).filter((file) => !readers.includes(file));
        assert.deepEqual(stale, [], 'an exempt file no longer reads a seal; drop it from EXEMPT');
    });
});
