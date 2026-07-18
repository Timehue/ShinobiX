import * as THREE from "three";

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;

type GlbJson = {
    images?: Array<{ bufferView?: number; mimeType?: string }>;
    bufferViews?: Array<{ buffer?: number; byteOffset?: number; byteLength?: number }>;
};

export type EmbeddedPetAtlas = {
    bytes: Uint8Array;
    mimeType: string;
};

/** Extract the first embedded image without depending on GLTFLoader's decoded
 * Texture/ImageBitmap lifetime. Approved roster GLBs contain one baked colour
 * atlas in a BIN buffer view. */
export function extractEmbeddedPetAtlas(buffer: ArrayBuffer): EmbeddedPetAtlas | null {
    if (buffer.byteLength < 28) return null;
    const view = new DataView(buffer);
    if (view.getUint32(0, true) !== GLB_MAGIC) return null;
    const declaredLength = view.getUint32(8, true);
    if (declaredLength > buffer.byteLength) return null;

    const jsonLength = view.getUint32(12, true);
    const binHeader = 20 + jsonLength;
    if (view.getUint32(16, true) !== GLB_JSON_CHUNK || binHeader + 8 > declaredLength) return null;
    const binLength = view.getUint32(binHeader, true);
    const binOffset = binHeader + 8;
    if (view.getUint32(binHeader + 4, true) !== GLB_BIN_CHUNK || binOffset + binLength > declaredLength) return null;
    const json = JSON.parse(
        new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)).replace(/\0+$/u, "").trimEnd(),
    ) as GlbJson;
    const image = json.images?.find((candidate) => Number.isInteger(candidate.bufferView));
    if (image?.bufferView === undefined) return null;
    const bufferView = json.bufferViews?.[image.bufferView];
    if (!bufferView || (bufferView.buffer ?? 0) !== 0 || !bufferView.byteLength) return null;
    const imageOffset = bufferView.byteOffset ?? 0;
    if (imageOffset < 0 || imageOffset + bufferView.byteLength > binLength) return null;

    return {
        bytes: new Uint8Array(buffer, binOffset + imageOffset, bufferView.byteLength).slice(),
        mimeType: image.mimeType ?? "image/png",
    };
}

type AtlasResource = {
    ready: boolean;
    promise: Promise<THREE.Texture | null>;
    texture: THREE.Texture | null;
};

const atlasResources = new Map<string, AtlasResource>();

function decodeStableImage(payload: EmbeddedPetAtlas): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const bytes = payload.bytes.slice().buffer as ArrayBuffer;
        const objectUrl = URL.createObjectURL(new Blob([bytes], { type: payload.mimeType }));
        const image = new Image();
        image.decoding = "async";
        image.onload = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(image);
        };
        image.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error("The embedded pet colour atlas could not be decoded."));
        };
        image.src = objectUrl;
    });
}

async function loadEmbeddedAtlas(url: string): Promise<THREE.Texture | null> {
    const response = await fetch(url, { cache: "force-cache", credentials: "same-origin" });
    if (!response.ok) throw new Error(`Pet atlas HTTP ${response.status}`);
    const payload = extractEmbeddedPetAtlas(await response.arrayBuffer());
    if (!payload) throw new Error("Missing embedded pet atlas");
    const texture = new THREE.Texture(await decodeStableImage(payload));
    texture.flipY = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
}

function atlasResource(url: string): AtlasResource {
    const existing = atlasResources.get(url);
    if (existing) return existing;
    const resource: AtlasResource = { ready: false, texture: null, promise: null! };
    resource.promise = loadEmbeddedAtlas(url).then((texture) => {
        resource.texture = texture;
        resource.ready = true;
        return texture;
    }, (error: unknown) => {
        resource.ready = true;
        console.error("[PetColiseum] Persistent colour atlas failed", error);
        return null;
    });
    atlasResources.set(url, resource);
    return resource;
}

/** Start colour-atlas decoding on the selection screen, before a Canvas exists. */
export function preloadPetGlbAtlas(url: string): Promise<THREE.Texture | null> {
    return atlasResource(url).promise;
}

/** Suspense reader used by the fight. A failed extraction falls back to the GLTF
 * material rather than preventing the battle from rendering. */
export function readPetGlbAtlas(url: string): THREE.Texture | null {
    const resource = atlasResource(url);
    if (!resource.ready) throw resource.promise;
    return resource.texture;
}

