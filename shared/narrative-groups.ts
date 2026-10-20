/** Server-owned rosters for authored fights which describe several opponents.
 * Numerical move fields continue to come from the existing jutsu catalog. */
import { narrativeEnemyIdentity } from './narrative-enemy-identity.js';
export type NarrativeGroupMember = {
    id: string; name: string; specialty: 'Ninjutsu' | 'Taijutsu' | 'Bukijutsu' | 'Genjutsu';
    visual: string; portrait: string; jutsuIds: string[]; weight: number;
};
export type NarrativeGroup = { id: string; name?: string; members: NarrativeGroupMember[]; damageScale?: number };
type Role = 'captain' | 'blade' | 'sealer' | 'bruiser' | 'marksman';
const schools = { captain: 'Ninjutsu', blade: 'Bukijutsu', sealer: 'Genjutsu', bruiser: 'Taijutsu', marksman: 'Bukijutsu' } as const;
const visuals = { captain: 'defender', blade: 'skirmisher', sealer: 'elementalist', bruiser: 'bruiser', marksman: 'assassin' };
function member(id: string, name: string, role: Role, element: string, weight = 1): NarrativeGroupMember {
    const school = { captain: 'nin', blade: 'buki', sealer: 'gen', bruiser: 'tai', marksman: 'buki' }[role];
    const namedId = ({ 'Black Bridge Roof Shooter': 'black-bridge-shooter', 'Hunter-Nin Shirakawa': 'hunter-shirakawa', 'Kuroban, the Bodyguard': 'house-kuroban', 'Cinder': 'ashbound-cinder', 'Bandit Captain Goro': 'bandit-captain-goro' } as Record<string, string>)[name];
    return { id, name, specialty: schools[role], visual: namedId ?? visuals[role], portrait: narrativeEnemyIdentity(namedId)?.portrait ?? `/portraits/pve/${visuals[role]}.webp`, weight,
        jutsuIds: [`starter-${school}-${element}-2`, `starter-${school}-${element}-${role === 'captain' || role === 'sealer' ? 1 : 3}`, 'starter-universal-flicker'] };
}
function squad(id: string, prefix: string, element: string, soldiers: number, damageScale = 1): NarrativeGroup {
    const roles: Role[] = ['blade', 'sealer', 'bruiser', 'marksman'];
    return { id, damageScale, members: [member(`${id}-captain`, `${prefix} Captain`, 'captain', element, 2),
        ...Array.from({ length: soldiers }, (_, i) => member(`${id}-soldier-${i + 1}`, `${prefix} ${['Blade', 'Sealer', 'Striker', 'Marksman'][i % 4]} ${Math.floor(i / 4) + 1}`, roles[i % 4], element))] };
}
function party(id: string, name: string, element: string, roles: Array<[string, Role]>, damageScale = 1): NarrativeGroup {
    return { id, name, damageScale, members: roles.map(([label, role], i) => member(`${id}-${i + 1}`, label, role, element, i === 0 ? 2 : 1)) };
}
export const NARRATIVE_GROUPS: Readonly<Record<string, NarrativeGroup>> = {
    // Unlock-level simulations: extra independent turns retain a base damage
    // floor even after offense is split. Seal an explicit formation budget.
    'story-ai-stormveil-village-65': squad('tempest-execution', 'Tempest Execution', 'lightning', 8, .95),
    'story-ai-ashen-leaf-village-65': party('rootbound-retrieval', 'Rootbound Retrieval Squad', 'earth', [
        ['Rootbound Retrieval Leader', 'captain'], ['Rootbound Retrieval Blade', 'blade'], ['Rootbound Retrieval Sealer', 'sealer']], 1.6),
    'story-ai-frostfang-village-35': squad('oathbound-recovery', 'Oathbound Recovery', 'water', 12, .5),
    'story-ai-frostfang-village-65': party('oathbound-purge', 'Oathbound Purge Unit', 'water', [
        ['Oathbound Purge Captain', 'captain'], ['Oathbound Purge Blade', 'blade'], ['Oathbound Purge Sealer', 'sealer']], 2.15),
    'road-ai-black-bridge': party('black-bridge', 'Black Bridge Raiders', 'water', [
        ['Black Bridge Roof Shooter', 'marksman'], ['Black Bridge Blade', 'blade'], ['Black Bridge Sealer', 'sealer']], .85),
    'world-questbook-qb-defector-hunter-shirakawa': party('erasure-team', 'Shirakawa’s Erasure Team', 'water', [
        ['Hunter-Nin Shirakawa', 'captain'], ['Erasure Team Blade', 'blade'], ['Erasure Team Sealer', 'sealer']], .75),
    'world-questbook-qb-debt-house-kuroban': party('house-collectors', 'Kuroban and the House Collectors', 'earth', [
        ['Kuroban, the Bodyguard', 'bruiser'], ['House Blade Collector', 'blade'], ['House Seal Collector', 'sealer']]),
    'world-questbook-qb-ashes-ashbound-cinder': party('ashbound-scouts', 'Cinder’s Scout Team', 'fire', [
        ['Cinder', 'captain'], ['Ashbound Scout Blade', 'blade'], ['Ashbound Scout Sealer', 'sealer']], .85),
    'goro-wave-1': party('goro-vanguard', 'Goro’s Challenge — Wave 1: Vanguard', 'earth', [
        ['Goro’s Vanguard Striker', 'bruiser'], ['Goro’s Vanguard Marksman', 'marksman']], .5),
    'goro-wave-2': party('goro-flank', 'Goro’s Challenge — Wave 2: Flankers', 'wind', [
        ['Goro’s Flanking Blade', 'blade'], ['Goro’s Flanking Sealer', 'sealer']], .5),
    'goro-wave-3': party('goro-command', 'Goro’s Challenge — Wave 3: Captain', 'earth', [
        ['Bandit Captain Goro', 'captain'], ['Goro’s Bodyguard', 'bruiser']], .5),
    'world-crisis-fourfold-breach-v1:frostfang': party('breach-recovery', 'Oathbound Ice Captain and Escorts', 'water', [
        ['Oathbound Ice Captain', 'captain'], ['Oathbound Escort Blade', 'blade'], ['Oathbound Escort Sealer', 'sealer']], .8),
};

/** Only server-resolved identities choose a roster. A profile override is used
 * solely for the three Goro waves, derived from durable quest-win receipts. */
export function narrativeGroupFor(profileId: string, variant?: unknown, displayName = ''): NarrativeGroup | undefined {
    if (profileId === 'world-questbook-qb-caravan-bandit-captain-goro') {
        return NARRATIVE_GROUPS[typeof variant === 'string' && /^goro-wave-[123]$/.test(variant) ? variant : 'goro-wave-1'];
    }
    if (profileId.startsWith('world-patrol-')) {
        const element = displayName.includes('Stormveil') ? 'lightning' : displayName.includes('Frostfang') ? 'water'
            : displayName.includes('Moonshadow') ? 'wind' : 'earth';
        const group = squad('road-patrol', displayName.replace(/ Captain$/, ''), element, 2, .75);
        group.members[0].name = / Captain$/.test(displayName) ? displayName : `${displayName} Leader`;
        return group;
    }
    return Object.hasOwn(NARRATIVE_GROUPS, profileId) ? NARRATIVE_GROUPS[profileId] : undefined;
}
