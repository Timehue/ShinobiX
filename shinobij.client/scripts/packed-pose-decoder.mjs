import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';

/** Supply the worker's exact WASM bytes on demand, including on static hosts without content negotiation. */
export function packedPoseDecoder() {
    return {
        name: 'packed-pose-decoder',
        apply: 'build',
        enforce: 'pre',
        transform(source, id) {
            if (!id.replaceAll('\\', '/').endsWith('/@yume-chan/h264bsd/h264bsd.mjs')) return;
            const url = 'new URL("h264bsd.wasm",import.meta.url).href';
            const instantiate = 'wasmBinaryFile??=findWasmBinary();var result=await instantiateAsync(wasmBinary,wasmBinaryFile,info);';
            if (!source.includes(instantiate) || !source.includes(url)) this.error('Review the updated pose decoder loader');
            const bytes = readFileSync(join(dirname(id), 'h264bsd.wasm'));
            const packed = gzipSync(bytes, { level: 9 });
            const digest = createHash('sha256').update(packed).digest('hex').slice(0, 20);
            const filename = `sector-pose-${digest}.wasm.gz`;
            this.emitFile({ type: 'asset', fileName: 'assets/'+filename, source: packed });
            // Keep the factory's imports, memory and export bindings intact.
            const load = `var response=await fetch(new URL(${JSON.stringify(filename)},self.location.href));
                if(!response.ok)throw Error("Pose decoder unavailable");
                var wasmBinary=new Uint8Array(await response.arrayBuffer());
                if(wasmBinary[0]===31&&wasmBinary[1]===139){
                    wasmBinary=new Uint8Array(await new Response(new Blob([wasmBinary]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
                }
                var result=await WebAssembly.instantiate(wasmBinary,info);`;
            return { code: source.replace(url, '"h264bsd.wasm"').replace(instantiate, load), map: null };
        },
    };
}
