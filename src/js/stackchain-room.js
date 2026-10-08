// Stackchain's warm industrial newsroom/library, built around clear central circulation.
(() => {
  "use strict";
  const BL=window.BL,S=BL.scene,{block}=BL.dsbModels,{sign,prop,cover}=BL.stackchainModels;
  const build=()=>{
    const root=S.createNode({visible:false}),solids=[],seats=[],D=BL.stackchainData;
    const C={wall:"#313638",steel:"#1c252a",wood:"#725138",brass:"#b99256",cream:"#eee0bc",amber:"#ffca78"};
    const group=(x,z,yaw=0)=>{const n=S.createNode({position:{x,y:0,z},rotation:{x:0,y:yaw,z:0}});S.addChild(root,n);return n;};
    const label=(p,t,x,y,z,size=.32,c=C.cream)=>{const n=sign(p,t,x,y,z,size,c);n.depthBias=-.2;return n;};
    const solid=(x,z,w,d)=>solids.push([x-w/2,x+w/2,z-d/2,z+d/2]);
    const plant=(x,z)=>{S.addChild(root,S.createNode({geometry:BL.dressing.withoutRulers("planter"),position:{x,y:0,z}}));solid(x,z,.7,.7);};
    const art=(p,id,x,y,z,w,h)=>{block(p,C.brass,x,y,z,w+.1,h+.1,.08);const n=S.createNode({geometry:cover(id),position:{x,y,z:z+.05},scale:{x:w,y:h,z:1}});n.depthBias=-.3;S.addChild(p,n);return n;};
    const stack=(p,x,y,z,id="copy-1")=>{prop(p,"stack",x,y,z);const n=S.createNode({geometry:cover(id),position:{x,y:y+.292,z},rotation:{x:-Math.PI/2,y:0,z:0},scale:{x:.64,y:.87,z:1}});n.depthBias=-.3;S.addChild(p,n);};
    const seat=(x,z,yaw,walkX,walkZ,kind="leather")=>{prop(root,kind,x,0,z,yaw);solid(x,z,kind==="leather"?1.62:1.2,kind==="leather"?1.34:1.05);seats.push({x,y:.54,z,ry:yaw+Math.PI,viewYaw:yaw,floor:0,walkAt:{x:walkX,z:walkZ},sitter:null,allowWeapons:true,lockMovement:true});};
    const table=(x,z,w=3,d=1.6,y=.77)=>{block(root,C.wood,x,y,z,w,.14,d);for(const dx of [-w*.42,w*.42])for(const dz of [-d*.36,d*.36])block(root,C.steel,x+dx,y/2,z+dz,.09,y,.09);solid(x,z,w,d);};
    // Stone tile floor, dark exposed joists, brass conduits and amber practical pendants.
    for(let x=-15;x<16;x+=2)for(let z=-18;z<20;z+=2){block(root,(x+z)%4?"#69675f":"#716d61",x,-.08,z,1.985,.16,1.985).depthBias=.9;block(root,"#272b2c",x,6.7,z,2,.12,2);}
    for(const x of [-16,16])for(let z=-17.5;z<19;z+=3)block(root,C.wall,x,3.35,z,.3,6.7,3).depthBias=.8;
    for(let x=-14.5;x<16;x+=3)block(root,C.wall,x,3.35,-19,3,6.7,.3).depthBias=.8;
    for(const x of [-9,9])block(root,C.wall,x,3.35,19,14,6.7,.3);block(root,C.wall,0,5,19,4,3.4,.3);
    const exitDoor=block(root,"#5c4937",0,1.5,18.82,2.8,3,.16);
    const exitLabel=label(root,"CHORA",0,3.25,18.6,.33,C.amber);exitLabel.rotation.y=Math.PI;
    for(const z of [-17,-11,-5,1,7,13,17]){
      block(root,C.steel,0,6.25,z,31.8,.27,.22);
      for(const x of [-13,-5,5,13]){block(root,C.steel,x,5.9,z,.035,.7,.035);prop(root,"pendant",x,5.48,z);}
    }
    for(const x of [-15.55,-4,4,15.55]){block(root,C.steel,x,6.4,0,.16,.16,37);block(root,C.brass,x+.2,6.34,0,.045,.045,37);}
    for(const x of [-15.7,15.7])for(const z of [-16,-8,0,8,16]){block(root,C.steel,x,3.3,z,.2,6.6,.2);prop(root,"lamp",x,3.1,z);}
    // Hero portal: human-height furniture below, large publication masthead above.
    for(const x of [-5.1,5.1])block(root,C.steel,x,3.2,10.9,.25,6.4,.28);
    block(root,C.steel,0,4.94,10.9,10.7,2.1,.34);
    label(root,"STACKCHAIN",0,5.08,11.1,1.2);label(root,"MAGAZINE",0,4.48,11.12,.55,C.brass);
    block(root,C.wood,0,3.99,10.92,9.7,.46,.38);label(root,"BY PLEBS FOR PLEBS",0,3.88,11.14,.41,C.cream);
    for(const x of [-5.1,5.1])solid(x,10.9,.25,.28);
    prop(root,"rug",0,.023,15);const rugTitle=label(root,"STACKCHAIN",0,.06,15.5,.58,C.brass);rugTitle.rotation.x=-Math.PI/2;
    // Reception is off the central walking lane. Both official support stations stay modest.
    for(const [x,id,title] of [[-6,"donations","SUPPORT"],[6,"contact","CONTACT"]]){
      table(x,17,2.3,1.1,1);prop(root,"lamp",x+.7,1.08,17);stack(root,x-.5,1.08,17);
      block(root,C.steel,x,2.5,17.25,2.9,1.2,.13);label(root,title,x,2.46,17.34,.4,C.brass);
    }
    plant(-3.4,17.2);plant(3.4,17.2);plant(-14.5,15.7);plant(14.5,15.7);
    // Leather reading lounge: the current article rack gives it an Articles destination.
    prop(root,"rug",-10,.023,8);table(-10,6.4,3.3,1.5,.65);
    stack(root,-10.9,.73,6.4,"copy-6");stack(root,-9.3,.73,6.4,"copy-13");prop(root,"lamp",-10,.73,6);
    seat(-12,10,0,-12,8.3);seat(-8,10,0,-8,8.3);
    const lounge=group(-15.6,8,Math.PI/2);label(lounge,"READ  THINK  STACK",0,4.3,.1,.43,C.brass);
    for(const [i,a] of D.articles.slice(0,3).entries())art(lounge,a.art,-2.5+i*2.5,2.9,.1,1.9,1.35);
    prop(lounge,"drawers",0,0,.15);solid(-15,8,1.2,3);prop(root,"lamp",-14.1,1.45,5.4);plant(-14,3.5);
    // Editorial floor: four working stations, layout pages, research stacks, lamps and pinboards.
    for(const x of [-11,-5.5])for(const z of [-5,-11]){
      prop(root,"rug",x,.022,z+.55);prop(root,"desk",x,0,z);solid(x,z,3.15,1.55);
      prop(root,"monitor",x,1.11,z-.43);prop(root,"lamp",x-1.15,1.11,z-.35);stack(root,x+.92,1.11,z-.2,"copy-1");
      seat(x,z+1.7,0,x+2.35,z+1.7,"chair");
      for(const dx of [-1.1,1.1])prop(root,"books",x+dx,.12,z-.25);
      block(root,"#3d342e",x+1.32,.03,z+.83,.055,.035,1.1);
    }
    const editorial=group(-15.65,-7,Math.PI/2);label(editorial,"RESEARCH  WRITE  EDIT",0,5.5,.12,.46,C.brass);label(editorial,"DESIGN  PUBLISH",0,4.92,.12,.38);
    for(const [i,a] of D.articles.entries()){
      const x=-4.5+(i%3)*4.5,y=i<3?3.65:1.9;block(editorial,"#806a4c",x,y,0,3.5,1.45,.15);art(editorial,a.art,x-.65,y,.1,1.8,1.15);
      for(let n=0;n<4;n++)block(editorial,C.cream,x+.85,y+.42-n*.22,.11,.8-(n%2)*.15,.085,.025);
    }
    // Contributor wall uses article bylines, never invented biographies or identity portraits.
    const authorBoard=S.createNode({geometry:BL.models.panel({tilesX:12,tilesY:8,color:"#4e4030"}),position:{x:0,y:3.2,z:-18.64},scale:{x:9.5,y:4.8,z:1}});S.addChild(root,authorBoard);label(root,"CONTRIBUTORS",0,5.72,-18.49,.61,C.brass);
    const authors=[0,1,2,5];for(const [i,index] of authors.entries()){
      const x=-3.4+(i%2)*6.8,y=i<2?4.3:2.13;art(root,D.articles[index].art,x,y,-18.47,2.7,1.45);
      label(root,D.articles[index].author.toUpperCase().replace("&","AND"),x,y-.99,-18.4,index===2?.19:.3);
    }
    prop(root,"drawers",0,0,-17.8);solid(0,-17.8,2.6,.9);stack(root,-.6,1.45,-17.8);prop(root,"inbox",.65,1.45,-17.8);
    // Archive: repeated real magazine covers and bound material, no invented dates/issues.
    label(root,"STACKCHAIN MAGAZINE",10,5.82,-18.45,.43,C.brass);label(root,"ISSUE LIBRARY",10,5.29,-18.43,.4);
    const archiveIds=["copy-1","copy-2","copy-3","copy-6","copy-8","copy-13"];
    for(const x of [6.6,9.8,13]){
      prop(root,"shelf",x,0,-18.15);solid(x,-18.15,3.1,1);
      for(let r=0;r<5;r++)for(let c=0;c<3;c++)art(root,archiveIds[(r+c)%6],x-.96+c*.96,.72+r*1.01,-17.62,.61,.77);
    }
    const sideLibrary=group(15.45,-12,-Math.PI/2);prop(sideLibrary,"shelf",0,0,0);solid(15.25,-12,1.1,3.1);
    for(let r=0;r<5;r++){prop(sideLibrary,"books",-.7,.3+r*1.01,.05);prop(sideLibrary,"books",.75,.3+r*1.01,.05);}
    prop(root,"rug",9.7,.025,-12);table(9.7,-12,4.2,1.65,1);for(const x of [8.3,10.8])stack(root,x,1.08,-12,archiveIds[Math.round(x)%6]);prop(root,"lamp",9.7,1.08,-12.5);
    seat(8,-9.5,0,6.2,-9.5);seat(11.4,-9.5,0,13.1,-9.5);plant(5.2,-14.8);
    // Physical copies counter and magazine rack: exclusively the authorized Stackchain products.
    const copies=group(15.45,-4.5,-Math.PI/2);label(copies,"PHYSICAL COPIES",0,5.62,.1,.58,C.brass);
    for(const x of [-1.7,1.7]){
      prop(copies,"shelf",x,0,0);
      for(let r=0;r<4;r++)for(let c=0;c<2;c++)art(copies,archiveIds[(r+c)%6],x-.66+c*1.3,.8+r*1.01,.56,.77,.91);
    }
    solid(15.1,-4.5,1.25,6.55);table(12.8,-4.5,2.2,3.1,1);
    stack(root,12.8,1.08,-5.3,"copy-0");stack(root,12.8,1.08,-3.9,"copy-1");prop(root,"lamp",12.8,1.08,-4.65);
    label(copies,"OFFICIAL STACKCHAIN EDITIONS",0,4.91,.1,.28);label(copies,"PROOF OF INK",0,.36,1.11,.32,C.brass);
    // Pleb-losophy: the site's actual mission, not a fictional collection of essays.
    const pleb=group(15.52,10,-Math.PI/2);block(pleb,C.steel,0,3,0,7,5.5,.13);
    label(pleb,"PLEB-LOSOPHY",0,5.12,.12,.6,C.brass);
    for(const [i,t] of ["STORIES","PEOPLE","BITCOIN","BY PLEBS FOR PLEBS"].entries())label(pleb,t,0,4.15-i*.63,.14,i===3?.34:.47);
    art(pleb,"article-0",-1.9,1.03,.15,1.55,1.06);art(pleb,"article-5",1.9,1.03,.15,1.55,1.06);
    table(12.3,9.6,2.2,1.6,1);prop(root,"lamp",12.8,1.08,9.2);stack(root,11.9,1.08,9.6,"copy-13");plant(14,13.1);
    // Official participation station: display/inbox motif only; all actions leave for the site.
    for(const [x,title] of [[5,"SUBMISSIONS"],[10,"NEWSLETTER"]]){
      table(x,.2,2.6,1.3,1);prop(root,"monitor",x,1.08,0);prop(root,"inbox",x-.9,1.08,.3);prop(root,"lamp",x+.95,1.08,.1);
      block(root,C.wood,x,3.12,-.4,3.3,1.8,.12);label(root,title,x,3.67,-.31,.4,C.brass);
      for(let i=0;i<4;i++){block(root,C.cream,x-1.1+i*.72,2.96,-.3,.57,.77,.025);for(let j=0;j<4;j++)block(root,"#655e4e",x-1.1+i*.72,3.17-j*.11,-.28,.37,.023,.01);}
    }
    for(const [x,z] of [[-14,-16],[-3,-16],[3,-5],[3,5],[14,5],[-4,5]])plant(x,z);
    label(root,"IDEAS  ARTICLES  FREEDOM",-6,5.38,-17.6,.48,C.brass);
    const lighting={clear:[.035,.038,.041],sky:[.51,.46,.38],ground:[.34,.3,.25],direct:[.8,.7,.52],directStrength:.3,ambientFloor:.42,sun:{x:.3,y:.9,z:.2},shadowCenter:{x:0,y:3,z:0},shadowExtent:26,shadowStrength:.18,bloomStrength:.27,fog:[.035,.038,.041],fogNear:60,fogFar:100,
      lights:new Float32Array([0,4.9,13,13,1,.72,.4,0,-10,4.7,7,11,1,.68,.37,0,-9,4.8,-8,12,1,.72,.44,0,9,4.8,-14,12,1,.72,.42,0,12,4.6,-3,10,1,.71,.42,0,10,4.6,10,10,1,.71,.44,0]),lightCount:6};
    const reviews={
      "stackchain-entrance":{position:{x:0,y:0,z:16.5},yaw:0,pitch:.04,dist:3},
      "stackchain-editorial":{position:{x:-8,y:0,z:1},yaw:0,pitch:.12,dist:3},
      "stackchain-lounge":{position:{x:-5,y:0,z:7},yaw:1.25,pitch:.16,dist:3},
      "stackchain-archive":{position:{x:6,y:0,z:-7},yaw:-.35,pitch:.03,dist:3},
      "stackchain-pleb":{position:{x:8,y:0,z:10},yaw:-1.57,pitch:.03,dist:3},
      "stackchain-community":{position:{x:7.5,y:0,z:4.5},yaw:0,pitch:.02,dist:3},
      "stackchain-copies":{position:{x:9,y:0,z:-4.5},yaw:-1.57,pitch:.01,dist:3}
    };
    return {id:"stackchain-magazine",root,lighting,exitDoor,solids,seats,reviews,menuZones:BL.stackchainZones.create(),groundAt:()=>0,ceiling:6.65,spawnYaw:0,followDistance:3,spawn:{x:0,y:0,z:16.5},exit:{x:0,y:0,z:17.9},bounds:{minX:-15.7,maxX:15.7,minZ:-18.7,maxZ:18.7},browseGoals:Object.values(reviews).map(r=>r.position),tomatoContact:(x,y,z)=>y<.1||Math.abs(x)>15.75||Math.abs(z)>18.75,counts:{workstations:4,seats:seats.length,lights:6,articles:D.articles.length,products:D.products.length}};
  };
  BL.stackchainRoom={build};
})();
