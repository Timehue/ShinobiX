import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { isAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';

const APPROVED_BLOODLINES_KEY = 'admin:approvedBloodlines';

// Explicit allowlist of fields that can be merged into an existing bloodline
// via the `update` action. Anything else in the body is ignored. Prevents
// admin endpoint body from injecting arbitrary fields onto a player save.
const BLOODLINE_UPDATE_ALLOWED_FIELDS = new Set<string>([
    'name', 'rank', 'image', 'specialElement', 'lore', 'jutsus', 'totalPoints',
    'description', 'icon', 'color', 'isApproved',
]);

// Per-field validators for the allowlisted fields. Each runs after the
// allowlist check; if the value fails validation we drop the field rather
// than write garbage. The image / icon checks here mirror the save-side
// bloodline image whitelist so an admin payload can't smuggle external SVG
// URLs onto a player record.
function isAllowedImageish(v: unknown): boolean {
    if (typeof v !== 'string') return false;
    const s = v.trim();
    if (!s) return false;
    if (s.length > 250_000) return false;
    if (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(s)) return true;
    if (s.startsWith('/api/images') || s.startsWith('/images/')) return true;
    return false;
}
function isShortText(v: unknown, max: number): boolean {
    return typeof v === 'string' && v.length <= max;
}

function filterBloodlineFields(input: Record<string, unknown> | undefined): Record<string, unknown> {
    if (!input || typeof input !== 'object') return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
        if (!BLOODLINE_UPDATE_ALLOWED_FIELDS.has(k)) continue;
        if ((k === 'image' || k === 'icon') && !isAllowedImageish(v)) continue;
        if (k === 'description' && !isShortText(v, 4000)) continue;
        if (k === 'lore' && !isShortText(v, 4000)) continue;
        if (k === 'name' && !isShortText(v, 80)) continue;
        if (k === 'color' && !(typeof v === 'string' && /^#?[0-9a-fA-F]{3,8}$/.test(v))) continue;
        out[k] = v;
    }
    return out;
}

async function loadApprovedBloodlines() {
    const approved = await kv.get<string[]>(APPROVED_BLOODLINES_KEY);
    return Array.isArray(approved) ? approved : [];
}

async function saveApprovedBloodlines(ids: string[]) {
    await kv.set(APPROVED_BLOODLINES_KEY, Array.from(new Set(ids)));
}

function reviewKey(ownerKey: string, bloodlineId: string) {
    return `${ownerKey || 'admin'}:${bloodlineId}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    if (!enforceRateLimit(req, res, 'admin-bloodline-review', 60, 5 * 60_000)) return;

    // Admin password via header (was body). See players.ts.
    if (!isAdmin(req)) {
        return res.status(401).json({ error: 'Unauthorized.' });
    }

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { action, ownerKey, bloodlineId, bloodline } = body as {
            action?: 'approve' | 'delete' | 'update';
            ownerKey?: string;
            bloodlineId?: string;
            bloodline?: Record<string, unknown>;
        };

        if (!bloodlineId || (action !== 'approve' && action !== 'delete' && action !== 'update')) {
            return res.status(400).json({ error: 'Missing action or bloodlineId.' });
        }

        const cleanOwnerKey = safeName(ownerKey ?? '');
        const key = reviewKey(cleanOwnerKey || 'admin', bloodlineId);
        const approved = await loadApprovedBloodlines();

        if ((action === 'delete' || action === 'update') && cleanOwnerKey && cleanOwnerKey !== 'admin' && !cleanOwnerKey.startsWith('admin')) {
            const saveKey = `save:${cleanOwnerKey}`;
            const adminLockKey = `admin-lock:${cleanOwnerKey}`;
            const resetSignalKey = `reset-signal:${cleanOwnerKey}`;
            const snap = await kv.get<Record<string, unknown>>(saveKey);
            if (snap) {
                const rawBloodlines = Array.isArray(snap.savedBloodlines) ? snap.savedBloodlines : [];
                // Pre-check: does the bloodlineId actually exist on this
                // save? If not, the filter/map below is a no-op and we'd
                // still write the save + spam the player with a force-
                // reload via reset-signal. Skip the write in that case.
                const hasBloodline = rawBloodlines.some(
                    (b) => b && typeof b === 'object' && String((b as { id?: unknown }).id ?? '') === bloodlineId,
                );
                if (!hasBloodline) {
                    // Nothing to do — owner doesn't actually hold this bloodline.
                    // Still update the approved-list below so admin can curate
                    // entries pre-emptively.
                } else {
                    const nextBloodlines = action === 'delete'
                        ? rawBloodlines.filter((savedBloodline) => {
                            return !(savedBloodline && typeof savedBloodline === 'object' && String((savedBloodline as { id?: unknown }).id ?? '') === bloodlineId);
                        })
                        : rawBloodlines.map((savedBloodline) => {
                            if (!(savedBloodline && typeof savedBloodline === 'object' && String((savedBloodline as { id?: unknown }).id ?? '') === bloodlineId)) return savedBloodline;
                            // Allowlist-merge: only known bloodline fields can be overwritten
                            // by the admin payload. Stops arbitrary properties from being
                            // injected into player saves via this endpoint.
                            return { ...(savedBloodline as Record<string, unknown>), ...filterBloodlineFields(bloodline), id: bloodlineId };
                        });
                    await Promise.all([
                        kv.set(adminLockKey, 1, { ex: 300 }),
                        kv.set(saveKey, { ...snap, savedBloodlines: nextBloodlines }),
                        kv.set(resetSignalKey, 1, { ex: 300 }),
                    ]);
                }
            }
        }

        const nextApproved = action === 'update' ? approved : Array.from(new Set([...approved, key]));
        await saveApprovedBloodlines(nextApproved);
        return res.status(200).json({ ok: true, approvedBloodlines: nextApproved });
    } catch (err) {
        console.error('[admin/bloodline-review]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
