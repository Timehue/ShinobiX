/*
 * nindo-backgrounds — selectable "banner" treatments for a player's Nindo.
 *
 * Self-contained painterly backdrops in the game's palette — no image assets
 * and no API/generation needed, so the Nindo section looks styled even when a
 * player has barely written anything. Each preset bakes in a dark scrim so the
 * (possibly player-coloured) BBCode creed text stays readable on top.
 *
 * Forward-compatible: a generated painted banner (scripts/gen-bg.mjs) can be
 * added later as just another preset whose `background` is `url(<import>)` —
 * the picker, the `nindoBg` field, and the renderer all stay the same. Keep the
 * ids in sync with the server allowlist in api/save/[name].ts.
 */
import type { CSSProperties } from "react";

export type NindoBackground = { id: string; label: string; background: string };

export const NINDO_BACKGROUNDS: NindoBackground[] = [
    { id: "", label: "None", background: "" },
    {
        id: "ember", label: "Ember",
        background: "linear-gradient(180deg, rgba(10,8,12,.74), rgba(8,6,10,.9)), radial-gradient(120% 85% at 50% 120%, rgba(255,120,40,.5), transparent 60%), linear-gradient(160deg, #3a0f12, #120608)",
    },
    {
        id: "frost", label: "Frost",
        background: "linear-gradient(180deg, rgba(8,12,20,.72), rgba(6,10,18,.9)), radial-gradient(120% 85% at 50% -10%, rgba(120,200,255,.42), transparent 60%), linear-gradient(160deg, #0f2740, #06121f)",
    },
    {
        id: "verdant", label: "Verdant",
        background: "linear-gradient(180deg, rgba(8,14,10,.74), rgba(5,10,7,.9)), radial-gradient(120% 85% at 70% 0%, rgba(180,230,120,.38), transparent 60%), linear-gradient(160deg, #16331c, #08160d)",
    },
    {
        id: "shadow", label: "Shadow",
        background: "linear-gradient(180deg, rgba(10,8,16,.8), rgba(6,5,10,.92)), radial-gradient(100% 85% at 50% 0%, rgba(150,90,220,.34), transparent 60%), linear-gradient(160deg, #1b1230, #070510)",
    },
    {
        id: "royal", label: "Kage Gold",
        background: "linear-gradient(180deg, rgba(8,10,22,.76), rgba(6,7,16,.9)), radial-gradient(120% 85% at 50% -10%, rgba(250,204,21,.38), transparent 55%), linear-gradient(160deg, #1a1c3a, #0a0b18)",
    },
    {
        id: "sakura", label: "Sakura",
        background: "linear-gradient(180deg, rgba(16,8,14,.72), rgba(10,6,10,.9)), radial-gradient(120% 85% at 50% 0%, rgba(255,150,190,.38), transparent 60%), linear-gradient(160deg, #3a1530, #160812)",
    },
];

const BY_ID = new Map(NINDO_BACKGROUNDS.map((b) => [b.id, b]));

/** Allowlisted preset ids (mirror in api/save/[name].ts). */
export const NINDO_BACKGROUND_IDS = NINDO_BACKGROUNDS.map((b) => b.id);

/** CSS for a chosen preset; `{}` for "none"/unknown so the card stays plain. */
export function nindoBgStyle(id?: string): CSSProperties {
    const b = id ? BY_ID.get(id) : undefined;
    if (!b || !b.background) return {};
    return { background: b.background, backgroundSize: "cover", backgroundPosition: "center" };
}
