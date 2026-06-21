"use strict";
/*
 * Minimal server-side Pet types for the ported pet-combat engines (_duel-sim.ts,
 * _arena-sim.ts). The server build (tsconfig.cpanel.json) excludes shinobij.client,
 * so the sims are hand-ported here and these types mirror the combat-relevant subset
 * of shinobij.client/src/types/pet.ts. KEEP IN SYNC with that file — only the fields
 * the sims + gear helpers actually read are duplicated.
 */
Object.defineProperty(exports, "__esModule", { value: true });
