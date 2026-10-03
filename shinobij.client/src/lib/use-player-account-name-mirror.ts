import { useEffect } from "react";
import type { Character } from "../types/character";
import { accountKey, loadPlayerAccounts, savePlayerAccounts } from "./player-accounts";

/** Mirror the verified display name into the local account chooser. */
export function usePlayerAccountNameMirror(character: Character | null): void {
    useEffect(() => {
        if (!character?.accountName) return;
        const accounts = loadPlayerAccounts();
        const key = accountKey(character.name);
        if (accounts[key]?.accountName === character.accountName) return;
        accounts[key] = { ...accounts[key], accountName: character.accountName };
        savePlayerAccounts(accounts);
    }, [character?.name, character?.accountName]);
}
