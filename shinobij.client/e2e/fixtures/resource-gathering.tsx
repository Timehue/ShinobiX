import '../../src/index.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ShinobiOutpost } from '../../src/screens/ShinobiOutpost';
import { ResourceWorld } from '../../src/components/ResourceWorld';
import { GatheringEquipment } from '../../src/components/GatheringEquipment';
import type { Character, VersionedCharacterCommit } from '../../src/types/character';
import { resourceNode } from '../../../shared/resource-nodes';
import { SECTOR_PLACES } from '../../../shared/sector-geo';

const query = new URLSearchParams(location.search);
const node = resourceNode(query.get('node') ?? 'resource-13')!;
const initial = (window as unknown as { resourceSeed: Character }).resourceSeed;
export function Fixture() {
    const [character, setCharacter] = useState<Character | null>(initial);
    const [version, setVersion] = useState(1), [tile, setTile] = useState(node.approach);
    const [accepted, setAccepted] = useState<string[]>([]), [progress, setProgress] = useState<Record<string, number>>({});
    const [mounted, setMounted] = useState(true);
    const commit: VersionedCharacterCommit = (next, nextVersion) => {
        if (typeof nextVersion !== 'number' || nextVersion < version) return false;
        setCharacter(next); setVersion(nextVersion); return true;
    };
    if (!character) return null;
    return <main style={{ maxWidth: 1080, margin: '20px auto', padding: 12 }}>
        {query.has('lifecycle') && <button type="button" data-testid="gathering-mount" onClick={() => setMounted(value => !value)}>Toggle gathering mount</button>}
        {query.get('screen') === 'kit' ? <div style={{ width: 260, maxWidth: '100%' }}><GatheringEquipment character={character} commit={commit} /></div>
            : query.get('screen') === 'outpost' ? <ShinobiOutpost character={character} updateCharacter={setCharacter} onVersionedCharacter={commit}
            onServerVersion={() => true} creatorAis={[]} acceptedMissionIds={accepted} setAcceptedMissionIds={setAccepted}
            missionProgress={progress} setMissionProgress={setProgress} setScreen={() => undefined} />
            : <div style={{ position: 'relative', width: '100%', aspectRatio: '1', backgroundSize: 'cover', backgroundImage: `url(/sector-map/s${SECTOR_PLACES.find(p => p.id === node.sector)!.artKey}.webp)` }}>
                {mounted && <ResourceWorld character={character} sector={node.sector} tile={tile} commit={commit} walk={(_, target) => setTile(target)} />}
            </div>}
        <pre hidden data-testid="resource-state">{JSON.stringify({ character, version, tile })}</pre>
    </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
