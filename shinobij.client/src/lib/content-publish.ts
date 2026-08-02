/*
 * Client wrapper for /api/admin/content-publish (P0-4).
 *
 * Admin-authored content used to reach players only by riding the admin's own
 * player save. That had two problems the server side now fixes:
 *   • the ordinary save path FREEZES the authored fields (creatorJutsus and
 *     friends are server-owned top-level fields), so a plain save could not
 *     publish them at all;
 *   • the `?signal=1` path that could publish them took no lock and ran no
 *     version check, so two admin tabs raced and a stale one reverted newer
 *     content.
 *
 * Publishing through the dedicated endpoint gets a per-field lock and an
 * optimistic-concurrency check. The server still mirrors what it publishes
 * back into the admin slot, so every reader — including clients that know
 * nothing about this endpoint — keeps working unchanged.
 */

import { useCallback, useEffect, useRef } from 'react';

/** The publishable fields. KEEP IN SYNC with CONTENT_FIELDS (api/_content-store.ts). */
export const PUBLISHABLE_CONTENT_FIELDS = [
    'creatorJutsus', 'creatorItems', 'creatorAis', 'creatorEvents',
    'creatorMissions', 'creatorRaids', 'creatorCards',
    'editablePets', 'petEncounterVn', 'ancientChestVn', 'hollowGateEventConfig',
] as const;

export type PublishableContentField = typeof PUBLISHABLE_CONTENT_FIELDS[number];

export type ContentVersions = Record<string, number>;

export type PublishResult =
    | { ok: true; published: ContentVersions; versions: ContentVersions }
    | { ok: false; conflict: true; fields: string[]; error: string }
    | { ok: false; conflict: false; error: string };

type VersionsResponse = { fields?: Record<string, { version?: number }> };
type PublishResponse = {
    ok?: boolean;
    published?: ContentVersions;
    conflicts?: Array<{ field?: string }>;
    error?: string;
};

function adminHeaders(adminPw: string): Record<string, string> {
    return { 'Content-Type': 'application/json', ...(adminPw ? { 'x-admin-password': adminPw } : {}) };
}

/** Current published version per field — echo these back on publish. */
export async function fetchContentVersions(adminPw: string): Promise<ContentVersions> {
    try {
        const res = await fetch('/api/admin/content-publish', { headers: adminHeaders(adminPw) });
        if (!res.ok) return {};
        const data = await res.json() as VersionsResponse;
        const out: ContentVersions = {};
        for (const [field, meta] of Object.entries(data.fields ?? {})) {
            const version = Number(meta?.version);
            if (Number.isFinite(version)) out[field] = version;
        }
        return out;
    } catch {
        return {};
    }
}

/**
 * Publish the supplied content fields. `baseVersions` should be what
 * fetchContentVersions returned when the editor loaded; a stale one comes back
 * as `conflict` so the caller can tell the admin to reload instead of
 * overwriting someone else's newer content.
 */
export async function publishContent(
    fields: Partial<Record<PublishableContentField, unknown>>,
    opts: { adminPw: string; slot?: string; baseVersions?: ContentVersions },
): Promise<PublishResult> {
    const payload = Object.fromEntries(
        Object.entries(fields).filter(([field]) => (PUBLISHABLE_CONTENT_FIELDS as readonly string[]).includes(field)),
    );
    if (Object.keys(payload).length === 0) return { ok: true, published: {}, versions: opts.baseVersions ?? {} };
    try {
        const res = await fetch('/api/admin/content-publish', {
            method: 'POST',
            headers: adminHeaders(opts.adminPw),
            body: JSON.stringify({ slot: opts.slot, fields: payload, baseVersions: opts.baseVersions ?? {} }),
        });
        const data = await res.json().catch(() => ({})) as PublishResponse;
        const published = data.published ?? {};
        if (res.status === 409 || (data.conflicts?.length ?? 0) > 0) {
            return {
                ok: false,
                conflict: true,
                fields: (data.conflicts ?? []).map((c) => String(c?.field ?? '')).filter(Boolean),
                error: data.error || 'Someone else published newer content. Reload before saving.',
            };
        }
        if (!res.ok) return { ok: false, conflict: false, error: data.error || `Publish failed (${res.status}).` };
        return { ok: true, published, versions: { ...(opts.baseVersions ?? {}), ...published } };
    } catch {
        return { ok: false, conflict: false, error: 'Could not reach the server to publish content.' };
    }
}

/**
 * Admin content publishing for the Admin Panel's Save button.
 *
 * Owns the base-version bookkeeping so App.tsx does not have to: seeds the
 * versions once admin auth is available (without them the server's
 * optimistic-concurrency check could never fire), then advances them on every
 * successful publish. Throws on failure so the caller's existing
 * save-failed handling reports it — a silent failure here would look like a
 * successful publish that never reached players.
 */
export function useAdminContentPublisher(adminPw: string) {
    const versionsRef = useRef<ContentVersions>({});
    useEffect(() => {
        if (!adminPw) return;
        let cancelled = false;
        void fetchContentVersions(adminPw).then((versions) => {
            if (!cancelled) versionsRef.current = versions;
        });
        return () => { cancelled = true; };
    }, [adminPw]);
    return useCallback(async (
        fields: Partial<Record<PublishableContentField, unknown>>,
        slot?: string,
    ): Promise<void> => {
        const result = await publishContent(fields, { adminPw, slot, baseVersions: versionsRef.current });
        if (!result.ok) throw new Error(result.error);
        versionsRef.current = result.versions;
    }, [adminPw]);
}
