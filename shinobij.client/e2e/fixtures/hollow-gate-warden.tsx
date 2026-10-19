import { createRoot } from 'react-dom/client';
import { HollowGateFight } from '../../src/screens/HollowGateFight';
import type { Character } from '../../src/types/character';
import type { SoloPveSession } from '../../src/lib/solo-pve-api';
import { sealHollowGateTelegraph } from '../../../shared/hollow-gate-telegraph';
import '../../src/index.css';
import '../../src/styles/late-normalize.css';
import '../../src/styles/veiled-steel.css';
import '../../src/styles/layout/adaptive-shell.css';
import '../../src/styles/layout/adaptive-stages.css';
import '../../src/styles/input-accessibility.css';

// The real fight screen and adapter. Only its sealed server result is stubbed.
const done = new URLSearchParams(location.search).has('cap');
const fighter = (name: string, pos: number) => ({ name, pos, hp: 10000, maxHp: 10000, chakra: 5000, maxChakra: 5000,
    stamina: 5000, maxStamina: 5000, shield: 0, statuses: [],
    character: { name, level: 100, specialty: 'Genjutsu', stats: {}, jutsu: [], pvpItems: [], equipment: {} } });
const session = { runtime: 'solo-pve', schemaVersion: 1, sessionId: 'warden-qa', ownerSlug: 'wardenrunner',
    encounter: { kind: 'hollow-gate', id: 'warden', metadata: { combatKind: 'boss', floor: 3 } },
    player: fighter('WardenRunner', 26), enemy: { ...fighter('Mirror-Shard Warden', 27), hp: 17100, maxHp: 24360 },
    round: done ? 26 : 18, activeSide: 'player', ap: { player: 100, enemy: 100 }, actionsThisTurn: 0,
    cooldowns: { player: {}, enemy: {} }, groundEffects: [], itemCharges: {}, itemsUsed: {},
    environment: { biome: 'shadow', blockedTiles: [] }, status: done ? 'done' : 'active', winner: done ? 'enemy' : null,
    outcome: done ? 'loss' : null, terminalReason: done ? 'round-limit' : undefined, hollowGateRoundLimit: 25,
    settlementState: 'pending', log: [], events: [], eventSeq: 0, version: 1, recentMoveTokens: [],
    createdAt: 1, lastActionAt: 1, expiresAt: Date.now() + 600000 } as SoloPveSession;
sealHollowGateTelegraph(session);
Object.assign(window, { wardenQaSession: session });
const character = { name: 'WardenRunner', level: 100, hp: 10000, maxHp: 10000, stats: {}, jutsu: [], equipment: {} } as unknown as Character;
createRoot(document.getElementById('root')!).render(<HollowGateFight character={character}
    fight={{ runId: session.sessionId, floor: 3, nodeId: 'floor:3:ambush:boss-threat', kind: 'boss', session }}
    settle={async () => ({ ok: true, won: false, ended: true, terminalReason: 'round-limit', opponentName: 'Mirror-Shard Warden' })}
    onResolved={() => { document.body.dataset.resolved = 'yes'; }} />);
