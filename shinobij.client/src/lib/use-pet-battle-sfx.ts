/*
 * usePetBattleFrameSfx — one synthesized SFX per resolved battle frame.
 *
 * Extracted VERBATIM from the inline effect in PetArenaBattlefield (App.tsx) so
 * the DOM renderer and the HD-2D PetColiseum renderer share ONE sound source of
 * truth (no divergence, no double-play — only one renderer is mounted at a time,
 * each calls this once). Behaviour is identical to the old inline effect: keyed
 * on the frame message, muted-aware, result frames stay silent.
 */
import { useEffect } from "react";
import { playPetSfx } from "./pet-sfx";

/** The subset of a battle frame the SFX picker reads (structural, so the real
 *  PetArenaFrame is assignable without coupling to App). */
export type PetSfxFrame = {
    message?: string;
    isKO?: boolean;
    actionKind?: string;
    crit?: boolean;
} | undefined;

export function usePetBattleFrameSfx(frame: PetSfxFrame, muted: boolean): void {
    useEffect(() => {
        if (!frame || muted) return;
        const m = frame.message ?? "";
        if (/dodges|evades|blunts the blow/.test(m)) { playPetSfx("dodge"); return; }
        if (frame.isKO) { playPetSfx("ko"); return; }
        // Match-end win/lose stingers intentionally removed — result frames are silent.
        if (frame.actionKind === "result") return;
        switch (frame.actionKind) {
            case "damage": case "basic": case "lifesteal": playPetSfx(frame.crit ? "crit" : "hit"); break;
            case "heal":     playPetSfx("heal"); break;
            case "buff":     playPetSfx("buff"); break;
            case "dot":      playPetSfx("dot"); break;
            case "debuff":   playPetSfx("debuff"); break;
            case "movelock": playPetSfx("movelock"); break;
            case "shield": case "barrier": case "absorb": playPetSfx("shield"); break;
            default: break;
        }
        // Super-effective matchup → layer a bright rising sting on top of the hit.
        if (/super effective/i.test(m) && (frame.actionKind === "damage" || frame.actionKind === "basic" || frame.actionKind === "lifesteal")) playPetSfx("superEffective");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [frame?.message]);
}
