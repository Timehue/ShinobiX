import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
const LEGACY_IMAGE_KEY = 'shared:images';
const bloodlineImageBlobKey = 'shared:images:bloodline';
const bloodlineImageHashKey = 'shared:imgfields:bloodline';
export default async function handler(req, res) {
    cors(res);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'GET')
        return res.status(405).end();
    try {
        const [saveKeys, legacyImages, bloodlineBlobImages, bloodlineHashImages] = await Promise.all([
            kv.keys('save:*'),
            kv.get(LEGACY_IMAGE_KEY),
            kv.get(bloodlineImageBlobKey),
            kv.hgetall(bloodlineImageHashKey),
        ]);
        const sharedBloodlineImages = {
            ...(legacyImages ?? {}),
            ...(bloodlineBlobImages ?? {}),
            ...(bloodlineHashImages ?? {}),
        };
        const saves = await Promise.all(saveKeys.map(async (key) => {
            try {
                return { key, snap: await kv.get(key) };
            }
            catch {
                return { key, snap: null };
            }
        }));
        const bloodlines = [];
        for (const { key, snap } of saves) {
            const ownerKey = key.replace('save:', '');
            if (ownerKey.toLowerCase().startsWith('admin'))
                continue;
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
        return res.status(500).json({ error: String(err) });
    }
}
