import { kv } from '../_storage.js';
import { battleAuthorityKeys, battleEvidenceFrom, resolveBattleAuthority } from '../_realtime/battle-authority.js';
import { invalidateBattleAuthority } from '../_realtime/battle-projection.js';
import { onlineStore } from '../_realtime/online-store.js';

/** Gathering cannot rely on the next client heartbeat to discover a fight.
 * Re-read server evidence, including recovery pointers, and only ever raise
 * the presence flag here. Combat terminalization/heartbeat own clearing it. */
export async function resourceBattleActive(name: string) {
    const evidence = battleEvidenceFrom(await kv.mget(...battleAuthorityKeys(name)));
    invalidateBattleAuthority(name);
    const authority = await resolveBattleAuthority(name, evidence);
    if (authority.inBattle) onlineStore.setInBattle(name, true);
    return authority.inBattle;
}
