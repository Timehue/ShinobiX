import { safeName } from '../_utils.js';

/*
 * Pure decision logic for /api/clan/kick — extracted so it can be unit-tested
 * without standing up KV / auth / locks (mirrors the _treasury-donate.ts ↔
 * treasury/donate.ts split). The handler does the auth + locking + cross-save
 * write; this module just decides whether a kick is allowed and computes the
 * resulting roster.
 */

export function clanSlugBare(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isLeadershipRole(role: string): boolean {
    return role === 'founder' || role === 'leader' || role === 'officer';
}

export type ClanKickRecord = {
    founderName?: string;
    members?: Array<Record<string, unknown>>;
    roleOverrides?: Record<string, string>;
    joinRequests?: Array<Record<string, unknown>>;
};

export type ClanKickDecision =
    | {
        ok: true;
        nextMembers: Array<Record<string, unknown>>;
        nextRoleOverrides: Record<string, string>;
        nextJoinRequests: Array<Record<string, unknown>>;
      }
    | { ok: false; status: number; error: string };

/**
 * Decide whether `actorNorm` (a safeName slug, with role `actorRole`) may kick
 * `targetNorm` (a safeName slug) from `clanRec`, and compute the resulting
 * members / roleOverrides / joinRequests.
 *
 * Rules:
 *   - actor must be clan leadership (founder / leader / officer),
 *   - you can't kick yourself (use Leave Clan),
 *   - the founder can never be kicked,
 *   - only the founder may remove another leadership member (leader / officer),
 *   - the target must currently be a member.
 */
export function resolveClanKick(
    clanRec: ClanKickRecord,
    actorRole: 'founder' | 'leader' | 'officer' | 'member' | '',
    actorNorm: string,
    targetNorm: string,
): ClanKickDecision {
    if (!targetNorm) return { ok: false, status: 400, error: 'Missing target player.' };
    if (actorNorm === targetNorm) return { ok: false, status: 400, error: 'Use Leave Clan to remove yourself.' };
    if (!isLeadershipRole(actorRole)) {
        return { ok: false, status: 403, error: 'Only clan leadership can remove members.' };
    }

    const members = Array.isArray(clanRec.members) ? clanRec.members : [];
    const founderNorm = safeName(String(clanRec.founderName ?? ''));
    if (targetNorm && targetNorm === founderNorm) {
        return { ok: false, status: 403, error: 'The clan founder cannot be removed.' };
    }

    const isTarget = (name: unknown) => safeName(String(name ?? '')) === targetNorm;
    const targetMember = members.find((m) => isTarget((m as Record<string, unknown>)?.name));
    if (!targetMember) {
        return { ok: false, status: 404, error: 'That player is not a member of this clan.' };
    }

    // Stored (override) role of the target. Only the founder may remove another
    // leader / officer; a leader/officer can only kick rank-and-file members.
    const overrides = (clanRec.roleOverrides ?? {}) as Record<string, string>;
    const overrideEntry = Object.entries(overrides).find(([k]) => safeName(k) === targetNorm || k.toLowerCase() === targetNorm);
    const targetRole = overrideEntry?.[1] ?? '';
    const targetIsLeadership = targetRole === 'Founder' || targetRole === 'Leader' || targetRole === 'Officer';
    if (targetIsLeadership && actorRole !== 'founder') {
        return { ok: false, status: 403, error: 'Only the founder can remove another leader or officer.' };
    }

    const nextMembers = members.filter((m) => !isTarget((m as Record<string, unknown>)?.name));
    const nextRoleOverrides: Record<string, string> = {};
    for (const [k, v] of Object.entries(overrides)) {
        if (safeName(k) === targetNorm || k.toLowerCase() === targetNorm) continue;
        nextRoleOverrides[k] = v;
    }
    const joinRequests = Array.isArray(clanRec.joinRequests) ? clanRec.joinRequests : [];
    const nextJoinRequests = joinRequests.filter((r) => !isTarget((r as Record<string, unknown>)?.name));

    return { ok: true, nextMembers, nextRoleOverrides, nextJoinRequests };
}
