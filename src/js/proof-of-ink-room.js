// Concept plan: gallery left, retail center, open print production right; shared DSB room contract.
(() => {
  "use strict";
  const BL=window.BL,S=BL.scene,{block,sign}=BL.dsbModels,panels=new Map();
  const surface=(parent,color,x,y,z,w,h)=>{if(!panels.has(color))panels.set(color,BL.models.panel({tilesX:12,tilesY:8,color}));const n=S.createNode({geometry:panels.get(color),position:{x,y,z},scale:{x:w,y:h,z:1}});S.addChild(parent,n);return n;};
  const build=()=>{
    const root=S.createNode({visible:false}),solids=[],seats=[],counts={apparel:0,folded:0,caps:0,art:0,ink:0,presses:0,dryers:0};
    const group=(x=0,y=0,z=0,yaw=0)=>{const n=S.createNode({position:{x,y,z},rotation:{x:0,y:yaw,z:0}});S.addChild(root,n);return n;};
    const prop=(kind,x,y,z,tone="ink",parent=root,yaw=0)=>{const n=S.createNode({geometry:BL.dressing.proofOfInk(kind,tone),position:{x,y,z},rotation:{x:0,y:yaw,z:0}});S.addChild(parent,n);return n;};
    const solid=(x,z,w,d)=>solids.push([x-w/2,x+w/2,z-d/2,z+d/2]);
    const label=(p,text,x,y,z,size=.3,color="#e4d5bb")=>{const n=sign(p,text,x,y,z,size,color);n.depthBias=-.17;return n;};
    const picture=(p,id,x,y,z,w=1.6,h=2)=>{
      for(const side of [-1,1]){block(p,"#9e8560",x+side*(w/2+.05),y,z+.04,.1,h+.2,.12);block(p,"#9e8560",x,y+side*(h/2+.05),z+.04,w,.1,.12);}
      const n=S.createNode({geometry:BL.proofOfInkArt(id),position:{x,y,z:z+.09},scale:{x:w,y:h,z:1}});n.depthBias=-.3;S.addChild(p,n);counts.art++;return n;
    };
    const rug=(x,z,w,d)=>{const n=surface(root,"#282925",x,.035,z,w,d);n.rotation.x=-Math.PI/2;n.depthBias=-.08;for(const s of [-1,1]){block(root,"#947248",x+s*(w/2-.13),.047,z,.085,.018,d);block(root,"#947248",x,.047,z+s*(d/2-.13),w,.018,.085);}for(let k=0;k<w/.35;k++)for(const s of [-1,1])block(root,"#544d3b",x-w/2+.2+k*.35,.052,z+s*(d/2-.33),.15,.016,.1);};
    // Concrete tile shell, exposed timber joists and black steel tracks.
    for(let x=-13.3;x<14;x+=1.4)for(let z=-12.3;z<13;z+=1.4)block(root,Math.round(x*10+z*10)%3?"#70685d":"#7a7164",x,-.085,z,1.38,.17,1.38).depthBias=.9;
    for(let x=-12.25;x<14;x+=3.5)for(let z=-11.375;z<13;z+=3.25)block(root,"#302b27",x,6.07,z,3.5,.15,3.25);
    for(const x of [-14,14])for(let z=-11.375;z<13;z+=3.25)for(const y of [1.5,4.5])block(root,"#303332",x,y,z,.3,3,3.25).depthBias=.8;
    for(let x=-12.25;x<14;x+=3.5)for(const y of [1.5,4.5])block(root,"#2b2e2e",x,y,-13,3.5,3,.3).depthBias=.8;
    for(const x of [-8.1,8.1])block(root,"#353634",x,3,13,11.8,6,.3);
    block(root,"#303332",0,4.75,13,4.4,2.5,.3);
    for(const z of [-12,-7,-2,3,8,12]){
      block(root,"#705238",0,5.85,z,28,.25,.27);
      for(const x of [-13.6,-6.7,6.5,13.6]){if(x===6.5&&z===-2)continue;block(root,"#5e5d56",x,2.87,z,.27,5.75,.32);if(Math.abs(x)<10&&Math.abs(z)<11)solid(x,z,.28,.33);}
      for(const x of [-10,-3,3,10]){block(root,"#24292a",x,5.57,z,.42,.2,.42);block(root,"#ffd798",x,5.45,z,.24,.035,.24,.9);}
    }
    for(const x of [-10,-3,3,10])block(root,"#242a2b",x,5.65,0,.09,.1,25.5);
    for(const z of [-9,-4,1,6])for(const x of [-6.7,6.5]){block(root,"#292f2f",x,4.98,z,.035,1.3,.035);prop("lamp",x,4.2,z);}
    for(const x of [-13.65,13.65]){block(root,"#735438",x,.5,0,.12,1,25.6);block(root,"#a28152",x,1.04,0,.14,.06,25.6);}
    // Entry hero: nib insignia, reception counter and a clear axial view to the back wall.
    const exitDoor=block(root,"#3c4140",0,1.42,12.8,2.7,2.84,.15);block(root,"#d5a058",1,1.25,12.7,.045,.43,.04);
    label(root,"CHORA",0,3.08,12.62,.4).rotation.y=Math.PI;
    rug(0,10.5,4,2.5);const welcome=label(root,"ART  BITCOIN  COMMUNITY",0,.073,10.7,.22);welcome.rotation.x=-Math.PI/2;
    surface(root,"#191e21",0,4.55,-12.67,11,2.15);label(root,"PROOF OF INK",.5,4.7,-12.55,.88);label(root,"SUPPORT BITCOIN ARTISTS",.5,4.12,-12.54,.3,"#e6a35d");prop("nib",-4.45,4.65,-12.5);
    block(root,"#5b4533",0,.51,-10.85,4.7,1.02,1.28);block(root,"#aa8156",0,1.1,-10.85,4.9,.15,1.4);label(root,"PROOF OF INK",0,.57,-10.18,.43);block(root,"#e9ae62",0,.13,-10.18,4.4,.045,.025,.7);
    prop("books",-1.35,1.19,-10.7);prop("pins",0,1.18,-10.7);prop("lamp",1.6,1.18,-10.8);solid(0,-10.85,4.9,1.4);
    for(let i=0;i<5;i++){picture(root,["4109","1580","4987","1478","8060"][i],-4+i*2,2.67,-12.57,1.35,1.72);}
    // Central retail islands. Stock is merged per stack and instanced, not one mesh per folded garment.
    for(const x of [-3.55,2.75])for(const z of [-4.4,2.1]){
      prop("table",x,0,z);solid(x,z,2.5,1.35);rug(x,z,3.45,2.65);
      for(const xx of [-.8,0,.8])for(const zz of [-.35,.35]){prop("folded",x+xx,1.11,z+zz,xx===0?"bone":"ink");counts.folded++;}
      for(const xx of [-.8,0,.8]){prop("box",x+xx,.32,z);prop("cap",x+xx,1.52,z-.25,xx===0?"orange":"ink");counts.caps++;}
      label(root,x<0?"APPAREL":"PRINTS AND MERCH",x,.77,z+.7,.24);
    }
    rug(0,5.4,2.5,3.4);const mark=prop("nib",0,.07,5.3);mark.rotation.x=-Math.PI/2;mark.scale.x=mark.scale.y=1.3;
    // Wall racks: shirts, hoodies, caps and book / pin / sticker shelves.
    const bay=(x,z,yaw,title)=>{
      const g=group(x,0,z,yaw);surface(g,"#373b38",0,2.5,0,4.5,4.8);label(g,title,0,4.62,.12,.35);
      for(const xx of [-2.18,2.18])block(g,"#4c4439",xx,2.4,.2,.1,4.65,.5);
      for(const y of [.28,1,2.64,3.5]){block(g,"#906b48",0,y,.35,4.45,.1,.78);block(g,"#ffd397",0,y-.07,.7,4.15,.025,.025,.65);}
      block(g,"#717470",0,2.4,.5,4.2,.05,.05);
      for(let i=0;i<5;i++){prop(i%2?"hoodie":"shirt",-1.62+i*.81,1.43,.52,i%3===0?"bone":"ink",g);counts.apparel++;prop("cap",-1.6+i*.8,2.7,.42,i===2?"orange":"ink",g);counts.caps++;}
      for(const xx of [-1.5,-.5,.5,1.5]){prop("folded",xx,.34,.35,xx<0?"ink":"bone",g);counts.folded++;prop("books",xx,3.56,.3,"ink",g);}
      if(yaw===0)solid(x,z+.35,4.5,.85);else solid(x+Math.sin(yaw)*.35,z,.85,4.5);
    };
    bay(-8,-12.6,0,"ARTISTS AND APPAREL");bay(8,-12.6,0,"COLLABS");bay(-13.55,-8,Math.PI/2,"SHIRTS  HOODIES  HATS");
    for(const [x,t] of [[-9.35,"FLOMONTOYA"],[-6.5,"ART OF FREEDOM"],[6.7,"BTC SESSIONS"],[9.5,"BITAXE"]])label(root,t,x,3.15,-12.1,.18,"#e7ae68");
    // Fine-art gallery: actual credited public previews, varied frame sizes, print bins and flat files.
    const wall=group(-13.52,0,1.2,Math.PI/2);label(wall,"FINE ARTS",0,4.85,.1,.49);
    for(let i=0;i<4;i++){picture(wall,["4109","1580","1478","4987"][i],-4.3+i*2.85,3.03,.1,2.35,2.65);label(wall,i===3?"ART OF FREEDOM":"FLOMONTOYA",-4.3+i*2.85,1.5,.21,.19);prop("lamp",-4.3+i*2.85,4.55,.5,"ink",wall);}
    for(const z of [-2.8,1.3,5.4]){prop("printbin",-12.45,0,z,"ink",root,Math.PI/2);solid(-12.45,z,.9,1.4);const g=group(-12.15,1.0,z,Math.PI/2);picture(g,["4109","1580","1478"][(Math.round(z*10)+28)/41],0,0,0,.96,.98);}
    for(const z of [-2.8,2.5]){
      prop("table",-8.4,0,z,"ink",root,Math.PI/2);solid(-8.4,z,1.35,2.5);
      for(let i=0;i<4;i++){block(root,"#bdab86",-8.4,.42+i*.14,z,1.1,.1,2.15);block(root,"#514c43",-7.82,.42+i*.14,z,.05,.045,.34);}
      prop("books",-8.45,1.11,z-.65);prop("pins",-8.4,1.11,z+.2);const g=group(-8.4,1.76,z+.55,.3);picture(g,"4987",0,0,0,.9,1.05);
    }
    // Open workshop: two four-arm presses, drying trays, screen storage, ink wall and tool boards.
    surface(root,"#493e30",9.6,4.66,-7.41,6.25,1.32);
    label(root,"PROOF OF WORK",9.6,4.84,-7.3,.49);label(root,"SCREEN PRINTING",9.6,4.36,-7.29,.29,"#e6a35d");
    for(const z of [-5,2.1]){prop("press",9.45,0,z);solid(9.45,z,3.45,3.45);counts.presses++;}
    for(const z of [-9,6.2]){prop("dryer",12.4,0,z);solid(12.4,z,1.5,1.05);counts.dryers++;}
    const work=group(13.55,0,-1.5,-Math.PI/2);
    for(const x of [-4.6,0,4.6]){prop("table",x,0,0,"ink",work);prop("tools",x,2.8,.02,"ink",work);for(const xx of [-.8,0,.8]){prop("ink",x+xx,1.12,.13,xx<0?"orange":xx>0?"sage":"bone",work);counts.ink++;prop("box",x+xx,.32,0,"ink",work);}}
    solid(13.2,-1.5,1.35,12.6);
    for(const y of [3.85,4.48]){block(work,"#9b734d",0,y,.22,12,.085,.58);for(let i=0;i<32;i++){prop("ink",-5.65+i*.365,y+.05,.24,["orange","bone","sage","ink"][i%4],work);counts.ink++;}}
    for(const z of [-9.3,8.9]){
      prop("table",9.5,0,z);solid(9.5,z,2.5,1.35);for(const x of [8.7,9.5,10.3]){prop("folded",x,1.11,z,"bone");counts.folded++;prop("box",x,.32,z);}
      const g=prop("screen",9.5,1.65,z-.2);g.rotation.x=-.5;
    }
    for(let i=0;i<5;i++){const p=prop("screen",7.45+i*.18,.78,-11.35);p.rotation.x=-.15;}solid(7.8,-11.35,1.65,.6);
    // Compact portrait catalog kiosk on the entry-side workshop pillar, with one interactive face.
    const kiosk=group(4.35,0,8.4);block(kiosk,"#424846",0,.57,0,1.45,1.14,.72);block(kiosk,"#e6a456",0,.12,.38,1.25,.04,.03,.75);
    block(kiosk,"#252b2f",0,1.95,-.03,1.82,2.12,.22);const screen=surface(kiosk,"#111a20",0,1.95,.1,1.62,1.92);
    label(kiosk,"PROOF OF INK",0,2.69,.135,.19);label(kiosk,"BROWSE CATALOG",0,2.4,.14,.16,"#e9ab62");
    for(let i=0;i<4;i++){const y=2.1-i*.25;block(kiosk,"#363c3c",0,y,.13,1.4,.19,.02);label(kiosk,["APPAREL","FINE ARTS","COLLABS","PROOF OF WORK"][i],0,y-.05,.15,.14);}
    block(kiosk,"#bc702e",0,1.07,.13,1.4,.2,.025,.25);label(kiosk,"OPEN OFFICIAL SITE",0,1.025,.16,.12);solid(4.35,8.4,1.85,.8);
    // Small waiting / magazine corner, three shared crew seats and safe stand positions.
    rug(-8.6,9.7,7.6,5.1);
    for(const x of [-10.6,-9,-7.4]){prop("chair",x,0,10.7);solid(x,10.7,1.44,1.05);seats.push({x,y:.49,z:10.7,ry:Math.PI,viewYaw:0,floor:0,walkAt:{x,z:9.1},sitter:null,allowWeapons:true,lockMovement:true});}
    block(root,"#8d6c4c",-9,.53,7.15,2.6,.12,1.1);for(const x of [-10,-8])block(root,"#3b4142",x,.26,7.15,.12,.52,.85);solid(-9,7.15,2.6,1.1);
    prop("books",-9.6,.6,7.1);prop("lamp",-8.15,.6,7.1);label(root,"STACKCHAIN MAGAZINE",-9,.43,7.73,.2);
    const frontArt=group(-9,0,12.62,Math.PI);for(const x of [-1.8,1.8]){picture(frontArt,x<0?"1478":"1580",x,3,.08,2.35,2.8);prop("lamp",x,4.6,.35,"ink",frontArt);}
    const lounge=group(-13.5,0,9.1,Math.PI/2);picture(lounge,"8060",-.8,2.5,.1,1.3,1.75);picture(lounge,"8497",1.15,2.5,.1,1.2,1.75);label(lounge,"BOOKS AND IDEAS",0,4,.15,.3);
    for(const [x,z] of [[-12.1,11.6],[-5.35,9.6],[-11.8,-5.4],[-5.3,-11],[5.4,-11],[12,11.45],[6.55,6],[6.55,-10]]){prop("planter",x,0,z);solid(x,z,.7,.7);}
    for(const x of [-13.15,13.15])for(const z of [-11,4,11.4]){prop("lamp",x,3.7,z);block(root,"#514a3b",x,3.62,z,.48,.08,.48);}
    // Small mailers, print rolls and tools live within existing fixture footprints.
    for(const z of [-4.4,2.1]){prop("pins",2.75,1.86,z);prop("books",-3.55,1.48,z+.34);}
    for(const x of [-10,-6,6,10]){prop("planter",x,4.85,-12.45);}
    const lights=new Float32Array([0,4.8,0,17,1,.75,.47,0,-10,4,1,11,.9,.69,.42,0,10,4,0,13,1,.76,.49,0]);
    const lighting={clear:[.035,.039,.042],sky:[.48,.45,.39],ground:[.32,.29,.25],direct:[.83,.74,.59],directStrength:.38,ambientFloor:.37,sun:{x:.3,y:.9,z:.2},shadowCenter:{x:0,y:2,z:0},shadowExtent:20,shadowStrength:.26,bloomStrength:.22,fog:[.035,.039,.042],fogNear:50,fogFar:85,lights,lightCount:3};
    return {id:"proof-of-ink",root,exitDoor,lighting,solids,seats,counts,screen,kiosk,mediaAt:{x:4.35,y:0,z:10.25},groundAt:()=>0,ceiling:6,bounds:{minX:-13.55,maxX:13.55,minZ:-12.55,maxZ:12.5},spawn:{x:0,y:0,z:11.1},spawnYaw:0,followDistance:3,exit:{x:0,y:0,z:11.25},
      browseGoals:[{x:4.35,z:10.25},{x:-3.55,z:4},{x:2.75,z:-2.3},{x:-10.3,z:1},{x:7,z:-1.3},{x:9.4,z:5.4},{x:0,z:-8.7},...seats.map(s=>s.walkAt)],
      reviews:{"ink-hero":{position:{x:0,y:0,z:10.6},yaw:0,pitch:.17,dist:3},"ink-retail":{position:{x:.1,y:0,z:1.3},yaw:.1,pitch:.12,dist:3},"ink-gallery":{position:{x:-10.3,y:0,z:1},yaw:Math.PI/2,pitch:.1,dist:3},"ink-workshop":{position:{x:6.1,y:0,z:-.9},yaw:-1.2,pitch:.15,dist:3},"ink-kiosk":{position:{x:4.35,y:0,z:10.25},yaw:0,pitch:.12,dist:3},"ink-lounge":{position:{x:-9,y:0,z:8.8},yaw:Math.PI,pitch:.14,dist:3}},
      tomatoContact:(x,y,z)=>y<.1||Math.abs(x)>13.7||z<-12.7||z>12.7,
      clampCamera:p=>{p.y=Math.max(.75,Math.min(5.7,p.y));}
    };
  };
  BL.proofOfInkRoom={build};
})();
