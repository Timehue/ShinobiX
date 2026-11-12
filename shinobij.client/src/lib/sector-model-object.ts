/** Read one immutable file from the sector art host and verify the bytes before use. */
export async function readSectorModelObject(folder: string, name: string, suffix: string, limit: number) {
    const digest = name.slice(0,64);
    if (!/^[a-f0-9]{64}$/.test(digest) || name.slice(64) !== suffix) throw Error('Invalid sprite object');
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 12_000);
    try {
        const response = await fetch(folder+name, {credentials:'omit',signal:abort.signal});
        if (!response.ok || Number(response.headers.get('Content-Length')) > limit) throw Error('Sprite object unavailable');
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength > limit) throw Error('Oversized sprite object');
        const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
        if (Array.from(hash,b=>b.toString(16).padStart(2,'0')).join('') !== digest) throw Error('Sprite revision mismatch');
        return bytes;
    } finally { clearTimeout(timer); }
}
