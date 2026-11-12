import initialize, { type Picture } from '@yume-chan/h264bsd';

const moduleReady = initialize();

function accessUnits(bytes: Uint8Array) {
    const starts: number[] = [];
    for (let i = 0; i < bytes.length-4; i++) {
        if (bytes[i] || bytes[i+1]) continue;
        const prefix = bytes[i+2] === 1 ? 3 : !bytes[i+2] && bytes[i+3] === 1 ? 4 : 0;
        if (prefix) {
            if ((bytes[i+prefix] & 31) === 9) starts.push(i);
            i += prefix-1;
        }
    }
    if (starts[0] !== 0) throw Error('Missing access unit');
    return starts.map((start,i) => bytes.subarray(start,starts[i+1] ?? bytes.length));
}

function paint(picture: Picture, pixels: Uint8ClampedArray, width: number, cols: number, w: number, h: number) {
    const {picWidth:stride,picHeight:height,cropParams} = picture.info;
    const left = cropParams.cropLeftOffset, top = cropParams.cropTopOffset;
    const matteRow = 2*Math.ceil(h/2);
    if (picture.nbrOfErrMBs || left+w > stride || top+matteRow+h > height) throw Error('Invalid pose plane');
    const bytes = picture.bytes, plane = stride*height;
    const x0 = picture.picId%cols*w, y0 = Math.floor(picture.picId/cols)*h;
    for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
        const sx=x+left, sy=y+top, uv=(sy>>1)*(stride>>1)+(sx>>1);
        const matte = Math.round(1.16438356*(bytes[(sy+matteRow)*stride+sx]-16));
        const alpha = matte<5 ? 0 : matte>250 ? 255 : matte;
        if (!alpha) continue;
        const i=((y0+y)*width+x0+x)*4;
        const u=bytes[plane+uv]-128, v=bytes[plane+plane/4+uv]-128;
        const luma=1.16438356*(bytes[sy*stride+sx]-16), scale=255/alpha;
        pixels[i]=Math.round(luma+1.596027*v)*scale;
        pixels[i+1]=Math.round(luma-.391762*u-.812968*v)*scale;
        pixels[i+2]=Math.round(luma+2.017232*u)*scale;
        pixels[i+3]=alpha;
    }
}

self.onmessage = async event => {
    // Dedicated-worker messages can have an empty origin.
    if (event.origin && event.origin !== self.location.origin) return;
    try {
        const {cols,frames,cell:[w,h],bytes,encodePng} = event.data;
        const width = cols*w, height = Math.ceil(frames/cols)*h;
        if (![w,h,cols,frames].every(n=>Number.isSafeInteger(n)&&n>0) || width*height*4>12*1024**2)
            throw Error('Invalid atlas dimensions');
        const units = accessUnits(new Uint8Array(bytes));
        if (units.length !== frames) throw Error('Unexpected frame count');
        const pixels = new Uint8ClampedArray(width*height*4);
        const decoder = new (await moduleReady).Decoder();
        let next = 0;
        function collect(picture: Picture | undefined) {
            if (!picture || picture.picId !== next++) throw Error('Unexpected pose order');
            paint(picture,pixels,width,cols,w,h);
        }
        try {
            for (let i=0;i<units.length;i++) {
                let unit=units[i];
                while(unit.length) {
                    const result = decoder.decode(unit,i);
                    if (result.code>=3 || !result.read) throw Error('Invalid pose packet');
                    if (result.picture) collect(result.picture);
                    for(let n=0;n<result.extraPictureCount;n++) collect(decoder.getNextPicture());
                    unit=unit.subarray(result.read);
                }
            }
            const tail = decoder.flush();
            if (tail.picture) collect(tail.picture);
            for(let n=0;n<tail.extraPictureCount;n++) collect(decoder.getNextPicture());
            if (next !== frames) throw Error('Incomplete atlas');
        } finally { decoder.delete(); }
        if (encodePng && typeof OffscreenCanvas !== 'undefined') {
            try {
                const canvas = new OffscreenCanvas(width,height);
                const context = canvas.getContext('2d');
                if (context) {
                    context.putImageData(new ImageData(pixels,width,height),0,0);
                    const blob = await canvas.convertToBlob({type:'image/png'});
                    canvas.width=canvas.height=0;
                    self.postMessage({blob});
                    return;
                }
            } catch {
                // Keep the pixel path for browsers that cannot encode an offscreen canvas.
            }
        }
        self.postMessage({pixels,width,height},{transfer:[pixels.buffer]});
    } catch (error) { self.postMessage({error:String(error)}); }
};
