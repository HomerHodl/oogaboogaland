// Milestone 8: facade-mounted architecture and conservatively masked ground dressing only.
(() => {
  "use strict";
  const BL=window.BL,S=BL.scene;
  const VENUES=[
    ["Meme Factory House",5.8,"MEME FACTORY","HOUSE","#3778a1"],
    ["DSB Studio Stage",4.4,"DSB STUDIO","STAGE","#367f87"],
    ["Maxis Club Theater",6,"MAXIS CLUB","THEATER","#73618c"],
    ["Without Rulers Shop",4.6,"WITHOUT RULERS","SHOP","#467d83"],
    ["Big Bitcoin",6.5,"BIG BITCOIN","COMPLIANCE IS DEFIANCE","#b53c39"],
    ["Stackchain Magazine",5,"STACKCHAIN","MAGAZINE","#416e94"],
    ["Proof Of Ink",4.5,"PROOF OF INK","","#354c67"]
  ];
  const distance=(line,x,z)=>{let best=Infinity;for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz)));best=Math.min(best,Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t));}return best;};
  const create=({root,land,nature})=>{
    const group=S.createNode({sightHidden:true}),placements=[],facades=[],glows=[],fields=new Map();S.addChild(root,group);
    const node=(parent,geometry,x,y,z,yaw=0,scale=1)=>{const n=S.createNode({geometry,position:{x,y,z},rotation:{x:0,y:yaw,z:0},scale:{x:scale,y:scale,z:scale},sightHidden:true});S.addChild(parent,n);return n;};
    const block=(parent,color,x,y,z,w,h,d,emissive=0)=>BL.dsbModels.block(parent,color,x,y,z,w,h,d,emissive);
    // Ground props never enter a road, door approach, clearing, return gate or Noderunner reserve.
    const allowed=(x,z,r)=>{
      if(!land.clearAt(x,z,r+.45)||land.heightAt(x,z)<.7)return false;
      if(distance(land.trail,x,z)<3.2+r||distance(land.waterfront,x,z)<3.8+r)return false;
      for(const lane of land.lanes)if(distance(lane,x,z)<2+r)return false;
      if(Math.hypot(x+45,z+48)<18+r||Math.hypot(x+13,z-5)<6+r||Math.hypot(x+10,z-7)<5+r||distance([[-13,5],[0,23]],x,z)<3+r)return false;
      if(x>-76-r&&x<-23+r&&z>29-r&&z<62+r)return false;
      for(const b of land.buildings){const dx=x-b.x,dz=z-b.z,c=Math.cos(b.yaw),s=Math.sin(b.yaw),lx=c*dx-s*dz,lz=s*dx+c*dz;if(Math.abs(lx)<2+r&&lz>b.d/2&&lz<b.d/2+5+r)return false;}
      for(const p of nature.placements)if(Math.hypot(x-p.x,z-p.z)<r+(p.kind==="olive"?2.5:p.kind==="cypress"?1:p.foot)+.3)return false;
      for(const p of placements)if(Math.hypot(x-p.x,z-p.z)<r+p.r+.4)return false;
      return true;
    };
    const ground=(kind,x,z,r=.7,yaw=0,scale=1,region="chora")=>{
      if(!allowed(x,z,r))return false;
      const geometry=["rock","grass","flowers","planter"].includes(kind)?BL.dressing.mediterranean(kind):BL.dressing.chora(kind),c=Math.cos(yaw),s=Math.sin(yaw);
      const conform=region==="coast"||region==="trail",centre=land.heightAt(x,z);
      const gx=conform?(land.heightAt(x+.3,z)-land.heightAt(x-.3,z))/.6:0,gz=conform?(land.heightAt(x,z+.3)-land.heightAt(x,z-.3))/.6:0;
      let low=Infinity,high=-Infinity;
      const v=geometry.verts;for(let i=0;i<v.length;i+=3)if(Math.abs(v[i+1])<.001){const dx=(c*v[i]+s*v[i+2])*scale,dz=(-s*v[i]+c*v[i+2])*scale,y=land.heightAt(x+dx,z+dz)-gx*dx-gz*dz;low=Math.min(low,y);high=Math.max(high,y);}
      if(!Number.isFinite(low)||high-low>.1||Math.hypot(gx,gz)>.8)return false;
      if(!fields.has(kind))fields.set(kind,{geometry,data:[]});
      fields.get(kind).data.push(c*scale,(gx*c-gz*s)*scale,-s*scale,0,0,scale,0,0,s*scale,(gx*s+gz*c)*scale,c*scale,0,x,low-.015,z,1,0,0,0,0);
      placements.push({kind,x,y:low-.015,z,r,low,high,gx,gz,centre,region});return true;
    };
    for(let index=0;index<land.buildings.length;index++){
      const b=land.buildings[index];if(b.name==="Noderunner waterfront")continue;
      const brand=VENUES.find(v=>v[0]===b.name),h=brand?brand[1]:b.name==="Harbor workshop"?4.5:b.name.startsWith("Harbor")?4:([4,4.6,4.8,4.4,4,5,4.5,5.5,4.5,5,4.5,5,5.5,4.5,4,5,4.5,4,4,4.5,4][index-7]??b.h);
      const g=S.createNode({position:{x:b.x,y:b.floor,z:b.z},rotation:{x:0,y:b.yaw,z:0},sightHidden:true});S.addChild(group,g);
      const blue=brand?brand[4]:index%3===0?"#507e99":"#346e9c",front=b.d/2;
      // Raised details remain above walking height; all low trim is flush with the existing shell.
      for(const x of [-b.w/2+.12,b.w/2-.12])block(g,"#f6f2e8",x,h+.23,0,.24,.46,b.d);
      for(const z of [-front+.12,front-.12])block(g,"#f6f2e8",0,h+.23,z,b.w,.46,.24);
      block(g,blue,0,h-.16,front+.045,b.w,.18,.08);
      for(const x of [-.69,.69])block(g,"#fbf8f1",x,1.18,front+.07,.18,2.36,.1);
      block(g,blue,0,2.35,front+.09,1.56,.18,.14);
      node(g,BL.dressing.chora("vent"),-b.w*.3,h,-b.d*.27);
      for(const side of [-1,1]){
        if(b.w>=5.5)node(g,BL.dressing.chora("window"),side*b.w*.32,1.75,front+.09,0,.72);
        node(g,BL.dressing.chora("window"),side*(b.w/2+.08),h*.6,0,side*Math.PI/2,.8);
      }
      if(!brand&&b.w>=5&&index%3===0){node(g,BL.dressing.chora("window"),0,h-.9,front+.09,0,.7);node(g,BL.dressing.chora("balcony"),0,h-1.65,front+.02);}
      if(index%5===0&&b.w>=5){
        const top=h+1.65;
        for(const x of [-b.w*.32,b.w*.32])for(const z of [-b.d*.28,b.d*.28])block(g,"#9c815e",x,h+.8,z,.1,1.6,.1);
        for(let j=0;j<6;j++)block(g,"#9c815e",(j-2.5)*b.w*.13,top,0,.12,.12,b.d*.65);
        for(const z of [-b.d*.28,b.d*.28])block(g,blue,0,top-.12,z,b.w*.72,.13,.12);
      }
      if(brand){
        const width=b.w-.45,scale=Math.min(.65,(width-.3)/(brand[2].length*.64));
        block(g,blue,0,h-1.05,front+.12,width,.95,.18);
        BL.dsbModels.sign(g,brand[2],0,h-1.25,front+.24,scale,"#fff4df");
        if(brand[3]){const s=Math.min(.35,(width-.25)/(brand[3].length*.64));BL.dsbModels.sign(g,brand[3],0,h-1.8,front+.21,s,"#fff4df");block(g,blue,0,h-1.67,front+.1,width,.38,.15);}
        const awningY=2.85;
        for(let i=0;i<7;i++)block(g,i%2?"#fbf8f1":blue,(i-3)*(b.w-.6)/7,awningY,front+.47,(b.w-.6)/7,.13,.85);
        for(const side of [-1,1]){
          block(g,"#425360",side*(b.w/2-.35),2.75,front+.16,.14,.52,.2);
          const lamp=block(g,"#ffe0a0",side*(b.w/2-.35),2.77,front+.28,.16,.28,.15,.6);glows.push(lamp);
        }
        if(index===1){for(let i=0;i<5;i++){const height=.25+(i%3)*.18;block(g,blue,(i-2)*.27,h+height/2,front-.7,.12,height,.12);}}
        if(index===2){for(const side of [-1,1])block(g,blue,side*(b.w/2-.18),h/2,front+.08,.23,h-.6,.13);}
        if(index===4){block(g,blue,0,h+.26,front-.12,3.2,.52,.25);BL.dsbModels.sign(g,"21M",0,h+.14,front+.04,.45,"#ffffff");}
        if(index===5)for(let i=0;i<3;i++)block(g,i%2?blue:"#e8dfc8",b.w*.34,1.35+i*.22,front+.2,.8,.12,.12);
        if(index===6){block(g,blue,-b.w*.32,1.65,front+.1,.45,1,.12);block(g,"#fbf8f1",-b.w*.32,1.65,front+.18,.08,.72,.05);}
        facades.push({name:b.name,sign:brand[2],x:b.x,z:b.z});
      }
      // Rear and side pockets only. Narrow alleys reject the complete furniture footprint.
      const c=Math.cos(b.yaw),s=Math.sin(b.yaw);
      for(const side of [-1,1]){
        const lx=side*(b.w/2+1.25),lz=-b.d*.2,x=b.x+c*lx+s*lz,z=b.z-s*lx+c*lz;
        ground(index%3===0?"bench":"planter",x,z,index%3===0?1.1:.65,b.yaw,1,b.x<0?"harbor":"chora");
      }
      const lx=0,lz=-b.d/2-2,x=b.x+c*lx+s*lz,z=b.z-s*lx+c*lz;
      if(index%4===0)ground("table",x,z,1.5,b.yaw);
    }
    // Search a few quiet pockets at a time, retaining wide circulation and existing planting.
    for(const [kind,cx,cz,region] of [["bench",26,28,"chora"],["bench",58,18,"chora"],["pot",35,38,"chora"],["crate",-46,21,"harbor"],["barrel",-36,20,"harbor"],["bench",-50,25,"harbor"]]){
      let placed=false;for(let ring=0;ring<4&&!placed;ring++)for(let j=0;j<12&&!placed;j++){const a=j*Math.PI/6;placed=ground(kind,cx+Math.cos(a)*ring,cz+Math.sin(a)*ring,kind==="bench"?1.1:.75,0,1,region);}
    }
    // Harbor equipment stays at the outer edge of the existing marine structures.
    for(const x of [-43,-34])for(const z of [45,51,57]){
      node(group,BL.dressing.chora("bollard"),x+.92,1.35,z);placements.push({kind:"bollard",x:x+.92,y:1.35,z,r:.25,low:1.35,high:1.35,region:"pier"});
    }
    for(const b of land.buildings.filter(b=>b.name.startsWith("Harbor"))){
      const c=Math.cos(b.yaw),s=Math.sin(b.yaw),x=b.x+s*(b.d/2+.06),z=b.z+c*(b.d/2+.06);
      node(group,BL.dressing.chora("net"),x+c*b.w*.3,b.floor+1.6,z-s*b.w*.3,b.yaw);
    }
    // Deterministic small shoreline accents; no new strip behind Olympus.
    const rand=BL.math.mulberry32(81037),coast=[...land.coast,land.coast[0]];
    // The protected routes and existing planting leave few eligible shore
    // pockets. Continue the same bounded sequence to fill those pockets.
    for(let i=0;i<6000;i++){
      const x=-83+rand()*165,z=-26+rand()*97,edge=distance(coast,x,z);
      if(edge<3||edge>9||land.heightAt(x,z)>4)continue;
      ground(i%4===0?"driftwood":i%3===0?"grass":"rock",x,z,.75,rand()*Math.PI*2,i%4===0?.8:.45,"coast");
      if(placements.filter(p=>p.region==="coast").length>=36)break;
    }
    for(let i=1;i<land.trail.length;i++){
      const a=land.trail[i-1],b=land.trail[i],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);
      for(const side of [-1,1])ground("marker",(a[0]+b[0])/2+side*dz/len*4,(a[1]+b[1])/2-side*dx/len*4,.4,0,.8,"trail");
    }
    // Each fixed field owns a renderer record; only the immutable shape arrays are shared with other layers.
    for(const f of fields.values())S.addChild(group,S.createNode({geometry:{...f.geometry},instanceData:new Float32Array(f.data),instanceCount:f.data.length/20,instanceVersion:0,fixedInstanceCapacity:true,sightHidden:true,cullSphere:new Float32Array([0,20,0,140])}));
    // Existing clearing sign was absent at this checkpoint; a wall-height marker stays off its approach.
    const p=land.marks.choraSign,signRoot=S.createNode({position:{x:p.x,y:p.y,z:p.z}});S.addChild(group,signRoot);
    block(signRoot,"#87745a",0,1,0,.12,2,.12);block(signRoot,"#fbf8f1",0,1.8,0,2.4,.6,.14);
    BL.dsbModels.sign(signRoot,"CHORA",-.2,1.65,.11,.42,"#326c99");
    block(signRoot,"#326c99",.86,1.83,.11,.4,.065,.06);
    for(const side of [-1,1]){const a=block(signRoot,"#326c99",.99,1.83+side*.08,.11,.22,.065,.06);a.rotation.z=side*Math.PI/4;}
    return {group,placements,facades,allowed,update:factor=>{for(const n of glows)n.glow=factor*.7;},dispose:()=>{S.removeChild(root,group);while(group.children.length)S.removeChild(group,group.children[group.children.length-1]);placements.length=facades.length=glows.length=0;}};
  };
  BL.dsbExterior={create};
})();
