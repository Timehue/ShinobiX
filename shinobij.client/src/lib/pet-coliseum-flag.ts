/*
 * Cinematic-arena (HD-2D coliseum) flag — shared by every pet-battle call site
 * (Pet Arena, Hollow Gate dungeon duels) so the choice is consistent.
 *
 * Defaults ON. The classic DOM battlefield (PetArenaBattlefield) is kept fully
 * intact as the fallback: any player can flip back with the in-arena toggle,
 * and turning the default off again is this one constant. Per-device persisted.
 */
const KEY = "petColiseum.v1";

export function petColiseumEnabled(): boolean {
    try { return localStorage.getItem(KEY) !== "0"; } catch { return true; }
}

export function setPetColiseumEnabled(on: boolean): void {
    try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* storage disabled — ignore */ }
}
