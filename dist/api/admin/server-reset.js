import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
// Patterns wiped on full reset. Anything matching these is deleted.
// shared:images / shared:imgfields are intentionally excluded — all uploaded
// images (kage portraits, elder portraits, pets, weapons, avatars) survive.
// save:admin* is excluded — admin-created content (jutsus, AIs, missions,
// events, pets, cards, visual novels) survives.
// admin:approvedBloodlines and admin:approvedItems survive — admin curation lists preserved.
// game:village-leadership-images survives — uploaded leader portraits preserved.
const WIPE_PATTERNS = [
    'presence:*',
    'presence:all', // bulk presence hash (cleared alongside individual keys)
    'challenges:*',
    'challenge-outgoing:*',
    'chat:village:*',
    'clan:*',
    'guard:*',
    'pvp:*', // active PvP sessions
    'auth:*', // player passwords — players re-register on next login
    'admin-lock:*', // short-lived admin locks (cleanup)
    'reset-signal:*', // short-lived reset signals (cleanup)
    'game:village-state:*', // shared village treasury / notices / war records
    'game:arena:tournament', // arena tournament bracket
    'game:arena:active-fights', // arena spectator fight list
    'game:clan-pet-battle:*', // pending clan pet battle challenges
    'world:territory:*', // sector territory ownership
    'world:war:*', // active village wars
];
// Village → KV image key for the default Kage portrait.
// Images are stored in game:village-leadership-images (preserved through resets).
// After wiping, we re-seed the shared imgfields hash so portraits load instantly.
const KAGE_VILLAGES = [
    'Stormveil Village',
    'Ashen Leaf Village',
    'Frostfang Village',
    'Moonshadow Village',
];
export default async function handler(req, res) {
    cors(res);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { password } = body;
        const adminPassword = process.env.ADMIN_PASSWORD;
        if (!adminPassword || password !== adminPassword) {
            return res.status(401).json({ error: 'Unauthorized.' });
        }
        const deleted = [];
        // 1. Wipe all player saves — admin saves are preserved so admin-created
        //    content (jutsus, AIs, missions, events, pets, cards, VNs) survives.
        const saveKeys = await kv.keys('save:*');
        const playerSaveKeys = saveKeys.filter(k => !k.toLowerCase().startsWith('save:admin'));
        if (playerSaveKeys.length > 0) {
            await Promise.all(playerSaveKeys.map(k => kv.del(k)));
            deleted.push(...playerSaveKeys);
        }
        // 2. Wipe all other reset patterns in parallel
        await Promise.all(WIPE_PATTERNS.map(async (pattern) => {
            const keys = await kv.keys(pattern);
            if (keys.length > 0) {
                await Promise.all(keys.map(k => kv.del(k)));
                deleted.push(...keys);
            }
        }));
        // 3. Clear the player registry
        await kv.del('player:registry');
        deleted.push('player:registry');
        // 4. Re-seed Kage portraits from the preserved game:village-leadership-images key
        //    into the shared:imgfields:misc hash so portraits load immediately for all players.
        try {
            const leadershipData = await kv.get('game:village-leadership-images');
            const images = leadershipData?.images ?? {};
            const imgPayload = {};
            for (const village of KAGE_VILLAGES) {
                const kageImg = images[village]?.kage;
                if (kageImg)
                    imgPayload[`leader:${village}:kage`] = kageImg;
            }
            if (Object.keys(imgPayload).length > 0) {
                await kv.hset('shared:imgfields:misc', imgPayload);
            }
        }
        catch {
            // Non-fatal — portraits still load from game:village-leadership-images
        }
        return res.status(200).json({
            ok: true,
            deletedCount: deleted.length,
            deleted,
        });
    }
    catch (err) {
        return res.status(500).json({ error: String(err) });
    }
}
