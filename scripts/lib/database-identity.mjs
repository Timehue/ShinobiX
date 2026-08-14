import { createHash } from 'node:crypto';

function supabaseProjectDiscriminator(parsed) {
    const host = parsed.hostname.toLowerCase();
    const direct = /^db\.([a-z0-9]{8,64})\.supabase\.co$/.exec(host);
    if (direct) return direct[1];
    if (!/(?:^|\.)pooler\.supabase\.com$/.test(host)) return '';
    const username = decodeURIComponent(parsed.username).toLowerCase();
    const pooled = /^postgres\.([a-z0-9]{8,64})$/.exec(username);
    if (!pooled) {
        throw new Error('A Supabase pooler database URL must include its project discriminator in the username.');
    }
    return pooled[1];
}

/**
 * Normalize a database identity without retaining credentials. Ordinary
 * Postgres hosts remain username-agnostic; recognized shared Supabase poolers
 * include the project ref carried by `postgres.<project-ref>`.
 */
export function databaseConnectionFingerprint(raw) {
    if (!raw) throw new Error('A database URL is required to derive its fingerprint.');
    const parsed = new URL(String(raw));
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
        throw new Error('Database fingerprints require postgres or postgresql URLs.');
    }
    const host = parsed.hostname.toLowerCase();
    const port = parsed.port || '5432';
    const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, '')).toLowerCase();
    if (!host || !database) throw new Error('A database fingerprint requires a host and database.');
    const project = supabaseProjectDiscriminator(parsed);
    const material = `${host}:${port}/${database}${project ? `#supabase:${project}` : ''}`;
    return createHash('sha256').update(material).digest('hex').slice(0, 20);
}
