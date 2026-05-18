import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';
import { cors } from './_utils.js';
import crypto from 'crypto';

type AuthRecord = { hash: string; salt: string };

function newSalt(): string {
    return crypto.randomBytes(16).toString('hex');
}

export function hashPw(password: string, salt: string): string {
    return crypto.createHmac('sha256', salt).update(password).digest('hex');
}

export function authKey(name: string): string {
    return `auth:${name.trim().toLowerCase()}`;
}

export async function verifyPlayerPassword(name: string, password: string): Promise<boolean> {
    const record = await kv.get<AuthRecord>(authKey(name));
    if (!record) return false;
    return hashPw(password, record.salt) === record.hash;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { action, name, password, oldPassword, newPassword } = body as {
        action?: string;
        name?: string;
        password?: string;
        oldPassword?: string;
        newPassword?: string;
    };

    if (!name) return res.status(400).json({ ok: false, error: 'Missing name.' });
    const key = authKey(name);

    if (action === 'register') {
        // Register a new password. Fails if one already exists — use 'change' to update.
        if (!password) return res.status(400).json({ ok: false, error: 'Missing password.' });
        const existing = await kv.get<AuthRecord>(key);
        if (existing) return res.status(409).json({ ok: false, error: 'Account already has a password.' });
        const salt = newSalt();
        await kv.set(key, { hash: hashPw(password, salt), salt });
        return res.status(200).json({ ok: true });
    }

    if (action === 'verify') {
        // Verify a password. Returns { ok: true } on match, { ok: false } on mismatch,
        // or { ok: true, legacy: true } if no server password exists yet (legacy account).
        if (!password) return res.status(400).json({ ok: false, error: 'Missing password.' });
        const record = await kv.get<AuthRecord>(key);
        if (!record) {
            // No server-side password stored yet (account predates this auth system).
            // Return legacy=true so the client can decide whether to register the password.
            return res.status(200).json({ ok: true, legacy: true });
        }
        const valid = hashPw(password, record.salt) === record.hash;
        if (!valid) return res.status(200).json({ ok: false });
        return res.status(200).json({ ok: true });
    }

    if (action === 'change') {
        // Change password — requires old password.
        if (!oldPassword || !newPassword) {
            return res.status(400).json({ ok: false, error: 'Missing oldPassword or newPassword.' });
        }
        const record = await kv.get<AuthRecord>(key);
        if (!record) {
            // Legacy account with no password yet — just set it.
            const salt = newSalt();
            await kv.set(key, { hash: hashPw(newPassword, salt), salt });
            return res.status(200).json({ ok: true });
        }
        if (hashPw(oldPassword, record.salt) !== record.hash) {
            return res.status(401).json({ ok: false, error: 'Incorrect current password.' });
        }
        const salt = newSalt();
        await kv.set(key, { hash: hashPw(newPassword, salt), salt });
        return res.status(200).json({ ok: true });
    }

    if (action === 'delete') {
        // Delete the auth record when a player deletes their character.
        // Must supply either valid player password or admin password.
        const adminPassword = process.env.ADMIN_PASSWORD;
        const adminPw = req.headers['x-admin-password'] as string | undefined;
        if (adminPassword && adminPw === adminPassword) {
            await kv.del(key);
            return res.status(200).json({ ok: true });
        }
        if (!password) return res.status(401).json({ ok: false, error: 'Authentication required.' });
        const record = await kv.get<AuthRecord>(key);
        if (record && hashPw(password, record.salt) !== record.hash) {
            return res.status(401).json({ ok: false, error: 'Incorrect password.' });
        }
        await kv.del(key);
        return res.status(200).json({ ok: true });
    }

    if (action === 'adminreset') {
        // Admin sets a player's password to a new value (e.g. for account recovery).
        const adminPassword = process.env.ADMIN_PASSWORD;
        const adminPw = req.headers['x-admin-password'] as string | undefined;
        if (!adminPassword || adminPw !== adminPassword) {
            return res.status(401).json({ ok: false, error: 'Admin authentication required.' });
        }
        if (!newPassword) return res.status(400).json({ ok: false, error: 'Missing newPassword.' });
        const salt = newSalt();
        await kv.set(key, { hash: hashPw(newPassword, salt), salt });
        return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action.' });
}
