import type { Character } from "../types/character";

export type CafeteriaMealId = "small-ramen" | "shinobi-meal" | "feast";

export type CafeteriaMeal = {
    id: CafeteriaMealId;
    name: string;
    cost: number;
    hp: number;
    chakra: number;
    stamina: number;
};

export const CAFETERIA_MEALS: CafeteriaMeal[] = [
    { id: "small-ramen", name: "Small Ramen", cost: 20, hp: 25, chakra: 10, stamina: 10 },
    { id: "shinobi-meal", name: "Shinobi Meal", cost: 50, hp: 75, chakra: 35, stamina: 35 },
    { id: "feast", name: "Feast", cost: 100, hp: 9999, chakra: 9999, stamina: 9999 },
];

export type CafeteriaMealResult = {
    ok: boolean;
    error?: string;
    meal?: CafeteriaMeal;
    character?: Character;
};

export async function buyCafeteriaMeal(playerName: string, mealId: CafeteriaMealId): Promise<CafeteriaMealResult> {
    try {
        const res = await fetch("/api/player/cafeteria", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, mealId }),
        });
        const data = await res.json().catch(() => ({})) as CafeteriaMealResult;
        if (!res.ok || !data.ok) return { ...data, ok: false, error: data.error || "The cafeteria is too busy right now." };
        return { ...data, ok: true };
    } catch {
        return { ok: false, error: "The cafeteria is too busy right now." };
    }
}
