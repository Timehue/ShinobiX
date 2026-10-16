/** Play Console one-time products and their server-owned rewards. */
export const PLAY_REWARD_ANDROID_PACKAGE = 'com.shinobijourney.app';

export const PLAY_GAMES_REWARD_PRODUCTS = [
    { productId: 'sj_reward_title_dawn', kind: 'title', title: 'Dawn-Sealed Shinobi', label: 'Dawn-Sealed Shinobi' },
    { productId: 'sj_reward_title_ember', kind: 'title', title: 'Emberbound Shinobi', label: 'Emberbound Shinobi' },
    { productId: 'sj_reward_ryo_cache_small', kind: 'ryo', amount: 100, label: '100 Ryo Cache' },
    // Play pre-registration reward. Google delivers it as a free purchase of
    // this one-time product on first install, so it is acknowledged (kept),
    // never consumed, and each purchase token opens the box once.
    {
        productId: 'sj_prereg_first_shinobi_box',
        kind: 'bundle',
        label: '1st Shinobi Reward Box',
        contents: { ryo: 10_000, fateShards: 50, boneCharms: 10, supporterDays: 14 },
    },
] as const;

export const PLAY_GAMES_REWARD_TITLES = PLAY_GAMES_REWARD_PRODUCTS
    .filter((product) => product.kind === 'title')
    .map((product) => product.title);

export type PlayGamesRewardProduct = typeof PLAY_GAMES_REWARD_PRODUCTS[number];
export type PlayGamesRewardBundle = Extract<PlayGamesRewardProduct, { kind: 'bundle' }>['contents'];

export function playGamesRewardProduct(productId: unknown): PlayGamesRewardProduct | null {
    if (typeof productId !== 'string') return null;
    return PLAY_GAMES_REWARD_PRODUCTS.find((product) => product.productId === productId) ?? null;
}
