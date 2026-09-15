import { safeName } from '../_utils.js';

/** Read only from the current clan record while its mutation lock is held. */
export function clanLeadershipRole(
    clan: { founderName?: unknown; members?: unknown; roleOverrides?: unknown },
    playerName: string,
): 'founder' | 'leader' | 'officer' | '' {
    const player = safeName(playerName);
    const members = Array.isArray(clan.members) ? clan.members : [];
    if (!player || !members.some((member) => safeName(String(member?.name ?? '')) === player)) return '';
    if (safeName(String(clan.founderName ?? '')) === player) return 'founder';
    const overrides = clan.roleOverrides && typeof clan.roleOverrides === 'object' && !Array.isArray(clan.roleOverrides)
        ? clan.roleOverrides as Record<string, unknown> : {};
    const role = Object.entries(overrides).find(([name]) => safeName(name) === player)?.[1];
    return role === 'Leader' ? 'leader' : role === 'Officer' ? 'officer' : '';
}
