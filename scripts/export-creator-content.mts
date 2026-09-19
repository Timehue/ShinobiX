/**
 * Read-only export of Creator (admin-authored) narrative content for
 * `npm run narrative:audit -- --content <file>`.
 *
 *   SHINOBIX_BASE_URL=https://<host> ADMIN_TOKEN=<admin session token> \
 *     node --import tsx scripts/export-creator-content.mts .tmp/creator-export.json
 *
 * ADMIN_PASSWORD (content or full) works too unless the server runs with
 * ADMIN_STRICT_TOKEN_ONLY=1. Credentials come from the environment only and are
 * never printed or written. It issues GET /api/save/admin1 and /api/save/admin2,
 * the same authenticated read the Admin Panel uses; an admin read never bumps a
 * save version. The published `content:*` store has no value-read route, so it
 * is exported as empty; say so in any review that relies on this file.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Fields that hold narrative scenes or authored narrative copy. */
export const CREATOR_NARRATIVE_FIELDS = ['creatorEvents', 'petEncounterVn', 'ancientChestVn', 'hollowGateEventConfig', 'creatorMissions', 'creatorRaids'] as const;

export function buildCreatorExport(slots: Record<string, Record<string, unknown> | null>, source: string, now = new Date()) {
    return {
        exportedAt: now.toISOString(),
        source,
        slots: Object.fromEntries(Object.entries(slots).map(([name, save]) => [
            name,
            Object.fromEntries(CREATOR_NARRATIVE_FIELDS.map(field => [field, save?.[field] ?? null])),
        ])),
        published: {},
    };
}

async function main() {
    const base = process.env.SHINOBIX_BASE_URL?.replace(/\/+$/, '');
    const token = process.env.ADMIN_TOKEN, password = process.env.ADMIN_PASSWORD;
    if (!base || (!token && !password)) {
        console.error('Set SHINOBIX_BASE_URL and ADMIN_TOKEN (or ADMIN_PASSWORD). Nothing was requested.');
        process.exitCode = 2;
        return;
    }
    const headers: Record<string, string> = token ? { 'x-admin-token': token } : { 'x-admin-password': password! };
    const slots: Record<string, Record<string, unknown> | null> = {};
    for (const slot of ['admin1', 'admin2']) {
        const response = await fetch(`${base}/api/save/${slot}`, { headers });
        if (!response.ok) throw new Error(`GET /api/save/${slot} returned ${response.status}. Check the admin credential.`);
        slots[slot] = await response.json() as Record<string, unknown>;
    }
    const out = resolve(process.argv[2] ?? '.tmp/creator-export.json');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(buildCreatorExport(slots, `${base} GET /api/save/admin1, /api/save/admin2 (admin read)`), null, 2));
    console.log(`Wrote ${out}. Next: npm run narrative:audit -- --content ${out}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    main().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    });
