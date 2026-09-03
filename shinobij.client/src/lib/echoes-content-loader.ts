import { ECHOES_CONTENT_URL } from "../generated/story-content/manifest";
import { ECHOES_CONTENT_KEY, type EchoesContentKey, type EchoesContentPayload } from "./story-content-contract";
import { createContentLoader, createContentResource, validateEchoesContentPayload } from "./story-content-loader-core";

const loader = createContentLoader<EchoesContentKey, EchoesContentPayload>({
    urlFor: () => ECHOES_CONTENT_URL,
    fetchContent: (url, init) => fetch(url, init),
    validate: (parsed) => validateEchoesContentPayload(parsed),
    staleMessage: "This Echoes of War script belongs to an older game release.",
});

const resource = createContentResource<EchoesContentKey, EchoesContentPayload>({ load: loader.load, refresh: loader.refresh });

export function loadEchoesContent(): Promise<EchoesContentPayload> {
    return loader.load(ECHOES_CONTENT_KEY);
}

/** Suspense read for the EchoesOfWar screen: throws the pending promise on the
 * first render, then serves the validated payload synchronously. */
export function readEchoesContent(): EchoesContentPayload {
    return resource.read(ECHOES_CONTENT_KEY);
}

/** Explicit user retry: clear both layers and refetch past the HTTP cache. */
export function resetEchoesContent(): void {
    resource.reset(ECHOES_CONTENT_KEY);
}
