/** Play Console one-time products and their server-owned rewards. */
export const PLAY_REWARD_ANDROID_PACKAGE = 'com.shinobijourney.app';

export const PLAY_GAMES_REWARD_PRODUCTS = [
    { productId: 'sj_reward_title_dawn', kind: 'title', title: 'Dawn-Sealed Shinobi', label: 'Dawn-Sealed Shinobi' },
    { productId: 'sj_reward_title_ember', kind: 'title', title: 'Emberbound Shinobi', label: 'Emberbound Shinobi' },
    { productId: 'sj_reward_ryo_cache_small', kind: 'ryo', amount: 100, label: '100 Ryo Cache' },
] as const;

export const PLAY_GAMES_REWARD_TITLES = PLAY_GAMES_REWARD_PRODUCTS
    .filter((product) => product.kind === 'title')
    .map((product) => product.title);

export type PlayGamesRewardProduct = typeof PLAY_GAMES_REWARD_PRODUCTS[number];

export function playGamesRewardProduct(productId: unknown): PlayGamesRewardProduct | null {
    if (typeof productId !== 'string') return null;
    return PLAY_GAMES_REWARD_PRODUCTS.find((product) => product.productId === productId) ?? null;
}
