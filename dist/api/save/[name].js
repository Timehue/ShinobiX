import { kv } from '../_storage.js';
import { safeName, mergePreservingImages, cors } from '../_utils.js';
import { verifyPlayerPassword } from '../player-auth.js';
const REGISTRY_KEY = 'player:registry';
export default async function handler(req, res) {
    cors(res);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    const name = safeName(String(req.query.name ?? ''));
    if (!name)
        return res.status(400).json({ error: 'Invalid name.' });
    const key = `save:${name}`;
    if (req.method === 'GET') {
        const data = await kv.get(key);
        if (data === null)
            return res.status(404).end();
        return res.status(200).json(data);
    }
    if (req.method === 'POST') {
        try {
            const resetSignalKey = `reset-signal:${name.toLowerCase()}`;
            const adminLockKey = `admin-lock:${name.toLowerCase()}`;
            if (req.query.ack === '1') {
                await Promise.all([
                    kv.del(resetSignalKey),
                    kv.del(adminLockKey),
                ]);
                return res.status(200).json({ ok: true });
            }
            const isAdminSave = req.query.signal === '1';
            // Admin-flagged writes require the admin password to prevent any client
            // from force-reloading a player with arbitrary data.
            if (isAdminSave) {
                const adminPassword = process.env.ADMIN_PASSWORD;
                const providedPw = req.headers['x-admin-password'];
                if (!adminPassword || providedPw !== adminPassword) {
                    return res.status(401).json({ error: 'Admin authentication required.' });
                }
            }
            // If a reset-signal is pending (admin edit in-flight) and this is NOT the admin save,
            // silently drop the client auto-save so it can't overwrite admin changes.
            if (!isAdminSave) {
                const [pendingSignal, adminLock] = await Promise.all([
                    kv.get(resetSignalKey),
                    kv.get(adminLockKey),
                ]);
                if (pendingSignal || adminLock)
                    return res.status(200).end();
            }
            const incoming = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const existing = await kv.get(key);
            const payload = existing ? mergePreservingImages(incoming, existing) : incoming;
            // Upsert player into persistent registry so admin can always see all accounts
            const char = incoming?.character;
            const displayName = char?.name || name;
            const registryEntry = {
                name: displayName,
                level: char?.level ?? 1,
                village: char?.village ?? '',
                specialty: char?.specialty ?? '',
                lastSeen: Date.now(),
            };
            if (isAdminSave)
                await kv.set(adminLockKey, 1, { ex: 300 });
            await Promise.all([
                kv.set(key, payload),
                kv.hset(REGISTRY_KEY, { [name]: JSON.stringify(registryEntry) }),
            ]);
            // Admin save: set reset-signal after the new save is committed so the client reloads that exact version.
            if (isAdminSave)
                await kv.set(resetSignalKey, 1, { ex: 300 });
            return res.status(200).end();
        }
        catch (err) {
            return res.status(500).json({ error: String(err) });
        }
    }
    if (req.method === 'DELETE') {
        try {
            const adminPassword = process.env.ADMIN_PASSWORD;
            const adminPw = req.headers['x-admin-password'];
            const playerPw = req.headers['x-player-password'];
            const isAdmin = adminPassword && adminPw === adminPassword;
            if (!isAdmin) {
                // Allow player to delete their own save by providing their own password.
                if (!playerPw)
                    return res.status(401).json({ error: 'Authentication required.' });
                const authRecord = await kv.get(`auth:${name.toLowerCase()}`);
                if (authRecord) {
                    // Server-side password exists — must verify
                    const valid = await verifyPlayerPassword(name, playerPw);
                    if (!valid)
                        return res.status(401).json({ error: 'Incorrect password.' });
                }
                // Legacy account (no server auth record) — allow delete; player is already
                // authenticated client-side to reach this button.
            }
            const lowered = name.toLowerCase();
            const adminLockKey = `admin-lock:${lowered}`;
            await kv.set(adminLockKey, 1, { ex: 300 });
            await Promise.all([
                kv.del(key),
                kv.hdel(REGISTRY_KEY, name),
                // Signal the player's client to reload on next heartbeat (5-min TTL)
                kv.set(`reset-signal:${lowered}`, 1, { ex: 300 }),
            ]);
            return res.status(200).json({ ok: true });
        }
        catch (err) {
            return res.status(500).json({ error: String(err) });
        }
    }
    return res.status(405).end();
}
