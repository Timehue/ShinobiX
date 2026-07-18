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
    if (buffer.byteLength < 20) return null;
    const view = new DataView(buffer);
    if (view.getUint32(0, true) !== GLB_MAGIC) return null;
    const declaredLength = view.getUint32(8, true);
    if (declaredLength > buffer.byteLength) return null;

    let json: GlbJson | null = null;
    let binOffset = -1;
    let binLength = 0;
    let offset = 12;
    while (offset + 8 <= declaredLength) {
        const chunkLength = view.getUint32(offset, true);
        const chunkType = view.getUint32(offset + 4, true);
        const dataOffset = offset + 8;
        if (dataOffset + chunkLength > declaredLength) return null;
        if (chunkType === GLB_JSON_CHUNK) {
            const raw = new TextDecoder().decode(new Uint8Array(buffer, dataOffset, chunkLength)).replace(/\0+$/u, "").trimEnd();
            json = JSON.parse(raw) as GlbJson;
        } else if (chunkType === GLB_BIN_CHUNK && binOffset < 0) {
            binOffset = dataOffset;
            binLength = chunkLength;
        }
        offset = dataOffset + chunkLength;
    }

    const image = json?.images?.find((candidate) => Number.isInteger(candidate.bufferView));
    if (!image || image.bufferView === undefined || binOffset < 0) return null;
    const bufferView = json?.bufferViews?.[image.bufferView];
    if (!bufferView || (bufferView.buffer ?? 0) !== 0 || !bufferView.byteLength) return null;
    const imageOffset = bufferView.byteOffset ?? 0;
    if (imageOffset < 0 || imageOffset + bufferView.byteLength > binLength) return null;

    return {
        bytes: new Uint8Array(buffer, binOffset + imageOffset, bufferView.byteLength).slice(),
        mimeType: image.mimeType ?? "image/png",
    };
}

type AtlasResource = {
    status: "pending" | "ready" | "error";
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
    if (!response.ok) throw new Error(`Pet atlas fetch failed (${response.status}) for ${url}`);
    const payload = extractEmbeddedPetAtlas(await response.arrayBuffer());
    if (!payload) throw new Error(`No embedded colour atlas was found in ${url}`);
    const image = await decodeStableImage(payload);
    const texture = new THREE.Texture(image);
    texture.name = `${url.split("/").at(-1) ?? "pet"}-persistent-colour-atlas`;
    texture.flipY = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = true;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.userData.petPersistentAtlas = true;
    texture.needsUpdate = true;
    return texture;
}

function atlasResource(url: string): AtlasResource {
    const existing = atlasResources.get(url);
    if (existing) return existing;
    const resource: AtlasResource = { status: "pending", texture: null, promise: Promise.resolve(null) };
    resource.promise = loadEmbeddedAtlas(url).then((texture) => {
        resource.texture = texture;
        resource.status = "ready";
        return texture;
    }).catch((error: unknown) => {
        resource.status = "error";
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
    if (resource.status === "pending") throw resource.promise;
    return resource.texture;
}

