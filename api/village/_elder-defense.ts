import { reconcileElderFocus } from './_elders.js';

/** Seal the personal defense doctrine only for field combat with an enemy village. */
export async function elderWarDefensePct(character: Record<string, unknown> | undefined, enemyVillage: unknown): Promise<number> {
    if (character?.elderFocus !== 'war' || !character.village || !enemyVillage || character.village === enemyVillage) return 0;
    if ((await reconcileElderFocus(character)).elderFocus !== 'war') return 0;
    const { villagesAreAtWar } = await import('../world-state.js');
    return await villagesAreAtWar(String(character.village), String(enemyVillage)) ? 1 : 0;
}
