import sharp from 'sharp';
for (const file of process.argv.slice(2)) {
    const image=sharp(file), meta=await image.metadata();
    const {data,info}=await image.ensureAlpha().raw().toBuffer({resolveWithObject:true});
    let transparent=0, opaque=0, whiteOpaque=0;
    for(let i=0;i<data.length;i+=4){
        if(data[i+3]===0)transparent++;
        if(data[i+3]===255)opaque++;
        if(data[i+3]>240&&Math.min(data[i],data[i+1],data[i+2])>240)whiteOpaque++;
    }
    console.log(JSON.stringify({file,hasAlpha:meta.hasAlpha,width:info.width,height:info.height,transparent,opaque,whiteOpaque,corners:[3,(info.width-1)*4+3,(info.width*(info.height-1))*4+3,data.length-1].map(i=>data[i])}));
}
