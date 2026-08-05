import {
    dispatchPostHogEvent,
    type PostHogDispatchConfig,
    type ProductEvent,
} from '../../../../shared/product-analytics';

export function dispatchClientPostHogEvent(
    config: PostHogDispatchConfig,
    event: ProductEvent,
    fetcher: typeof fetch = fetch,
): Promise<boolean> {
    return dispatchPostHogEvent(config, event, fetcher);
}
