import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

/*
 * Guard against the save-shape class of bug.
 *
 * `acceptedMissionIds`, `missionProgress` and `currentSector` are TOP-LEVEL
 * fields on the save record — App.tsx persists them beside `character`, never
 * inside it. Three mission progress producers each read them off
 * `record.character` instead, where they are permanently undefined. Nothing
 * threw and nothing logged: the producers simply concluded the player had
 * accepted no missions and wrote no receipt. Verified against production, the
 * `missions:progress:*` keyspace was EMPTY across every player, so every
 * built-in field mission and every Hunter contract was unclaimable game-wide —
 * each one rejected with "missing-progress-receipt", surfaced to the player as
 * "Finish this mission's required field progress first" on a card whose
 * progress bar was already full.
 *
 * The unit tests around it all passed because their fixtures encoded the wrong
 * shape too (a bare character carrying acceptedMissionIds), so this file pins
 * the contract at the source level instead: the fields are top-level, and the
 * producers must reach them through the sanctioned readers.
 */

// Resolved from process.cwd() (the repo root, which run-tests.mjs sets as the
// run cwd) rather than import.meta — the cPanel CJS server build rejects
// import.meta with TS1470, so every filesystem-reading test here does the same.
const apiRoot = path.join(process.cwd(), 'api');

/** Save fields that live on the RECORD and are never character properties. */
const TOP_LEVEL_SAVE_FIELDS = ['acceptedMissionIds', 'missionProgress', 'currentSector'] as const;

/**
 * The producers that mint progress receipts. Each one decides whether a player
 * has accepted a mission, so each one must read that off the record.
 */
const PROGRESS_PRODUCERS = [
    'missions/record-progress.ts',
    'missions/_field-raid-progress.ts',
    'missions/report-ai-fight.ts',
];

/** The one module allowed to touch these fields directly — it IS the reader. */
const READER_MODULE = 'missions/_mission-progress-receipt.ts';

function read(rel: string): string {
    return fs.readFileSync(path.join(apiRoot, rel), 'utf8');
}

function apiSourceFiles(dir = apiRoot, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === 'dist') continue;
            apiSourceFiles(full, out);
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
            out.push(path.relative(apiRoot, full).split(path.sep).join('/'));
        }
    }
    return out;
}

const FIELDS = TOP_LEVEL_SAVE_FIELDS.join('|');

/**
 * Property reads of a top-level save field through a character-shaped receiver:
 * `char.acceptedMissionIds`, `character?.currentSector`, `save.character.missionProgress`.
 * Object-literal keys and type members (no leading dot) are deliberately not matched.
 *
 * Name-based, so it only catches receivers actually spelled like a character. An
 * alias that hides the shape (`const rc = result.character`) slips past it — which
 * is exactly what the third producer did, and why the producer check below bans
 * ALL raw reads of these fields regardless of what the receiver is called.
 */
function characterScopedReads(source: string): string[] {
    return source.match(new RegExp(`\\b[\\w$]*[Cc]har[\\w$]*\\s*[?!]?\\s*\\.\\s*(?:${FIELDS})\\b`, 'g')) ?? [];
}

/** Any raw property read of a top-level save field, whatever the receiver. */
function rawFieldReads(source: string): string[] {
    return source.match(new RegExp(`\\.\\s*(?:${FIELDS})\\b`, 'g')) ?? [];
}

describe('save-field shape contract', () => {
    it('pins the three fields as TOP-LEVEL save fields, per the ownership manifest', async () => {
        // The save pipeline's declaration of where these fields live moved into
        // the canonical ownership manifest (P0-1). If a future change moves one
        // onto the character, this fails first and the producers below need
        // revisiting in the same breath.
        const ownership = await import('../save/_state-ownership.js');
        for (const field of TOP_LEVEL_SAVE_FIELDS) {
            assert.ok(
                ownership.COMBAT_STRIP_TOPLEVEL_FIELDS.includes(field),
                `${field} must be declared a top-level save field`,
            );
            const defs = ownership.definitionsFor(field);
            assert.ok(
                defs.some((d) => d.scope === 'top') && !defs.some((d) => d.scope === 'character'),
                `${field} must be classified at top scope only`,
            );
        }
    });

    it('REGRESSION: every progress producer reads accepted missions off the record', () => {
        for (const rel of PROGRESS_PRODUCERS) {
            const source = read(rel);
            assert.ok(
                source.includes('savedAcceptedMissionIds'),
                `${rel} must resolve accepted missions via savedAcceptedMissionIds, not a raw property read`,
            );
            assert.deepEqual(
                rawFieldReads(source),
                [],
                `${rel} reads a top-level save field directly; go through the savedX readers so the receiver's shape can't be wrong`,
            );
        }
    });

    it('no api/ handler reads a top-level save field off a character', () => {
        const offenders: string[] = [];
        for (const rel of apiSourceFiles()) {
            if (rel === READER_MODULE) continue;
            for (const hit of characterScopedReads(read(rel))) offenders.push(`${rel}: ${hit}`);
        }
        assert.deepEqual(offenders, [], `top-level save fields read off a character:\n${offenders.join('\n')}`);
    });
});
