import { useLayoutEffect, useRef, useState } from 'react';
import type { WorldSectorCommandPlayer } from '../components/WorldSectorCommandPanel.types';
import type { PlayerRecord } from '../types/character';
import { sectorPlayerKey } from './sector-player-roster';

export type SectorPlayerIntent = 'attack' | 'strike' | 'spectate';
export type SectorPlayerActionState = { pending: string | null; error: { key: string; message: string; sector: number } | null };

/** Resolve by account at dispatch, and hold one lock through the real mutation.
 * Panel closure never cancels an authoritative response or its reconciliation. */
export function useSectorPlayerAction(options: {
    sector: number | null; present: boolean; rows: () => readonly WorldSectorCommandPlayer[];
    attack: (target: PlayerRecord) => void | Promise<void>;
    strike: (target: PlayerRecord) => void | Promise<void>;
    spectate: (target: PlayerRecord, isCurrent: () => boolean) => void | Promise<void>;
}) {
    const latest = useRef(options);
    useLayoutEffect(() => { latest.current = options; });
    const lock = useRef(false);
    const mounted = useRef(false);
    const [state, setState] = useState<SectorPlayerActionState>({ pending: null, error: null });
    useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    async function run(key: string, sector: number, intent: SectorPlayerIntent = 'attack', originCurrent: () => boolean = () => true) {
        if (lock.current) return;
        const current = latest.current;
        if (!current.present || sector !== current.sector) return;
        const row = current.rows().find(player => sectorPlayerKey(player.name) === key);
        const watching = intent === 'spectate';
        const changedAction = row && !watching && (intent === 'strike') !== row.sleeping;
        if (!row || changedAction || (watching ? row.status !== 'Fighting' || row.spectateDisabled : row.actionDisabled)) {
            setState({ pending: null, error: { key, sector, message: !row ? 'This player has left the sector.' : changedAction ? 'This player’s action changed. Try again.' : row.disabledReason || 'This player is no longer available for that action.' } });
            return;
        }
        lock.current = true;
        setState({ pending: key, error: null });
        const isCurrent = () => mounted.current && originCurrent() && latest.current.present && latest.current.sector === sector
            && latest.current.rows().some(p => sectorPlayerKey(p.name) === key && p.status === 'Fighting' && !p.spectateDisabled);
        try { await (watching ? current.spectate(row.target, isCurrent) : row.sleeping ? current.strike(row.target) : current.attack(row.target)); }
        catch (error) {
            if (mounted.current && latest.current.sector === sector)
                setState({ pending: null, error: { key, sector, message: error instanceof Error ? error.message : 'The action could not be completed. Try again.' } });
        } finally {
            lock.current = false;
            if (mounted.current) setState(previous => ({ ...previous, pending: null }));
        }
    }
    return { ...state, error: state.error?.sector === options.sector ? state.error : null, run };
}
