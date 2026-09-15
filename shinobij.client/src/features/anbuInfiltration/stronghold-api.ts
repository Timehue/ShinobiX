import type { StrongholdVisit } from '../../../../shared/sector-stronghold';
import type { Character, PlayerRecord } from '../../types/character';
import type { SoloPveSession } from '../../lib/solo-pve-api';

export type StrongholdResponse = {
    ok: true;
    visit: StrongholdVisit;
    peers: PlayerRecord[];
    patrol?: SoloPveSession;
    combatBlocked?: boolean;
    character?: Character;
    _saveVersion?: number;
    won?: boolean;
};
export async function strongholdRequest(playerName: string, sector: number, action: string, fields: Record<string, unknown> = {}, signal?: AbortSignal): Promise<StrongholdResponse> {
    const response = await fetch('/api/village/anbu-infiltration', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerName, sector, action: `stronghold-${action}`, ...fields }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    });
    const body = await response.json().catch(() => ({ error: 'The stronghold could not be reached. Try again.' }));
    if (!response.ok || !body.ok) throw new Error(body.error || 'The stronghold could not be reached. Try again.');
    return body;
}
