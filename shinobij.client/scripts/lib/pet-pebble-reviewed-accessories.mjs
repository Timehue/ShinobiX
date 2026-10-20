import{createHash}from'node:crypto';

// The new tortoise has a real shell and fitted cloth around its continuous
// anatomical skin. These exact accessory components were inspected in all
// eight views and both animation passes. This never exempts skull/body skin.
export const PEBBLE_REVIEWED_ACCESSORIES=[
 {role:'pebble shell hull',triangles:2160,vertices:1219,bone:'spine',bounds:[[-.480001,-.885001,-.570001],[.480001,.265001,.000001]]},
 {role:'indigo headband',triangles:1920,vertices:1453,bone:'head',bounds:[[-.541017,.507774,-.321674],[.541017,.704774,.603504]]},
 {role:'pebble shell rim',triangles:1548,vertices:1216,bone:'spine',bounds:[[-.492001,-.897001,-.346001],[.492001,.276983,-.297998]]},
 {role:'lower headband seam',triangles:1548,vertices:1241,bone:'head',bounds:[[-.549348,.510966,-.330418],[.549348,.586167,.611014]]},
 {role:'upper headband seam',triangles:1548,vertices:1244,bone:'head',bounds:[[-.464521,.628024,-.272055],[.464521,.703207,.519228]]},
];
export function reviewedPebbleAccessory(glb,primitive,id,component,reader){
 if(id!=='starter-earth'||createHash('sha256').update(glb.file).digest('hex')!=='e3c992fa17abf531f99572620499560295a9a99b3d4518eee180f13a0b69890b')return false;
 const recipe=glb.json.extras?.pebbleFullRemake;
 if(recipe?.revision!=='20261019-full-sculpt-reviewed-v9'||!recipe.geometryEntirelyNew||!recipe.uvAtlasEntirelyNew)return false;
 const match=PEBBLE_REVIEWED_ACCESSORIES.find(a=>a.triangles===component.triangles&&a.vertices===component.vertices.size);if(!match)return false;
 const joint=glb.json.skins[0].joints.findIndex(n=>glb.json.nodes[n].name===match.bone),p=reader(glb,primitive.attributes.POSITION),uv=reader(glb,primitive.attributes.TEXCOORD_0),w=reader(glb,primitive.attributes.WEIGHTS_0),j=reader(glb,primitive.attributes.JOINTS_0),uniqueUV=new Set(),uniquePositions=new Set();
 for(const v of component.vertices){for(let k=0;k<3;k++)if(p.value(v,k)<match.bounds[0][k]-2e-6||p.value(v,k)>match.bounds[1][k]+2e-6)return false;let share=0;for(let k=0;k<4;k++)if(j.value(v,k)===joint)share+=w.value(v,k);if(share<.999999)return false;uniqueUV.add(uv.value(v,0)+','+uv.value(v,1));uniquePositions.add([0,1,2].map(k=>p.value(v,k)).join(','));}
 return uniqueUV.size>100&&uniquePositions.size>100?match.role:false;
}
