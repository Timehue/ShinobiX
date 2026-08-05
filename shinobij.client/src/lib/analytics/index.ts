import type { ProductEventName } from '../../../../shared/product-analytics';

const ENABLED = import.meta.env.VITE_PRODUCT_ANALYTICS_ENABLED === '1'
    && import.meta.env.VITE_PRODUCT_ANALYTICS_PROVIDER?.toLowerCase() === 'posthog'
    && Boolean(import.meta.env.VITE_POSTHOG_KEY && import.meta.env.VITE_POSTHOG_HOST);

let runtime: Promise<typeof import('./runtime')> | undefined;

/** Disabled builds retain only this small no-op; validation and transport stay lazy. */
export function captureProductEvent(name: ProductEventName, properties: Record<string, unknown> = {}): boolean {
    if (!ENABLED) return false;
    runtime ??= import('./runtime');
    void runtime.then((module) => module.captureConfiguredProductEvent(name, properties)).catch(() => undefined);
    return true;
}
