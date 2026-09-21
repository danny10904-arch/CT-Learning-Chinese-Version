const fs=require('fs'),vm=require('vm'),zlib=require('zlib'),assert=require('assert'),path=require('path');
const SITE=path.resolve(__dirname,'../public');
class Element{
 constructor(tag='div'){this.tag=tag;this.children=[];this.value='';this.checked=true;this.classList={toggle(){}};this.style={};this.dataset={};this.context={createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:d=>{this.pixels=d.data},drawImage:source=>{this.pixels=source.pixels},fillRect(){},beginPath(){},moveTo(){},lineTo(){},arc(){},fill(){},stroke(){},setLineDash(){},fillText(){},measureText:t=>({width:t.length*22})};}
 append(...a){this.children.push(...a)}replaceChildren(){this.children=[]}addEventListener(){}getContext(){return this.context}getBoundingClientRect(){return {left:0,top:0,width:600,height:600}}
 querySelector(q){this.q??={};return this.q[q]??(this.q[q]=new Element(q))}
}
const els={};const get=id=>els[id]??(els[id]=new Element());get('mode').value='color';get('window').value='soft';
const ctx=vm.createContext({console,Uint8Array,Uint8ClampedArray,Int16Array,Map,Math,Number,Promise,Error,DecompressionStream,Response,window:{DecompressionStream},document:{getElementById:get,createElement:tag=>new Element(tag),createTextNode:t=>t,querySelectorAll:()=>[]},fetch:async url=>new Response(fs.readFileSync(path.join(SITE,url)))});
const run=s=>vm.runInContext(s,ctx);run(fs.readFileSync(path.join(SITE,'atlas.js'),'utf8'));
(async()=>{
 for(let i=0;i<100&&!run('ready');i++)await new Promise(r=>setTimeout(r,20));assert(run('ready'),'Initial CT load');
 for(const sid of ['s0327','s1456','s1438']){
  await run(`load('${sid}')`);assert(run('ready'));
  const m=JSON.parse(fs.readFileSync(path.join(SITE,`data/${sid}.json`))),vol=zlib.gunzipSync(fs.readFileSync(path.join(SITE,`data/${sid}-ct.gz`))),mask=zlib.gunzipSync(fs.readFileSync(path.join(SITE,`data/${sid}-seg.gz`)));assert.equal(vol.length,m.shape.reduce((a,b)=>a*b)*2);assert.equal(mask.length,vol.length/2);
  if(sid==='s1456'){const landmarks=JSON.parse(fs.readFileSync(path.join(SITE,'data/brain-landmarks.json')));assert(landmarks.length>=40,'Detailed brain landmark set');assert.equal(new Set(landmarks.map(o=>o.key)).size,landmarks.length,'Brain landmark keys must be unique')}
  for(const o of m.organs){const [x,y,z]=o.center;assert.equal(mask[x+m.shape[0]*(y+m.shape[1]*z)],o.id,'Centroid anchor must be inside named organ')}
  const hashes=[],sets=[];
  for(const fraction of [.2,.5,.8]){
   run(`active=0;pos[2]=Math.floor(meta.shape[2]*${fraction});render()`);
   const bytes=run('views[0].c.pixels');hashes.push(require('crypto').createHash('sha256').update(bytes).digest('hex'));sets.push(els.organs.children.map(b=>b.children[1]?.textContent||'').join(','));
  }
  assert.equal(new Set(hashes).size,3,'Different slice positions must show different CT pixels');
  if(sid==='s0327'||sid==='s1456')assert(new Set(sets).size>1,'Organ/landmark list must follow slice');
  for(let p=0;p<3;p++){
   run(`active=${p};views[${p}].slider.value=7;views[${p}].slider.oninput()`);const expected=p===2?7:m.shape[[2,1,0][p]]-1-7;assert.equal(run(`pos[axes[${p}]]`),expected);
   const xyz=run(`voxel(${p},0,0)`);assert(xyz.every((v,k)=>v>=0&&v<m.shape[k]));
  }
  console.log(sid, m.shape.join('×'),m.organs.length,'labels: slice pixels, organ lists, anchors and sliders passed');
 }
 await run("jump('head')");assert.equal(run('meta.id'),'s1456');await run("jump('legs')");assert.equal(run('meta.id'),'s1438');await run("jump('abdomen')");assert.equal(run('meta.id'),'s0327');assert(run('chosen>0'));
 console.log('Region navigation and asynchronous volume switching passed. These are data/interaction tests, not browser UI tests.');
})().catch(e=>{console.error(e);process.exitCode=1});
