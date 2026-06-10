// Story-boss resume persistence (mirrors the arena persister; 1h TTL).
export const STORY_BOSS_SAVE_TTL_MS = 60 * 60 * 1000;
export function storyBossSaveKey(name: string): string { return `storyBoss.battle.v1.${name}`; }
