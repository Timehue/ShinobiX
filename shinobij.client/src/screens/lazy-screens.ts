/*
 * Lazily loaded screens, declared outside App.tsx so its line budget
 * (src/App.size.test.ts) goes to wiring rather than declarations. Moved
 * verbatim from App.tsx: each is still a lazyWithRetry() wrapper, so its chunk
 * loads exactly when it did before. App.tsx imports them back.
 */
import { lazyWithRetry } from "../lib/lazyWithRetry";

export const Inventory = lazyWithRetry(() => import("./Inventory").then(m => ({ default: m.Inventory })));
export const BattleLogScreen = lazyWithRetry(() => import("./BattleLogScreen").then(m => ({ default: m.BattleLogScreen })));
export const Hospital = lazyWithRetry(() => import("./Hospital").then(m => ({ default: m.Hospital })));
export const DojoCircuit = lazyWithRetry(() => import("./DojoCircuit").then(m => ({ default: m.DojoCircuit })));
export const CircuitReturnRibbon = lazyWithRetry(() => import("../features/dojo-circuit/CircuitEntry").then(m => ({ default: m.CircuitReturnRibbon })));
