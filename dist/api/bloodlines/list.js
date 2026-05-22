"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
// NOTE: LEGACY_IMAGE_KEY ('shared:images') intentionally omitted here — it is a
// multi-MB all-categories blob that causes connection-pool exhaustion when
// fetched alongside N save reads.  Bloodline images migrated to the per-category
// keys below, so the legacy blob is redundant for this endpoint.
const bloodlineImageBlobKey = 'shared:images:bloodline';
const bloodlineImageHashKey = 'shared:imgfields:bloodline';
async function handler(req, res) {
    (0, _utils_js_1.cors)(res);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'GET')
        return res.status(405).end();
    try {
        // Fetch image maps and save keys in parallel — 3 queries total.
        const [saveKeys, bloodlineBlobImages, bloodlineHashImages] = await Promise.all([
            _storage_js_1.kv.keys('save:*'),
            _storage_js_1.kv.get(bloodlineImageBlobKey),
            _storage_js_1.kv.hgetall(bloodlineImageHashKey),
        ]);
        const sharedBloodlineImages = {
            ...(bloodlineBlobImages ?? {}),
            ...(bloodlineHashImages ?? {}),
        };
        // Batch-fetch all saves in a single mget instead of N individual get()
        // calls. This keeps connection-pool usage to 1 query regardless of how
        // many players exist, eliminating the N+1 pattern that caused pool
        // exhaustion and high error rates under load.
        const nonAdminKeys = saveKeys.filter(k => !k.replace('save:', '').toLowerCase().startsWith('admin'));
        const snapshots = nonAdminKeys.length
            ? await _storage_js_1.kv.mget(...nonAdminKeys)
            : [];
        const bloodlines = [];
        for (let i = 0; i < nonAdminKeys.length; i++) {
            const key = nonAdminKeys[i];
            const snap = snapshots[i] ?? null;
            const ownerKey = key.replace('save:', '');
            const char = snap?.character;
            const ownerName = char?.name ?? ownerKey;
            const rawBloodlines = snap?.savedBloodlines;
            if (!Array.isArray(rawBloodlines))
                continue;
            for (const bloodline of rawBloodlines) {
                if (!bloodline?.id || !bloodline?.name)
                    continue;
                const id = String(bloodline.id);
                bloodlines.push({
                    id,
                    name: String(bloodline.name),
                    rank: String(bloodline.rank ?? 'B Rank'),
                    image: sharedBloodlineImages[`bloodline:${id}`] ?? (bloodline.image ? String(bloodline.image) : undefined),
                    specialElement: bloodline.specialElement ? String(bloodline.specialElement) : undefined,
                    lore: bloodline.lore ? String(bloodline.lore) : undefined,
                    jutsus: Array.isArray(bloodline.jutsus) ? bloodline.jutsus : [],
                    totalPoints: Number(bloodline.totalPoints ?? 0),
                    ownerName,
                    ownerKey,
                });
            }
        }
        bloodlines.sort((a, b) => a.name.localeCompare(b.name) || a.ownerName.localeCompare(b.ownerName));
        return res.status(200).json({ bloodlines });
    }
    catch (err) {
        // Return empty list rather than 500 so the bloodline gallery degrades
        // gracefully during transient DB outages instead of showing an error.
        console.error('[bloodlines/list]', String(err));
        return res.status(200).json({ bloodlines: [] });
    }
}
