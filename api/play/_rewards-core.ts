import { createHash } from 'node:crypto';
import { PLAY_GAMES_REWARD_PRODUCTS, playGamesRewardProduct } from '../../shared/play-games-rewards.js';

export type PlayRewardPurchaseVerification = {
    purchaseState: number;
    acknowledged: boolean;
    consumed: boolean;
};

export type PlayRewardReceipt = {
    version: 1;
    playerName: string;
    productId: string;
    rewardLabel: string;
    state: 'pending' | 'granted' | 'acknowledged' | 'consumed';
    grantedAt?: number;
    acknowledgedAt?: number;
};

export type PlayRewardGrantResult = {
    ok: boolean;
    status?: number;
    error?: string;
    alreadyOwned?: boolean;
    character?: Record<string, unknown>;
    saveVersion?: number;
};

export class PlayRewardClaimError extends Error {
    constructor(readonly status: number, message: string) {
        super(message);
        this.name = 'PlayRewardClaimError';
    }
}

export type PlayRewardClaimDependencies = {
    getReceipt: (key: string) => Promise<PlayRewardReceipt | null>;
    setReceipt: (key: string, value: PlayRewardReceipt) => Promise<unknown>;
    withLock: <T>(key: string, action: () => Promise<T>) => Promise<T>;
    verifyPurchase: (productId: string, purchaseToken: string) => Promise<PlayRewardPurchaseVerification>;
    acknowledgePurchase: (productId: string, purchaseToken: string) => Promise<void>;
    consumePurchase: (productId: string, purchaseToken: string) => Promise<void>;
    grantTitle: (playerName: string, title: string) => Promise<PlayRewardGrantResult>;
    grantRyo: (playerName: string, amount: number, purchaseDigest: string) => Promise<PlayRewardGrantResult>;
    now?: () => number;
};

const TOKEN_MAX_LENGTH = 4096;

/**
 * Verify, grant once, and settle a Play Games out-of-app reward.
 * The raw purchase token is never persisted: its SHA-256 digest is the durable
 * cross-worker receipt key. Title union and the Ryo purchase receipt are
 * persisted atomically with their respective save mutations.
 */
export async function claimPlayGamesReward(
    args: { playerName: string; productId: string; purchaseToken: string },
    deps: PlayRewardClaimDependencies,
): Promise<{ rewardLabel: string; title?: string; ryo?: number; granted: boolean; acknowledged: boolean; alreadyOwned: boolean; character?: Record<string, unknown>; saveVersion?: number }> {
    const product = playGamesRewardProduct(args.productId);
    if (!product) throw new PlayRewardClaimError(400, 'This Play reward is not supported.');
    if (typeof args.purchaseToken !== 'string' || args.purchaseToken.length < 16 || args.purchaseToken.length > TOKEN_MAX_LENGTH) {
        throw new PlayRewardClaimError(400, 'The Play reward receipt is invalid.');
    }

    const digest = createHash('sha256').update(args.purchaseToken, 'utf8').digest('hex');
    const receiptKey = `play:reward:purchase:${digest}`;
    const applyReward = () => product.kind === 'title'
        ? deps.grantTitle(args.playerName, product.title)
        : deps.grantRyo(args.playerName, product.amount, digest);
    const resultFields = () => product.kind === 'title'
        ? { title: product.title }
        : { ryo: product.amount };
    return deps.withLock(receiptKey, async () => {
        let receipt = await deps.getReceipt(receiptKey);
        if (receipt && (receipt.playerName !== args.playerName || receipt.productId !== product.productId)) {
            throw new PlayRewardClaimError(409, 'This Play reward receipt is already linked to another account.');
        }

        // A settled receipt needs no Google call. Ryo receipts use the explicit
        // consumed state; an older acknowledged Ryo receipt is retried below
        // so the server can consume it and allow the weekly SKU to be bought again.
        if (receipt?.state === 'consumed' || (product.kind === 'title' && receipt?.state === 'acknowledged')) {
            const replayGrant = await applyReward();
            if (!replayGrant.ok) throw new PlayRewardClaimError(replayGrant.status ?? 503, replayGrant.error ?? 'Reward delivery failed. Please retry.');
            return {
                rewardLabel: product.label,
                ...resultFields(),
                granted: false,
                acknowledged: true,
                alreadyOwned: replayGrant.alreadyOwned === true,
                ...(replayGrant.character ? { character: replayGrant.character } : {}),
                ...(Number.isFinite(replayGrant.saveVersion) ? { saveVersion: replayGrant.saveVersion } : {}),
            };
        }

        let verified: PlayRewardPurchaseVerification;
        try {
            verified = await deps.verifyPurchase(product.productId, args.purchaseToken);
        } catch {
            throw new PlayRewardClaimError(502, 'Google Play could not verify this reward yet. Please try again.');
        }
        // Purchases.products:get reports 0 only for PURCHASED. Pending,
        // cancelled, missing, or any unknown state must never grant an item.
        if (!verified || verified.purchaseState !== 0) {
            throw new PlayRewardClaimError(409, 'Google Play has not confirmed this reward yet.');
        }
        // A consumed Ryo receipt can only be replayed when its server-side
        // ownership journal still exists. Otherwise fail closed: do not grant
        // the same spent Play token to a different game account.
        if (product.kind === 'ryo' && verified.consumed && !receipt) {
            throw new PlayRewardClaimError(409, 'This Play reward receipt was already processed.');
        }

        const now = (deps.now ?? Date.now)();
        receipt ??= {
            version: 1,
            playerName: args.playerName,
            productId: product.productId,
            rewardLabel: product.label,
            state: 'pending',
        };
        // Establish account ownership before touching the save. If the
        // process stops after this write, the same owner can safely retry.
        await deps.setReceipt(receiptKey, receipt);

        let grant: PlayRewardGrantResult;
        try {
            grant = await applyReward();
        } catch {
            throw new PlayRewardClaimError(503, 'The reward is verified; its delivery will retry when you reconnect.');
        }
        if (!grant.ok) throw new PlayRewardClaimError(grant.status ?? 503, grant.error ?? 'Reward delivery failed. Please retry.');

        receipt = {
            ...receipt,
            state: 'granted',
            grantedAt: receipt.grantedAt ?? now,
        };
        await deps.setReceipt(receiptKey, receipt);

        let acknowledged = product.kind === 'ryo' ? verified.consumed : verified.acknowledged;
        if (!acknowledged) {
            try {
                if (product.kind === 'ryo') await deps.consumePurchase(product.productId, args.purchaseToken);
                else await deps.acknowledgePurchase(product.productId, args.purchaseToken);
                acknowledged = true;
            } catch {
                // Keep the receipt retryable. The client rechecks unacknowledged
                // products on every foreground; delivery is already idempotent.
            }
        }
        if (acknowledged) {
            receipt = {
                ...receipt,
                state: product.kind === 'ryo' ? 'consumed' : 'acknowledged',
                acknowledgedAt: now,
            };
            await deps.setReceipt(receiptKey, receipt);
        }

        return {
            rewardLabel: product.label,
            ...resultFields(),
            granted: !grant.alreadyOwned,
            acknowledged,
            alreadyOwned: grant.alreadyOwned === true,
            ...(grant.character ? { character: grant.character } : {}),
            ...(Number.isFinite(grant.saveVersion) ? { saveVersion: grant.saveVersion } : {}),
        };
    });
}

export const PLAY_REWARD_PRODUCT_IDS = PLAY_GAMES_REWARD_PRODUCTS.map((product) => product.productId);
