import { safeName } from '../_utils.js';
import {
    getTowerInvite,
    readSession,
} from './_tower-store.js';
import type { TowerSession } from './_tower-session.js';

export type ClanBossConflictDeps = {
    invite: (slug: string) => Promise<string | null>;
    session: (runId: string) => Promise<TowerSession | null>;
};

const defaultDeps: ClanBossConflictDeps = {
    invite: getTowerInvite,
    session: readSession,
};

/**
 * Clan Boss currently shares TowerSession + `tower-invite:*` recovery, but not
 * the generic battle-lock lease. Refuse a Tower launch that would overwrite a
 * live clan-assault member's only recovery pointer.
 */
export async function activeClanBossConflictMembers(
    memberNames: readonly string[],
    deps: ClanBossConflictDeps = defaultDeps,
): Promise<string[]> {
    const members = [...new Set(memberNames.map(safeName).filter(Boolean))].sort();
    const invites = await Promise.all(members.map(async member => ({
        member,
        runId: await deps.invite(member),
    })));
    const sessions = new Map<string, TowerSession | null>();
    const busy: string[] = [];
    for (const row of invites) {
        if (!row.runId?.startsWith('cboss-')) continue;
        if (!sessions.has(row.runId)) sessions.set(row.runId, await deps.session(row.runId));
        const session = sessions.get(row.runId);
        if (session?.status !== 'active') continue;
        const liveMember = session.actors.some(actor => actor.side === 'squad'
            && actor.ai === false
            && actor.ownerSlug === row.member);
        if (liveMember) busy.push(row.member);
    }
    return busy;
}
