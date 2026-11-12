export const WORLD_RUN_MS = 15_000;
export const WORLD_RUN_REFILL_MS = 20_000;

export type WorldRunAction = 'start-run' | 'stop-run';
export type WorldRunWindow = { endsAt: number; readyAt: number; serverTime: number };
