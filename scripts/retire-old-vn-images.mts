/**
 * Remove the pre-rebuild VN uploads and the old Relic Dungeon entrance
 * backdrops that the game already hides (lib/vn-retired-artwork.ts), so no
 * stored copy can ever surface again.
 *
 *   Dry run (default, read-only, no credentials):
 *     SHINOBIX_BASE_URL=https://<host> node --import tsx scripts/retire-old-vn-images.mts
 *   Delete (the owner runs this with an admin session token):
 *     SHINOBIX_BASE_URL=https://<host> ADMIN_TOKEN=<token> node --import tsx scripts/retire-old-vn-images.mts --apply
 *   Undo from the backup the dry run and --apply both write first:
 *     SHINOBIX_BASE_URL=https://<host> ADMIN_TOKEN=<token> node --import tsx scripts/retire-old-vn-images.mts --restore <backup dir>
 *
 * Every slot is downloaded and hashed first. A slot is deleted only when its
 * current bytes still equal the retired hash, so an image an admin uploaded
 * later to the same slot is never touched. Deletion uses the app's batch form,
 * DELETE /api/images with { ids }, 100 per request: it clears R2, the per-image
 * keys, the asset registry and the cache version, rewrites the category hash
 * and legacy bundle ONCE per request, and writes one audit entry. (One DELETE
 * per image rewrote those multi-MB records every time and filled the database
 * disk on 2026-09-19.) Direct database deletes would be resurrected from the
 * legacy bundles by /api/img. Each run backs up to its own timestamped folder.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RETIRED_VN_ART } from '../shinobij.client/src/lib/vn-retired-artwork.ts';

/** Event-level avatars from the same drafts. The reader never shows them (story
 *  chapters use cast portraits; the Narrator slot hides), and their bytes are
 *  identical to retired portraits. They qualify only if the bytes match. */
export const RETIRED_AVATAR_SLOTS = [
    'event:builtin-awakening-lv2:avatar', 'event:story-ashen-leaf-village-85-7:avatar',
    'event:story-frostfang-village-4-0:avatar', 'event:sys-ancient-chest:avatar',
] as const;

export type SlotPlan = { slot: string; status: 'retire' | 'keep-newer-upload' | 'already-gone' | 'unreadable'; sha?: string; bytes?: number; contentType?: string };

export function plannedSlots(): { slot: string; expected: ReadonlySet<string> }[] {
    const retiredHashes = new Set(Object.values(RETIRED_VN_ART));
    return [
        ...Object.entries(RETIRED_VN_ART).map(([slot, sha]) => ({ slot, expected: new Set([sha]) })),
        ...RETIRED_AVATAR_SLOTS.map(slot => ({ slot, expected: retiredHashes })),
    ];
}

export function classify(expected: ReadonlySet<string>, fetched: { status: number; sha?: string }): SlotPlan['status'] {
    if (fetched.status === 404) return 'already-gone';
    if (fetched.status !== 200 || !fetched.sha) return 'unreadable';
    return expected.has(fetched.sha) ? 'retire' : 'keep-newer-upload';
}

const safeName = (slot: string) => slot.replace(/[^A-Za-z0-9_-]+/g, '_');

/** Images per batch removal request (the server allows up to 300). */
export const BATCH_SIZE = 100;
export const RESTORE_MAX_PER_RUN = 20;
export function batches<T>(items: readonly T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

/** The browser console prints the token in quotes; people copy them along. */
export function cleanAdminToken(raw: string | undefined): string | undefined {
    const value = raw?.trim().replace(/^(['"`])(.*)\1$/s, '$2').trim();
    return value || undefined;
}

/** Catch an unusable token before any request is made. */
export function adminTokenProblem(token: string, now = Date.now()): string | undefined {
    if (token === 'null' || token === 'undefined')
        return `ADMIN_TOKEN is "${token}". Run sessionStorage.getItem('admin:token') in the same browser tab where you are logged in to the Admin Panel. If it is null even there, the server is not issuing admin tokens: set ADMIN_PASSWORD instead of ADMIN_TOKEN.`;
    const parts = token.split('.');
    if (parts.length !== 5 || parts[0] !== 'av1' || (parts[1] !== 'full' && parts[1] !== 'content'))
        return 'ADMIN_TOKEN does not look like an admin session token. It should start with av1.full. (copy the value, the quotes do not matter).';
    if (!(Number(parts[2]) > now)) return 'ADMIN_TOKEN has expired (they last 12 hours). Log in to the Admin Panel again and copy a fresh one.';
    return undefined;
}

/** One read-only admin request, so a rejected credential stops the run before anything is deleted. */
async function requireAdminAccess(base: string, auth: Record<string, string>): Promise<void> {
    const res = await fetch(`${base}/api/save/admin1`, { headers: auth });
    if (res.status === 401 || res.status === 403) throw new Error(`The server did not accept the admin credential (GET /api/save/admin1 returned ${res.status}). Nothing was changed. Copy a fresh token from the Admin Panel tab and try again.`);
    if (!res.ok && res.status !== 404) throw new Error(`The server is not healthy (GET /api/save/admin1 returned ${res.status}). Nothing was changed. Try again later.`);
}

async function main() {
    const args = process.argv.slice(2);
    const base = process.env.SHINOBIX_BASE_URL?.replace(/\/+$/, '');
    if (!base) { console.error('Set SHINOBIX_BASE_URL. Nothing was requested.'); process.exitCode = 2; return; }
    const token = cleanAdminToken(process.env.ADMIN_TOKEN), password = process.env.ADMIN_PASSWORD?.trim();
    const tokenProblem = token ? adminTokenProblem(token) : undefined;
    if (tokenProblem) throw new Error(`${tokenProblem} Nothing was changed.`);
    const auth: Record<string, string> = token ? { 'x-admin-token': token } : password ? { 'x-admin-password': password } : {};
    const restoreDir = args.includes('--restore') ? args[args.indexOf('--restore') + 1] : undefined;

    if (restoreDir) {
        if (!Object.keys(auth).length) throw new Error('--restore needs ADMIN_TOKEN or ADMIN_PASSWORD.');
        await requireAdminAccess(base, auth);
        const manifest = JSON.parse(readFileSync(join(restoreDir, 'manifest.json'), 'utf8')) as SlotPlan[];
        const only = args.includes('--slots') ? new Set(args[args.indexOf('--slots') + 1]?.split(',')) : undefined;
        const toRestore = manifest.filter(e => e.status === 'retire' && (!only || only.has(e.slot)));
        // Each upload rewrites the whole category hash (several MB), so a bulk
        // restore has the same disk cost as the bulk delete that caused the
        // 2026-09-19 outage. Restore a few chosen slots at a time.
        if (toRestore.length > RESTORE_MAX_PER_RUN)
            throw new Error(`That would restore ${toRestore.length} images one upload at a time, and each upload rewrites several MB of database rows. Pick at most ${RESTORE_MAX_PER_RUN} with --slots id1,id2,... Nothing was changed.`);
        for (const entry of toRestore) {
            const file = join(restoreDir, `${safeName(entry.slot)}.bin`);
            const image = `data:${entry.contentType};base64,${readFileSync(file).toString('base64')}`;
            const res = await fetch(`${base}/api/images`, { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify({ id: entry.slot, image }) });
            console.log(`${res.ok ? 'restored' : `FAILED ${res.status}`}  ${entry.slot}`);
        }
        return;
    }

    const apply = args.includes('--apply');
    if (apply && !Object.keys(auth).length) throw new Error('--apply needs ADMIN_TOKEN or ADMIN_PASSWORD.');
    if (apply) await requireAdminAccess(base, auth);
    // A fresh folder per run, so a later run never overwrites an earlier, fuller backup.
    const outDir = resolve(args.find(a => !a.startsWith('--')) ?? `.tmp/retired-vn-images-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`);
    mkdirSync(outDir, { recursive: true });
    const plan: SlotPlan[] = [];
    for (const { slot, expected } of plannedSlots()) {
        const res = await fetch(`${base}/api/img?id=${encodeURIComponent(slot)}`, { redirect: 'follow' });
        const buf = res.ok ? Buffer.from(await res.arrayBuffer()) : undefined;
        const sha = buf ? createHash('sha256').update(buf).digest('hex') : undefined;
        const entry: SlotPlan = { slot, status: classify(expected, { status: res.status, sha }), sha, bytes: buf?.length, contentType: res.headers.get('content-type') ?? undefined };
        if (entry.status === 'retire' && buf) writeFileSync(join(outDir, `${safeName(slot)}.bin`), buf);
        plan.push(entry);
    }
    writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(plan, null, 2));
    const count = (s: SlotPlan['status']) => plan.filter(p => p.status === s).length;
    console.log(`${plan.length} slots checked. retire ${count('retire')}, keep (newer upload) ${count('keep-newer-upload')}, already gone ${count('already-gone')}, unreadable ${count('unreadable')}.`);
    for (const p of plan.filter(p => p.status !== 'retire')) console.log(`  ${p.status.padEnd(18)} ${p.slot}`);
    console.log(`Backup of every slot to retire: ${outDir}`);
    if (!apply) { console.log('Dry run only. Nothing was deleted. Re-run with --apply and an admin token to delete.'); return; }

    // 2026-09-19 incident: one DELETE per image rewrote the whole event hash
    // (3.7 MB) and legacy bundle (6.5 MB) every time; 253 in a row filled the
    // database disk. The batch form rewrites each record once per request.
    const retire = plan.filter(p => p.status === 'retire' && existsSync(join(outDir, `${safeName(p.slot)}.bin`))).map(p => p.slot);
    let removed = 0;
    const failed: string[] = [];
    for (const ids of batches(retire, BATCH_SIZE)) {
        const res = await fetch(`${base}/api/images`, { method: 'DELETE', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify({ ids }) });
        const body = await res.json().catch(() => ({})) as { removed?: string[]; failed?: { id: string; reason: string }[]; error?: string };
        if (!res.ok || !Array.isArray(body.removed)) {
            console.log(`Stopped: the server answered ${res.status} (${body.error ?? 'no batch result'}). ${removed} removed so far.${res.status === 400 ? ' The server may not have the batch removal yet; wait for the deploy.' : ''}`);
            process.exitCode = 1;
            break;
        }
        removed += body.removed.length;
        for (const f of body.failed ?? []) { failed.push(f.id); console.log(`  NOT removed ${f.id}: ${f.reason}`); }
    }
    // Cheap check: the category index (keys only) must no longer list them.
    const index = await fetch(`${base}/api/images?cat=event&ids=1&v=${Date.now()}`).then(r => r.ok ? r.json() as Promise<string[]> : null).catch(() => null);
    const stillListed = index ? retire.filter(id => index.includes(id)) : undefined;
    console.log(`Removed ${removed} of ${retire.length}${failed.length ? `, ${failed.length} kept for a retry` : ''}. ${stillListed === undefined ? 'Could not read the image index to confirm.' : `Still listed in the image index: ${stillListed.length}.`} Backup: ${outDir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
