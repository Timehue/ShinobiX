import { createRoot } from 'react-dom/client';
import { useState, type ComponentProps } from 'react';
import './index.css';
import './styles/veiled-steel.css';
import { AdminTournaments } from './features/tournaments/AdminTournaments';
import { ArenaDistrictLobby } from './features/arena/components/ArenaDistrictLobby';
import type { ArenaDistrictTab } from './features/arena/types';
import type { Character } from './types/character';
import { installAuthFetch, setActivePlayer, setActiveToken } from './authFetch';
import { GameConfirmHost } from './components/GameAlert';
const params = new URLSearchParams(location.search);
let character = { name: 'Akira', level: 30, pets: [], rankedRating: 1000 } as unknown as Character;
export function Harness() {
    const [tab, setTab] = useState<ArenaDistrictTab>('tournaments');
    const [fighting, setFighting] = useState(false);
    const props = { tournamentFightActive: fighting, onTournamentFightStateChange: setFighting, character, activeTab: tab, onTabChange: setTab, onBack: () => {}, onVersionedCharacter: () => {},
        dojoCircuitEnabled: false, hasAvailablePet: false, spectatorFights: [], incomingClanWarChallenges: [],
        pendingSpectatorChallenges: [], clanWarOpponents: [] } as unknown as ComponentProps<typeof ArenaDistrictLobby>;
    return <main style={{ maxWidth: 1250, margin: '0 auto', padding: 'clamp(8px, 2vw, 28px)' }}>
        <GameConfirmHost />
        {new URLSearchParams(location.search).has('admin') ? <AdminTournaments credential="qa-admin" /> : <ArenaDistrictLobby {...props} />}
    </main>;
}
async function boot() {
    if (params.has('live') && !params.has('admin')) {
        const response = await fetch(`/qa-tournament/player/${encodeURIComponent(params.get('player') ?? 'akira')}`);
        const player = await response.json();
        character = player.character;
        setActivePlayer(character.name); setActiveToken(player.token); installAuthFetch();
    }
    createRoot(document.getElementById('root')!).render(<Harness />);
}
void boot();
