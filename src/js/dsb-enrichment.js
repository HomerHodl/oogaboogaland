// Additive exterior milestone. The approved heightfield, routes and systems stay authoritative.
(() => {
  "use strict";
  const BL=window.BL,S=BL.scene,M=BL.models;
  const BEACH_ROUTE=[[24,64],[29,67],[36,69]],RUIN_ROUTE=[[62,18],[69,19],[73,16],[74,8]];
  const distance=(line,x,z)=>{let d=Infinity;for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz)));d=Math.min(d,Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t));}return d;};
  const REVIEWS={
    "coastal-overview":{yaw:-.12,pitch:.66,dist:222,target:{x:-4,y:12,z:3}},
    "coastal-chora":{yaw:.55,pitch:.34,dist:31,target:{x:26,y:7,z:44}},
    "coastal-harbor":{yaw:.5,pitch:.4,dist:48,target:{x:-49,y:3,z:36}},
    "coastal-beach":{yaw:.25,pitch:.34,dist:40,target:{x:24,y:2,z:66}},
    "coastal-ruins":{yaw:.65,pitch:.36,dist:27,target:{x:75,y:5,z:8}},
    "coastal-trail":{yaw:-.25,pitch:.47,dist:48,target:{x:-18,y:7,z:9}}
  };
  const create=({root,land,nature,detail,renderer,camera})=>{
    const group=S.createNode({sightHidden:true}),placements=[],fields=[],batches=new Map(),glows=[],surfaces=[];
    S.addChild(root,group);
    const geometry=kind=>["olive","cypress","grass","flowers","rock","planter","shrub"].includes(kind)?BL.dressing.mediterranean(kind):["crate","barrel","table","bench","driftwood","net","window"].includes(kind)?BL.dressing.chora(kind):BL.dressing.coastal(kind);
    const add=(kind,x,y,z,yaw=0,sx=1,sy=sx,sz=sx,region="facade",gx=0,gz=0,priority=0)=>{
      if(!batches.has(kind))batches.set(kind,{kind,geometry:geometry(kind),list:[]});
      const p={kind,x,y,z,yaw,sx,sy,sz,gx,gz,region,priority};batches.get(kind).list.push(p);placements.push(p);return p;
    };
    const reserved=(x,z,r,harbor=false)=>{
      if(distance(land.trail,x,z)<2.9+r||distance(land.waterfront,x,z)<3.65+r)return true;
      for(const l of land.lanes)if(distance(l,x,z)<1.85+r)return true;
      if(distance(BEACH_ROUTE,x,z)<1.15+r||distance(RUIN_ROUTE,x,z)<1.2+r)return true;
      if(Math.hypot(x+45,z+48)<18+r||Math.hypot(x+13,z-5)<5.5+r||distance([[-13,5],[0,23]],x,z)<2.5+r||Math.hypot(x+10,z-7)<4+r)return true;
      // The entire functional Noderunner terrace and quay approach remain clear.
      if(!harbor&&x>-75-r&&x<-23+r&&z>29-r&&z<62+r)return true;
      if(harbor&&(Math.hypot(x+61,z-32)<11+r||distance([[-43,34],[-43,43]],x,z)<1.6+r||distance([[-34,34],[-34,43]],x,z)<1.6+r))return true;
      for(const b of land.buildings){const c=Math.cos(b.yaw),s=Math.sin(b.yaw),dx=x-b.x,dz=z-b.z,lx=c*dx-s*dz,lz=s*dx+c*dz;if(Math.abs(lx)<2+r&&lz>b.d/2&&lz<b.d/2+6+r)return true;}
      return false;
    };
    const ground=(kind,x,z,r=.5,yaw=0,scale=1,region="coast",priority=0)=>{
      const g=geometry(kind),h=land.heightAt(x,z);
      if(h<.45||!land.clearAt(x,z,r+.25)||reserved(x,z,r,region==="harbor"))return null;
      for(const p of nature.placements)if(["olive","cypress","rock"].includes(p.kind)&&Math.hypot(x-p.x,z-p.z)<r+(p.kind==="olive"?1.6:p.foot)+.2)return null;
      for(const p of detail.placements)if(!["grass","flowers"].includes(p.kind)&&Math.hypot(x-p.x,z-p.z)<r+p.r+.2)return null;
      for(const p of placements)if(p.r&&Math.hypot(x-p.x,z-p.z)<r+p.r+.18)return null;
      const rigid=["olive","cypress","column","broken","pergola","parasol","lantern","barrel","crate","netrack"].includes(kind);
      const gx=rigid?0:(land.heightAt(x+.3,z)-land.heightAt(x-.3,z))/.6,gz=rigid?0:(land.heightAt(x,z+.3)-land.heightAt(x,z-.3))/.6;
      if(Math.hypot(gx,gz)>.65)return null;
      let bottom=Infinity;for(let i=1;i<g.verts.length;i+=3)bottom=Math.min(bottom,g.verts[i]);
      let low=Infinity,high=-Infinity;const c=Math.cos(yaw),s=Math.sin(yaw),v=g.verts;
      for(let i=0;i<v.length;i+=3)if(Math.abs(v[i+1]-bottom)<.001){const dx=(c*v[i]+s*v[i+2])*scale,dz=(-s*v[i]+c*v[i+2])*scale,q=land.heightAt(x+dx,z+dz)-gx*dx-gz*dz;low=Math.min(low,q);high=Math.max(high,q);}
      if(high-low>(kind==="column"||kind==="broken"?.7:rigid?.28:.19)||low<.35)return null;
      const p=add(kind,x,low-bottom*scale-(kind==="coil"?.005:.025),z,yaw,scale,scale,scale,region,gx,gz,priority);Object.assign(p,{r,bottom,low,high});return p;
    };
    const lamp=(x,y,z,yaw=0,region="facade",scale=1)=>{add("lantern",x,y,z,yaw,scale,scale,scale,region);add("glass",x,y,z,yaw,scale,scale,scale,region);};
    const at=(b,lx,y,lz,kind,scale=1,turn=0)=>{const c=Math.cos(b.yaw),s=Math.sin(b.yaw);return add(kind,b.x+c*lx+s*lz,b.floor+y,b.z-s*lx+c*lz,b.yaw+turn,scale,scale,scale,"facade");};
    // Roof/side-mounted foliage and recessed warm windows leave door fronts and venue signs visible.
    const heights=[5.8,4.4,6,4.6,6.5,5,4.5,4,4.6,4.8,4.4,4,5,4.5,5.5,4.5,5,4.5,5,5.5,4.5,4,5,4.5,4,4,4.5,4];
    for(let i=0;i<land.buildings.length;i++){
      const b=land.buildings[i];if(b.name==="Noderunner waterfront")continue;
      const h=heights[i]||(b.name==="Harbor workshop"?4.5:4),front=b.d/2;
      for(const side of [-1,1]){
        at(b,side*(b.w/2+.2),h*.6,0,"windowglow",.8,side*Math.PI/2);
        at(b,side*(b.w/2+.12),h*.6-.73,0,"flowerbox",.85,side*Math.PI/2);
        at(b,side*(b.w/2-.2),h-.55,-front+.15,"flowerbox",.85);
        at(b,side*(b.w/2+.04),h-2.4,-front*.72,"vine",1.05,side*Math.PI/2);
      }
      for(const side of [-1,1]){
        at(b,side*b.w*.26,2.1,-front-.06,"window",.8,Math.PI);
        at(b,side*b.w*.26,1.5,-front-.1,"flowerbox",.85,Math.PI);
        at(b,side*b.w*.26,2.1,-front-.23,"windowglow",.72,Math.PI);
        const p=at(b,side*(b.w/2-.4),2.6,front+.28,"lantern",.7);add("glass",p.x,p.y,p.z,p.yaw,.7,.7,.7,"facade");
      }
      // Rooftop terraces are scenery, located inside existing building footprints.
      if(i%4===1&&b.w>=5&&b.d>=5){at(b,0,h+.06,-.2,"pergola",.9);at(b,0,h+.06,-.2,"shade",.9);at(b,0,h+.08,0,"table",.8);at(b,-1.3,h+.05,-1,"planter",1.1);}
      for(const side of [-1,1]){const p=at(b,side*(b.w/2-.3),h-.25,-front+.25,"lantern",.72);add("glass",p.x,p.y,p.z,p.yaw,.72,.72,.72,"facade");}
    }
    // Small town courtyards: search actual vacant pockets, never squeeze furniture into lanes.
    for(const [cx,cz] of [[7,36],[30,25],[57,17],[36,9],[12,7],[4,28],[48,15]]){
      for(let i=0;i<12;i++){const a=i*2.4,r=1+i*.38;ground(i===0?"olive":i%4===0?"bench":i%3===0?"agave":"planter",cx+Math.cos(a)*r,cz+Math.sin(a)*r,i===0?2.1:i%4===0?1.05:.52,a,i===0?.8:1,"chora");}
    }
    // Harbor side walls and pier edges; the original navigable deck width is retained.
    for(const b of land.buildings.filter(b=>b.name.startsWith("Harbor"))){
      for(const side of [-1,1]){at(b,side*(b.w/2+.04),1.45,0,"net",1,side*Math.PI/2);at(b,side*(b.w/2+.12),2.65,-.7,"lantern",.75,side*Math.PI/2);const p=at(b,side*(b.w/2+.12),2.65,-.7,"glass",.75,side*Math.PI/2);p.priority=0;}
      for(let j=0;j<10;j++){const a=j*2.4;ground(j%3===0?"netrack":j%2?"crate":"barrel",b.x+Math.cos(a)*(b.w/2+2),b.z+Math.sin(a)*(b.d/2+2),j%3===0?1:.65,a,.85,"harbor");}
    }
    for(const [cx,cz] of [[-58,48],[-53,44],[-49,37],[-28,35]]){
      for(let i=0;i<16;i++){const a=i*2.4,r=i*.22;ground(["crate","barrel","fishing","coil"][i%4],cx+Math.cos(a)*r,cz+Math.sin(a)*r,i%4===2?.65:.5,a,.75,"harbor");}
    }
    for(const x of [-43,-34])for(const z of [44.5,48.5,52.5,56.5])for(const side of [-1,1]){
      const px=x+side*1.05;add("ropepost",px,-.8,z,0,.85,2,.85,"pier");lamp(px,1.38,z,0,"pier",.65);
      add("fender",x+side*1.3,.1,z+.7,0,1,1,1,"pier");
      if(z<56)add("rope",px,1.35,z+2,Math.PI/2,4,1,1,"pier");
    }
    for(const [x,z] of [[-48.5,41.7],[-29.2,41.7]]){add("crate",x,1.35,z,0,.65,.65,.65,"quay");add("coil",x,2,z,0,.8,.8,.8,"quay");lamp(x,2.03,z+.25,0,"quay",.55);}
    for(const [x,z,yaw] of [[-46.4,51,.07],[-30.5,55,-.13],[-47,57,.08]]){add("boat",x,-.15,z,yaw,1,1,1,"marine");add("coil",x,-.15+.62,z-.5,yaw,.8,.8,.8,"marine");}
    // A real visible beach material follows the existing triangles exactly: no terrain/collision edits.
    const base=land.root.children[0].geometry,sand={verts:[],faces:[],lines:[],castShadow:false};
    for(const face of base.faces){
      let x=0,z=0,h=0;for(const index of face.i){x+=base.verts[index*3]/3;h+=base.verts[index*3+1]/3;z+=base.verts[index*3+2]/3;}
      if(x<-3||x>53||z<61||z>77||h<-.8||h>4.5||((x-26)/30)**2+((z-70)/12)**2>1||distance(land.waterfront,x,z)<3.15||!land.clearAt(x,z,0))continue;
      const color=h<.65?[186,165,117]:h<1.4?[220,199,149]:[239,217,171],ids=[];
      for(const index of face.i){ids.push(sand.verts.length/3);sand.verts.push(base.verts[index*3],base.verts[index*3+1]+.016,base.verts[index*3+2]);}
      sand.faces.push({i:ids,color});
    }
    const sandNode=S.createNode({geometry:sand,sightHidden:true});sandNode.depthBias=-.06;S.addChild(group,sandNode);surfaces.push(sand);
    // Keep a broad walking spine from the waterfront to the wet sand.
    // A level canopy on individually terrain-seated posts, without raising the walking surface.
    for(const [cx,cz] of [[1,65],[47,69]]){
      for(let i=0;i<90;i++){
        const a=i*2.4,r=i*.12,x=cx+Math.cos(a)*r,z=cz+Math.sin(a)*r;
        if(reserved(x,z,2.7)||!land.clearAt(x,z,3)||land.heightAt(x,z)<1)continue;
        if(placements.some(p=>p.r&&Math.hypot(x-p.x,z-p.z)<p.r+2.8))continue;
        if(nature.placements.some(p=>["olive","cypress","rock"].includes(p.kind)&&Math.hypot(x-p.x,z-p.z)<3+p.foot))continue;
        const feet=[];for(const dx of [-2,2])for(const dz of [-1.5,1.5])feet.push([x+dx,z+dz,land.heightAt(x+dx,z+dz)]);
        if(feet.some(p=>p[2]<.5))continue;const y=Math.max(...feet.map(p=>p[2]));
        const roof=add("pergolaroof",x,y,z,0,1,1,1,"beach");roof.r=2.7;
        add("shade",x,y,z,0,1,1,1,"beach");
        for(const [px,pz,h] of feet){const base=Math.min(...[-.085,.085].flatMap(dx=>[-.085,.085].map(dz=>land.heightAt(px+dx,pz+dz))));const q=add("post",px,base-.025,pz,0,1,y+3-base,1,"beach");Object.assign(q,{bottom:0,low:base,high:h,footing:true});}
        lamp(x-2,y+2,z+1.5,0,"beach",.7);
        add("table",x,land.heightAt(x,z)-.15,z,0,1,1,1,"beach",(land.heightAt(x+.3,z)-land.heightAt(x-.3,z))/.6,(land.heightAt(x,z+.3)-land.heightAt(x,z-.3))/.6);
        break;
      }
    }
    for(const [cx,cz] of [[6,69],[13,72],[23,72],[39,68],[49,72]]){
      let p=null;for(let i=0;i<24&&!p;i++){const a=i*2.4,r=i*.11;p=ground("parasol",cx+Math.cos(a)*r,cz+Math.sin(a)*r,1.55,0,1,"beach");}
      if(!p)continue;
      for(const side of [-1,1])for(let i=0;i<8;i++){const a=side*.7+i*.32;if(ground("lounger",p.x+Math.sin(a)*3.15,p.z+Math.cos(a)*3.15,.95,-.1,1,"beach"))break;}
      ground("barrel",p.x,p.z+1.95,.3,0,.5,"beach");
    }
    for(let i=0;i<26;i++){const x=3+i*1.8,z=66+Math.sin(i*.7)*2.2;ground(i%4===0?"driftwood":i%3===0?"agave":"herbs",x,z,i%4===0?.75:.48,i*.7,i%4===0?.8:1,"beach",i%3===0?0:1);}
    // An intimate ruin overlook on the existing eastern shelf, with an open central approach.
    const columns=[];
    for(const [kind,cx,cz] of [["column",77,2],["column",80,2],["column",79,8],["broken",70,8],["broken",71,13],["broken",79,14]]){
      let p=null;for(let i=0;i<32&&!p;i++){const a=i*2.4,r=i*.095;p=ground(kind,cx+Math.cos(a)*r,cz+Math.sin(a)*r,.8,0,1,"ruins");}
      if(p){columns.push(p);lamp(p.x+.3,p.y,p.z+.3,0,"ruins",.65);}
    }
    if(columns[0]?.kind==="column"&&columns[1]?.kind==="column"){
      const a=columns[0],b=columns[1],d=Math.hypot(a.x-b.x,a.z-b.z),yaw=Math.atan2(a.z-b.z,b.x-a.x);
      for(const [p,side] of [[a,1],[b,-1]])add("lintel",p.x+side*(b.x-a.x)/d*.45,p.y+4.3,p.z+side*(b.z-a.z)/d*.45,yaw,2.1,1,1,"ruins");
    }
    for(let i=0;i<35;i++){const a=i*2.4,x=75+Math.cos(a)*(3+i%4),z=8+Math.sin(a)*(4+i%3);ground(i%5===0?"wall":i%3===0?"fragment":i%2?"herbs":"agave",x,z,i%5===0?.95:.55,a,i%5===0?.8:.85,"ruins",i%3===0?0:1);}
    // Coast framing stops well before rear Olympus; exposed summit and clearing are retained.
    const coast=[...land.coast,land.coast[0]],rand=BL.math.mulberry32(104037);
    for(let i=0;i<1800;i++){
      const x=-84+rand()*169,z=-23+rand()*98,h=land.heightAt(x,z),edge=distance(coast,x,z);
      if(edge<2||edge>8||h>7||x>-3&&x<53&&z>61)continue;
      ground(i%7===0?"rock":i%3===0?"agave":i%2?"grass":"herbs",x,z,i%7===0?1.1:.45,rand()*6.28,i%7===0?.85:.8+rand()*.35,"coast",i%7===0?0:1);
    }
    for(let i=1;i<land.trail.length;i++){
      const a=land.trail[i-1],b=land.trail[i],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);
      for(let j=0;j<7;j++)for(const side of [-1,1]){const t=(j+.5)/7,x=a[0]+dx*t+side*dz/len*(4.6+j%2),z=a[1]+dz*t-side*dx/len*(4.6+j%2);ground(j%3===0?"wall":j%4===0?"cypress":"herbs",x,z,j%3===0?.95:j%4===0?.8:.5,Math.atan2(-dz,dx),j%4===0?.75:.8,"trail",j%3===0?0:1);}
    }
    // Flush stone insets add path texture without changing any support height or route.
    for(const line of [land.waterfront,...land.lanes,RUIN_ROUTE])for(let i=1;i<line.length;i++){
      const a=line[i-1],b=line[i],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz),count=Math.floor(len/1.6);
      for(let j=0;j<count;j++)for(const side of [-1,1]){
        const t=(j+.5)/count,x=a[0]+dx*t+side*dz/len*.68,z=a[1]+dz*t-side*dx/len*.68,h=land.heightAt(x,z);
        if(h<.5||!land.clearAt(x,z,.5))continue;const gx=(land.heightAt(x+.3,z)-land.heightAt(x-.3,z))/.6,gz=(land.heightAt(x,z+.3)-land.heightAt(x,z-.3))/.6;
        if(Math.hypot(gx,gz)>.6)continue;
        add("paving",x,h+.02,z,Math.atan2(-dz,dx),1,1,1,"path",gx,gz,1);
      }
    }
    // Three modest wayfinding boards, all offset from the named circulation lines.
    for(const [text,cx,cz] of [["APOLLO'S COVE",34,67],["AEGEAN RUINS",69,16],["HARBOR",-20,35]]){
      let spot=null;for(let i=0;i<30&&!spot;i++){const a=i*2.4,r=i*.15,x=cx+Math.cos(a)*r,z=cz+Math.sin(a)*r;if(land.clearAt(x,z,1.9)&&!reserved(x,z,1.7,text==="HARBOR")&&!placements.some(p=>p.r&&Math.hypot(x-p.x,z-p.z)<p.r+1.8))spot={x,z};}
      if(!spot)continue;const {x,z}=spot,y=Math.min(land.heightAt(x-.06,z),land.heightAt(x+.06,z),land.heightAt(x,z-.06),land.heightAt(x,z+.06))-.025,g=S.createNode({position:{x,y,z},sightHidden:true});S.addChild(group,g);
      placements.push({kind:"wayfinding",x,y,z,r:1.7,region:"wayfinding"});
      BL.dsbModels.block(g,"#94704a",0,.8,0,.12,1.6,.12);BL.dsbModels.block(g,"#eadcc0",0,1.5,0,3.2,.65,.14);BL.dsbModels.sign(g,text,0,1.34,.09,Math.min(.32,2.8/(text.length*.64)),"#376e9a");
    }
    // Bounded contact foam follows the mean-water contour extracted from the approved mesh.
    // Opaque, discontinuous ribbons: no textures, render targets, transparency or ocean rewrite.
    const foamGeo=M.box({w:1,h:.008,d:1,color:"#c8e1d9"});foamGeo.castShadow=false;
    const foam=[];
    for(const f of base.faces){const pts=[];for(let j=0;j<3;j++){const a=f.i[j]*3,b=f.i[(j+1)%3]*3,ay=base.verts[a+1]+.34,by=base.verts[b+1]+.34;if(ay*by<0){const t=ay/(ay-by);pts.push([base.verts[a]+t*(base.verts[b]-base.verts[a]),base.verts[a+2]+t*(base.verts[b+2]-base.verts[a+2])]);}}
      if(pts.length!==2)continue;const x=(pts[0][0]+pts[1][0])/2,z=(pts[0][1]+pts[1][1])/2;if(z<-23||x<-79)continue;
      const dx=pts[1][0]-pts[0][0],dz=pts[1][1]-pts[0][1],len=Math.hypot(dx,dz);if(len<.25)continue;
      foam.push({x,y:-.282,z,yaw:Math.atan2(-dz,dx),sx:len*.76,sy:1,sz:.07+(foam.length%3)*.025,gx:0,gz:0,priority:foam.length%3?1:0,region:"foam"});
    }
    const foamSubset=foam.filter((p,i)=>i%Math.max(1,Math.ceil(foam.length/220))===0);
    const shoreCount=foamSubset.length;
    for(let i=5;i<shoreCount;i+=9){const p=foamSubset[i];if(p.x>-5&&p.x<55&&p.z>58||p.x>-76&&p.x<-23&&p.z>29)continue;
      // Deep roots seat these shoreline stacks in the unchanged seabed; no floating boulders.
      add("rock",p.x,-5,p.z, i*.7,1.5,7,1.5,"outcrop");
      for(let j=0;j<8;j++){const a=j*Math.PI/4,x=p.x+Math.cos(a)*1.75,z=p.z+Math.sin(a)*1.75;if(land.heightAt(x,z)<-.4)foamSubset.push({x,y:-.278,z,yaw:-a+Math.PI/2,sx:.55,sy:1,sz:.1,gx:0,gz:0,priority:1,region:"foam"});}
      if(i>120)break;
    }
    batches.set("foam",{kind:"foam",geometry:foamGeo,list:foamSubset});
    const matrix=(p,a,o)=>{const c=Math.cos(p.yaw),s=Math.sin(p.yaw);a[o]=c*p.sx;a[o+1]=(p.gx*c-p.gz*s)*p.sx;a[o+2]=-s*p.sx;a[o+5]=p.sy;a[o+8]=s*p.sz;a[o+9]=(p.gx*s+p.gz*c)*p.sz;a[o+10]=c*p.sz;a[o+12]=p.x;a[o+13]=p.y;a[o+14]=p.z;a[o+15]=1;};
    for(const f of batches.values()){
      const source=new Float32Array(f.list.length*20);f.list.forEach((p,i)=>matrix(p,source,i*20));
      const node=S.createNode({geometry:f.geometry,instanceData:new Float32Array(source.length),instanceCount:0,instanceVersion:0,fixedInstanceCapacity:true,sightHidden:true,cullSphere:new Float32Array([0,20,0,145])});S.addChild(group,node);
      fields.push({...f,node,source,lowGeometry:f.kind==="flowerbox"||f.kind==="vine"?BL.dressing.coastal(f.kind+"-low"):f.geometry});if(f.kind==="glass"||f.kind==="windowglow")glows.push(node);
    }
    const stats={total:placements.length,visible:0,batches:fields.length+surfaces.length,tier:"",foam:foamSubset.length,sandFaces:sand.faces.length,lights:0};
    let lastX=Infinity,lastZ=Infinity,lastY=Infinity,lastWash=-1,lastGlow=-1,disposed=false;
    const update=(time,lampFactor)=>{
      if(disposed)return;
      const tier=renderer.kind==="canvas2d"?"low":renderer.quality,p=camera.position,changed=stats.tier!==tier||Math.hypot(p.x-lastX,p.z-lastZ,p.y-lastY)>4;
      if(changed){stats.tier=tier;lastX=p.x;lastZ=p.z;lastY=p.y;stats.visible=0;
        for(const f of fields){f.node.geometry=tier==="low"?f.lowGeometry:f.geometry;let n=0;const a=f.node.instanceData,range=f.kind==="grass"||f.kind==="herbs"?tier==="low"?45:85:300;
          for(let i=0;i<f.list.length;i++){const q=f.list[i];if(q.priority&&(tier==="low"?i%4!==0:tier==="medium"&&i%2!==0))continue;if(p.y<65&&Math.hypot(q.x-p.x,q.z-p.z)>range)continue;for(let j=0;j<20;j++)a[n*20+j]=f.source[i*20+j];n++;}
          f.node.instanceCount=n;f.node.instanceVersion++;stats.visible+=n;
        }
      }
      const glow=Math.round(lampFactor*72)/100;
      if(changed||glow!==lastGlow){lastGlow=glow;for(const n of glows){n.glow=glow;for(let i=0;i<n.instanceCount;i++)n.instanceData[i*20+16]=glow;n.instanceVersion++;}}
      const wash=Math.floor(time*6);if(tier!=="low"&&wash!==lastWash){lastWash=wash;const f=fields[fields.length-1],a=f.node.instanceData,width=.65+.35*Math.sin(time*1.2);for(let i=0;i<f.node.instanceCount;i++){const o=i*20,len=Math.hypot(a[o],a[o+2]),w=.065+width*.1;a[o+8]=-a[o+2]/len*w;a[o+10]=a[o]/len*w;}f.node.instanceVersion++;}
    };
    // As the nature layer's: a ground piece standing where a later layer needs room moves to free ground close by.
    const rehome=(blocked,free)=>{
      const rng=BL.math.mulberry32(104039),count=placements.length;let moved=0;
      for(let i=0;i<count;i++){
        const old=placements[i];if(!old.r||old.bottom===undefined||!blocked(old.x,old.z,old.r))continue;
        const f=fields.find(f=>f.kind===old.kind),j=f.list.indexOf(old);
        for(let n=0;n<160;n++){
          const a=rng()*Math.PI*2,d=old.r+2+n*.15+rng()*2,x=old.x+Math.cos(a)*d,z=old.z+Math.sin(a)*d;
          if(blocked(x,z,old.r)||!free(x,z,old.r))continue;
          const p=ground(old.kind,x,z,old.r,old.yaw,old.sx,old.region,old.priority);if(!p)continue;
          placements.pop();f.list.pop();Object.assign(old,p);matrix(old,f.source,j*20);moved++;break;
        }
      }
      lastX=Infinity;return moved;
    };
    const dispose=()=>{if(disposed)return;disposed=true;S.removeChild(root,group);while(group.children.length)S.removeChild(group,group.children[group.children.length-1]);placements.length=fields.length=glows.length=surfaces.length=0;batches.clear();stats.total=stats.visible=0;};
    return {group,placements,fields,surfaces,stats,reserved,rehome,update,dispose,beachRoute:BEACH_ROUTE,ruinRoute:RUIN_ROUTE};
  };
  BL.dsbEnrichment={create,REVIEWS};
})();
