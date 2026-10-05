import { useEffect, useLayoutEffect, useRef } from "react";
import type { GameConfirmOptions } from "../components/GameAlert";
import type { GameToastOptions } from "../components/GameToast";
import type { Character, VersionedCharacterCommit } from "../types/character";
import {
    claimPlayRewardPurchase,
    onPlayRewardPurchases,
    playRewardLabelForProduct,
    recordServerConfirmedPlayEvent,
    type PlayRewardPurchase,
} from "./google-play-games";

type Confirm = (message: string, options?: GameConfirmOptions) => Promise<boolean>;
type Toast = (message: string, options?: GameToastOptions) => void;

/** Keep Play Games callbacks at the app boundary while the native bridge owns receipts. */
export function usePlayGameServices(
    character: Character | null,
    commitVersionedCharacter: VersionedCharacterCommit,
    confirm: Confirm,
    toast: Toast,
): void {
    const characterRef = useRef(character);
    const commitRef = useRef(commitVersionedCharacter);
    const confirmRef = useRef(confirm);
    const toastRef = useRef(toast);
    const pendingPurchasesRef = useRef<PlayRewardPurchase[]>([]);
    const activeTokensRef = useRef(new Set<string>());
    const claimBusyRef = useRef(false);
    const drainPurchasesRef = useRef<(() => Promise<void>) | null>(null);

    const playerName = character?.name;
    const currentProgress = character?.level;
    useEffect(() => {
        if (!playerName || typeof currentProgress !== "number"
            || !Number.isSafeInteger(currentProgress) || currentProgress < 1) return;
        void recordServerConfirmedPlayEvent("progress_update", { currentProgress });
    }, [playerName, currentProgress]);

    async function drainPurchases(): Promise<void> {
        if (claimBusyRef.current || !characterRef.current) return;
        claimBusyRef.current = true;
        try {
            while (pendingPurchasesRef.current.length > 0) {
                const purchase = pendingPurchasesRef.current.shift()!;
                const expectedLabel = playRewardLabelForProduct(purchase.productId);
                const owner: string | undefined = characterRef.current?.name;
                if (!expectedLabel || !owner) continue;
                activeTokensRef.current.add(purchase.purchaseToken);
                try {
                    const confirmed = await confirmRef.current(
                        `Claim “${expectedLabel}” for ${owner}?`,
                        { title: "Play Games Reward", confirmLabel: "Claim reward", cancelLabel: "Later" },
                    );
                    if (!confirmed) continue;
                    if (characterRef.current?.name !== owner) break;
                    const result = await claimPlayRewardPurchase(owner, purchase);
                    if (result.rewardLabel !== expectedLabel) throw new Error("The Play reward response did not match the selected offer.");
                    if (characterRef.current?.name !== owner) continue;
                    const updatedCharacter = result.character as Character | undefined;
                    if (!updatedCharacter || updatedCharacter.name !== owner || !Number.isFinite(result.saveVersion)
                        || !commitRef.current(updatedCharacter, result.saveVersion)) {
                        throw new Error("The reward was delivered, but this screen could not safely refresh your save. Reopen the game to sync it.");
                    }
                    toastRef.current(result.ryo
                        ? result.alreadyOwned
                            ? `This ${result.ryo.toLocaleString()} Ryo reward was already delivered.`
                            : `${result.ryo.toLocaleString()} Ryo added to your wallet.`
                        : result.alreadyOwned
                            ? `${expectedLabel} is already in your title collection.`
                            : `${expectedLabel} added to your title collection.`, { kind: "success" });
                    if (!result.acknowledged) {
                        toastRef.current("Google Play receipt confirmation will retry when the game reconnects.", { kind: "info" });
                    }
                } catch (error) {
                    window.alert(error instanceof Error ? error.message : "The Play reward could not be claimed. Reopen the game to retry.");
                } finally {
                    activeTokensRef.current.delete(purchase.purchaseToken);
                }
            }
        } finally {
            claimBusyRef.current = false;
            if (pendingPurchasesRef.current.length > 0 && characterRef.current) {
                queueMicrotask(() => { void drainPurchases(); });
            }
        }
    }

    useLayoutEffect(() => {
        characterRef.current = character;
        commitRef.current = commitVersionedCharacter;
        confirmRef.current = confirm;
        toastRef.current = toast;
        drainPurchasesRef.current = drainPurchases;
    });

    useEffect(() => onPlayRewardPurchases((purchase) => {
        if (activeTokensRef.current.has(purchase.purchaseToken)) return;
        if (pendingPurchasesRef.current.some((queued) => queued.purchaseToken === purchase.purchaseToken)) return;
        pendingPurchasesRef.current.push(purchase);
        void drainPurchasesRef.current?.();
    }), []);

    useEffect(() => { void drainPurchasesRef.current?.(); }, [playerName]);
}
