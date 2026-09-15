import { mkdir, writeFile } from 'node:fs/promises';
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
const { buildSoloPveAiEncounter } = await import('../../../api/solo-pve/_ai-encounter.js');
const { builtinAiProfile } = await import('../../../api/_ai-profile-catalog.js');
const { loadAdminCombatContent } = await import('../../../api/_admin-content.js');
const character = { name: 'scout', level: 100, village: 'Frostfang Village', avatarImage: '/anbu/frostfang.webp',
    hp: 10000, maxHp: 10000, chakra: 1000, maxChakra: 1000, stamina: 1000, maxStamina: 1000, stats: {}, equipment: {}, inventory: [], itemStacks: [], jutsu: [], jutsuMastery: [] };
const session = buildSoloPveAiEncounter({ sessionId: 'qa-patrol', playerName: 'scout', save: { character }, now: Date.now(),
    admin: await loadAdminCombatContent(), profile: { ...builtinAiProfile('story-ai-ashen-leaf-village-15')!, name: 'Stronghold Sentry' },
    scaling: { level: 90 }, continuousVitals: true, encounter: { kind: 'stronghold-patrol', id: '12', bindingId: 'qa', metadata: { sector: 12 } } });
await mkdir('.tmp/stronghold-audit', { recursive: true });
await writeFile('.tmp/stronghold-audit/session.json', JSON.stringify(session));
