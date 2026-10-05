import type { GameConfirmOptions } from "./GameAlert";
import type { GameToastOptions } from "./GameToast";
import { usePlayGameServices } from "../lib/use-play-game-services";
import type { Character, VersionedCharacterCommit } from "../types/character";

export function PlayGameServicesHost({
    character,
    commitVersionedCharacter,
    confirm,
    toast,
}: {
    character: Character;
    commitVersionedCharacter: VersionedCharacterCommit;
    confirm: (message: string, options?: GameConfirmOptions) => Promise<boolean>;
    toast: (message: string, options?: GameToastOptions) => void;
}) {
    usePlayGameServices(character, commitVersionedCharacter, confirm, toast);
    return null;
}
