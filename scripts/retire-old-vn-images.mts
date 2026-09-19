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
 * later to the same slot is never touched. Deletion goes through the app's own
 * DELETE /api/images, which clears R2, the per-image key, the category bundle,
 * the asset registry and the cache version, and writes an audit entry. Direct
 * database deletes would be resurrected from the legacy bundles by /api/img.
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
    if (!res.ok) throw new Error(`The server did not accept the admin credential (GET /api/save/admin1 returned ${res.status}). Nothing was changed. Copy a fresh token from the Admin Panel tab and try again.`);
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
        for (const entry of manifest.filter(e => e.status === 'retire')) {
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
    const outDir = resolve(args.find(a => !a.startsWith('--')) ?? `.tmp/retired-vn-images-${new Date().toISOString().slice(0, 10)}`);
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

    let deleted = 0;
    for (const p of plan.filter(p => p.status === 'retire')) {
        if (!existsSync(join(outDir, `${safeName(p.slot)}.bin`))) { console.log(`  skipped (no backup) ${p.slot}`); continue; }
        const res = await fetch(`${base}/api/images?id=${encodeURIComponent(p.slot)}`, { method: 'DELETE', headers: auth });
        if (res.status === 401 || res.status === 403) {
            console.log(`Stopped: the server refused the delete (${res.status}), so the admin login has expired or was rejected. ${deleted} deleted so far. Get a fresh token and re-run; already-deleted slots are skipped.`);
            process.exitCode = 1;
            break;
        }
        const after = await fetch(`${base}/api/img?id=${encodeURIComponent(p.slot)}`, { redirect: 'follow' });
        if (res.ok && after.status === 404) deleted++;
        else console.log(`  NOT removed ${p.slot}: delete ${res.status}, read-back ${after.status}`);
    }
    console.log(`Deleted and verified ${deleted} of ${count('retire')}. Undo: --restore ${outDir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
