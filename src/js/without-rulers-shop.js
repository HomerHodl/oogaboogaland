// Without Rulers: entry statement, five collection bays, central kiosk, retail islands and print gallery.
(() => {
  "use strict";
  const BL=window.BL,S=BL.scene,{block,sign}=BL.dsbModels,panels=new Map();
  const surface=(parent,color,x,y,z,w,h)=>{if(!panels.has(color))panels.set(color,BL.models.panel({tilesX:12,tilesY:8,color}));const n=S.createNode({geometry:panels.get(color),position:{x,y,z},scale:{x:w,y:h,z:1}});S.addChild(parent,n);return n;};
  const build=()=>{
    const root=S.createNode({visible:false}),solids=[],seats=[],counts={shirts:0,hoodies:0,caps:0,folded:0,prints:0,mannequins:0};
    const group=(x=0,y=0,z=0,yaw=0)=>{const g=S.createNode({position:{x,y,z},rotation:{x:0,y:yaw,z:0}});S.addChild(root,g);return g;};
    const prop=(kind,x,y,z,tone="ink",parent=root,yaw=0)=>{const n=S.createNode({geometry:BL.dressing.withoutRulers(kind,tone),position:{x,y,z},rotation:{x:0,y:yaw,z:0}});S.addChild(parent,n);return n;};
    const solid=(x,z,w,d)=>solids.push([x-w/2,x+w/2,z-d/2,z+d/2]);
    const label=(parent,text,x,y,z,size=.3,color="#e2d7bf")=>{const n=sign(parent,text,x,y,z,size,color);n.depthBias=-.15;return n;};
    const rug=(x,z,w,d)=>{
      const mat=surface(root,"#242526",x,.042,z,w,d);mat.rotation.x=-Math.PI/2;mat.depthBias=-.06;
      for(const s of [-1,1]){block(root,"#bb793d",x+s*(w/2-.12),.048,z,.07,.018,d-.12);block(root,"#bb793d",x,.048,z+s*(d/2-.12),w-.12,.018,.07);}
      for(let xx=-w/2+.35;xx<w/2-.2;xx+=.4)for(const s of [-1,1]){const n=block(root,"#875736",x+xx,.052,z+s*(d/2-.34),.13,.016,.13);n.rotation.y=Math.PI/4;}
    };
    const picture=(parent,kind,x,y,z,w=1.75,h=2.45)=>{
      block(parent,"#755b40",x,y,z,w,h,.12);block(parent,"#d1b888",x,y,z+.07,w-.12,h-.12,.035);block(parent,kind==="samourai"?"#b9692f":"#242729",x,y,z+.096,w-.21,h-.21,.025);
      prop("art-"+kind,x,y-.1,z+.13,"ink",parent);counts.prints++;
    };
    // Tiled shell provides the same readable architecture on WebGL and the Canvas fallback.
    for(let x=-11.25;x<12;x+=1.5)for(let z=-10.25;z<11;z+=1.5)block(root,(Math.round((x+z)*2)%4)?"#686059":"#71685f",x,-.09,z,1.48,.18,1.48).depthBias=.9;
    for(let x=-10.5;x<12;x+=3)for(let z=-9.625;z<11;z+=2.75)block(root,"#171a1c",x,6.48,z,3,.18,2.75);
    for(const x of [-12,12])for(let z=-9.625;z<11;z+=2.75)for(const y of [1.6,4.8])block(root,"#282a2b",x,y,z,.3,3.2,2.75).depthBias=.8;
    for(let x=-10.5;x<12;x+=3)for(const y of [1.6,4.8])block(root,"#242729",x,y,-11,3,3.2,.3).depthBias=.8;
    for(const x of [-7.1,7.1])block(root,"#252728",x,3.2,11,9.8,6.4,.3);
    block(root,"#292d2d",0,5.15,11,4.4,2.5,.3);
    for(const x of [-11.78,11.78]){block(root,"#5d4736",x,.45,0,.12,.9,22);block(root,"#b67c41",x,.95,0,.13,.06,22);}
    for(const z of [-10.8,10.8])block(root,"#5d4736",0,.3,z,24,.55,.12);
    // Timber columns, overhead tracks, shelf strips and pendant lanterns: only three real lights.
    for(const x of [-11.55,11.55])for(const z of [-10,-5,0,5,10]){block(root,"#5c4938",x,3.15,z,.26,6.3,.26);prop("lantern",x,4.35,z);}
    for(const z of [-9,-4,1,6]){
      block(root,"#5a4432",0,6.15,z,24,.25,.26);
      for(const x of [-8,-4,0,4,8]){block(root,"#252a2b",x,5.96,z,.42,.16,.42);block(root,"#ffcf90",x,5.86,z,.23,.035,.23,.85);}
    }
    for(const x of [-6.3,6.3])for(const z of [-4.7,3]){block(root,"#323635",x,5.24,z,.035,1.65,.035);prop("lantern",x,3.9,z);}
    for(const x of [-8.8,8.8])block(root,"#363c3c",x,6.13,0,.12,.12,21.5);
    // Low upper display ledge repeats the concept's layered wall treatment without inaccessible gameplay.
    for(const x of [-11.25,11.25]){block(root,"#654c35",x,4.83,0,.8,.12,20);for(const z of [-8,-2,4,9]){prop("planter",x,4.9,z);block(root,"#292d2e",x,5.2,z+1,.44,.56,.4);}}
    const exitDoor=block(root,"#3b4040",0,1.45,10.78,2.7,2.9,.16);
    block(root,"#e89139",1,1.27,10.66,.045,.47,.05);label(root,"CHORA",0,3.25,10.59,.42).rotation.y=Math.PI;
    rug(0,9,4.4,2.2);const welcome=label(root,"A FREER TOMORROW",0,.069,9.25,.32);welcome.rotation.x=-Math.PI/2;
    // Rear brand wall and display desk. This counter is a showroom fixture, never a checkout station.
    surface(root,"#111618",0,4.42,-10.67,10.3,2.5);label(root,"WITHOUT RULERS",0,4.8,-10.65,.75);
    label(root,"ART  APPAREL  IDEAS",0,4.23,-10.64,.32,"#df9b50");block(root,"#ef8829",4.65,5.02,-10.57,.45,.45,.07,.25);
    block(root,"#292b2b",0,.51,-8.9,5.4,1.02,1.3);block(root,"#977352",0,1.08,-8.9,5.6,.12,1.45);block(root,"#efaa5c",0,.14,-8.22,5.1,.05,.035,.65);
    label(root,"WITHOUT RULERS",0,.6,-8.23,.44);prop("books",1.6,1.15,-8.8);prop("cap",-1.7,1.15,-8.8);prop("planter",2.1,1.15,-9);
    solid(0,-8.9,5.6,1.45);
    // Collection bays keep merchandise below arm reach and posters high above the garments.
    const bay=(x,z,yaw,kind,title)=>{
      const g=group(x,0,z,yaw);surface(g,"#383a38",0,2.52,.08,3.8,5.05);
      picture(g,kind,0,3.73,.13,3.28,2.26);label(g,title,0,4.53,.28,title.length>15?.27:.33);
      for(const xx of [-1.83,1.83]){block(g,"#77593c",xx,2.48,.23,.11,4.96,.35);block(g,"#ffd191",xx,3.6,.43,.035,1.7,.025,.8);}
      block(g,"#ab8158",0,2.57,.3,3.65,.13,.69);block(g,"#ffc577",0,2.47,.61,3.48,.04,.045,.7);
      block(g,"#555652",0,2.13,.49,3.35,.05,.05);
      for(let i=0;i<4;i++){const hoodie=i===1||i===3;prop(hoodie?"hoodie":"shirt",-1.2+i*.8,1.15,.48,i%3===1?"bone":i===3?"orange":"ink",g);counts[hoodie?"hoodies":"shirts"]++;}
      for(const y of [.25,.86])block(g,"#876344",0,y,.29,3.66,.1,.86);
      for(let i=0;i<5;i++){prop("cap",-1.4+i*.7,.93,.4,i%3===0?"bone":"ink",g);counts.caps++;}
      for(const xx of [-1.15,0,1.15]){prop("folded",xx,.31,.25,xx===0?"bone":"ink",g);counts.folded++;}
      if(yaw===0)solid(x,z+.35,3.85,.95);else solid(x+Math.sin(yaw)*.35,z,.95,3.85);
    };
    bay(-11.62,-7.8,Math.PI/2,"bip85","BIP-85");bay(-11.62,-2.5,Math.PI/2,"samourai","FREE SAMOURAI");
    bay(-7.25,-10.66,0,"slavery","BITCOIN OR SLAVERY");bay(7.25,-10.66,0,"cartel","BANKING CARTEL");bay(11.62,-6.8,-Math.PI/2,"2140","2140");
    // Two clean retail islands with wood decks, black steel feet, folded stock and small cap risers.
    for(const x of [-5.3,5.3]){
      rug(x,-.6,4.5,4.25);block(root,"#8b6646",x,1.02,-.6,3.4,.15,2.3);
      for(const xx of [-1.49,1.49])for(const z of [-1.55,.35])block(root,"#303536",x+xx,.48,z,.14,.95,.14);
      block(root,"#705038",x,.24,-.6,3.4,.12,2.2);block(root,"#1a2021",x,.64,.57,3.05,.67,.07);
      label(root,x<0?"IDEAS LOOK GOOD":"A FREER TOMORROW",x,.59,.64,.29);
      for(let i=0;i<4;i++)for(let j=0;j<2;j++){prop("folded",x-1.16+i*.78,1.11,-1.12+j*.82,(i+j)%3===0?"bone":"ink");counts.folded++;}
      for(let i=0;i<4;i++){prop("folded",x-1.12+i*.75,.31,-.45,i%2?"bone":"ink");counts.folded++;}
      block(root,"#705038",x,1.62,-1.15,3.1,.1,.55);for(let i=0;i<4;i++){prop("cap",x-1.05+i*.7,1.68,-1.14,i===1?"orange":"ink");counts.caps++;}
      solid(x,-.6,3.4,2.3);
    }
    // Large freestanding kiosk is the room's focal point, with readable catalog-style cards.
    rug(0,3.65,5.3,4.3);block(root,"#5c4937",0,.22,2.6,4.7,.44,1.05);block(root,"#ef983c",0,.43,3.14,4.2,.055,.06,.8);
    const kiosk=group(0,1.63,2.8);kiosk.rotation.x=-.12;
    block(kiosk,"#262b2d",0,0,-.09,4.55,2.66,.12).depthBias=.6;
    const screen=surface(kiosk,"#111a20",0,0,.13,4.55,2.66);
    for(const x of [-2.38,2.38])block(kiosk,"#6a675f",x,0,0,.14,2.96,.24);for(const y of [-1.42,1.42])block(kiosk,"#6a675f",0,y,0,4.9,.14,.24);
    label(kiosk,"WITHOUT RULERS",0,.91,.16,.36);label(kiosk,"BROWSE THE COLLECTION",0,.56,.16,.2,"#dfb171");
    for(let i=0;i<4;i++){
      const x=-1.65+i*1.1;block(kiosk,i===0?"#ad642b":"#303639",x,-.01,.16,.93,.68,.026,.15);
      if(i<3){const p=prop(i===0?"shirt":i===1?"hoodie":"cap",x,-.19,.21,"bone",kiosk);p.scale.x=p.scale.y=p.scale.z=.43;}
      else{const p=prop("art-2140",x,-.09,.21,"ink",kiosk);p.scale.x=p.scale.y=p.scale.z=.32;}
      label(kiosk,["SHIRTS","HOODIES","HATS","ART"][i],x,-.51,.2,.17);
    }
    label(kiosk,"EXPLORE HERE  BUY ON OFFICIAL SITE",0,-.92,.17,.16);label(kiosk,"NO CUSTOMER INFO STORED HERE",0,-1.18,.17,.145,"#dfb171");
    solid(0,2.8,4.9,1.2);
    // Hat cabinet and L-shaped print gallery, as in the first and fourth references.
    const hats=group(11.45,0,-.85,-Math.PI/2);block(hats,"#232829",0,1.5,0,3.9,3,.15);label(hats,"HATS",0,3.18,.12,.42);
    for(const y of [.42,1.1,1.78,2.46]){block(hats,"#97704b",0,y,.3,3.9,.08,.7);block(hats,"#ffc37b",0,y-.05,.63,3.8,.025,.035,.65);for(let i=0;i<5;i++){prop("cap",-1.4+i*.7,y+.045,.31,i%3===0?"bone":"ink",hats);counts.caps++;}}
    solid(11.1,-.85,1,3.9);
    const gallery=group(11.45,0,6,-Math.PI/2);surface(gallery,"#353632",0,2.5,.08,6.8,5);label(gallery,"ART PRINTS",0,4.65,.12,.48);
    for(let i=0;i<3;i++)for(let j=0;j<2;j++){const p=group();S.removeChild(root,p);S.addChild(gallery,p);p.position.x=-2.25+i*2.25;p.position.y=1.5+j*1.65;p.position.z=.15;picture(p,["bip85","samourai","slavery","cartel","2140","slavery"][i+j*3],0,0,0,1.76,1.43);for(const child of p.children)if(child.geometry===BL.dressing.withoutRulers("art-"+["bip85","samourai","slavery","cartel","2140","slavery"][i+j*3]))child.scale.x=child.scale.y=.62;}
    block(gallery,"#8c6849",0,.55,.53,6.6,.12,1.05);solid(10.9,6,1.25,6.8);
    for(let i=0;i<5;i++){const rack=group(9.9,0,3.65+i*1.05,-Math.PI/2);block(rack,"#563f2c",0,.19,0,.8,.38,.72);picture(rack,["bip85","samourai","slavery","cartel","2140"][i],0,.92,0,.73,.99);for(const c of rack.children.slice(1))if(c.geometry)c.scale.x*=.46,c.scale.y*=.46;}
    solid(9.9,5.8,.8,5.3);
    // Minimal lounge, two seats using the crew's existing sit/stand contract.
    rug(-7.4,6.85,6,5.1);
    for(const x of [-8.7,-7.15]){prop("chair",x,0,7.3);seats.push({x,y:.51,z:7.3,ry:Math.PI,viewYaw:0,floor:0,walkAt:{x,z:5.62},sitter:null,allowWeapons:true,lockMovement:true});solid(x,7.3,1.48,1.05);}
    block(root,"#8c694c",-7.95,.51,4.0,2.25,.13,1.05);for(const x of [-8.82,-7.08])block(root,"#282e30",x,.24,4,.12,.48,.85);prop("books",-8.4,.58,4);prop("lantern",-7.25,.58,4);solid(-7.95,4,2.25,1.05);
    const lounge=group(-11.62,0,6.5,Math.PI/2);surface(lounge,"#202526",0,3.1,.06,3.6,2.8);label(lounge,"FREEDOM",0,3.6,.13,.42);label(lounge,"LOOKS GOOD",0,3.08,.13,.35);label(lounge,"ON YOU",0,2.55,.13,.42,"#e59747");
    // Entry mannequins and display plinths frame a wide clear route to both sides of the kiosk.
    for(const [x,z,tone] of [[-3.6,8.1,"ink"],[5.6,7.8,"bone"]]){block(root,"#785b40",x,.13,z,1.4,.26,1.2);prop("mannequin",x,.26,z,tone);counts.mannequins++;solid(x,z,1.4,1.2);}
    for(const [x,z] of [[-10.25,9.25],[-5.4,7.55],[7.7,9.25],[-9.8,-5.25],[9.75,-4],[3.65,-9.45],[-3.65,-9.45]]){prop("planter",x,0,z);solid(x,z,.7,.7);}
    for(const [x,z] of [[-9.7,-8.8],[9.7,-8.8],[-10.1,1.1],[10,9.7]]){prop("lantern",x,0,z);solid(x,z,.33,.33);}
    const lights=new Float32Array([0,5,-3,15,1,.74,.46,0,-7,4,4,9,.9,.62,.34,0,8,4,5,10,1,.72,.43,0]);
    const lighting={clear:[.035,.037,.04],sky:[.45,.42,.36],ground:[.3,.27,.23],direct:[.8,.7,.52],directStrength:.38,ambientFloor:.36,sun:{x:.3,y:.9,z:.2},shadowCenter:{x:0,y:2,z:0},shadowExtent:17,shadowStrength:.26,bloomStrength:.25,fog:[.035,.037,.04],fogNear:45,fogFar:80,lights,lightCount:3};
    return {id:"without-rulers",root,exitDoor,lighting,solids,seats,counts,screen,kiosk,mediaAt:{x:0,y:0,z:4.6},groundAt:()=>0,ceiling:6.4,bounds:{minX:-11.6,maxX:11.6,minZ:-10.6,maxZ:10.5},spawn:{x:0,y:0,z:8.9},spawnYaw:0,followDistance:3,exit:{x:0,y:0,z:9.25},
      browseGoals:[{x:0,z:4.6},{x:-5.3,z:1.75},{x:5.3,z:1.75},{x:8.35,z:6},{x:0,z:-6.8},{x:-9.45,z:-2.5},{x:9.2,z:-6.8},...seats.map(s=>s.walkAt)],
      reviews:{"rulers-hero":{position:{x:0,y:0,z:8.9},yaw:0,pitch:.16,dist:3},"rulers-floor":{position:{x:-2.4,y:0,z:-3.6},yaw:.6,pitch:.12,dist:3},"rulers-art":{position:{x:7.7,y:0,z:6},yaw:-Math.PI/2,pitch:.11,dist:3},"rulers-kiosk":{position:{x:0,y:0,z:4.65},yaw:0,pitch:.1,dist:3},"rulers-lounge":{position:{x:-4.5,y:0,z:6.5},yaw:1.5,pitch:.16,dist:3}},
      tomatoContact:(x,y,z)=>y<.1||Math.abs(x)>11.7||z<-10.7||z>10.7,
      clampCamera:p=>{p.y=Math.max(.75,Math.min(6.05,p.y));}
    };
  };
  BL.withoutRulersShop={build};
})();
