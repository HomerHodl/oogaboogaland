// VAC 7: a stocked dark timber boutique and ideas lounge within the existing interior contract.
(() => {
  "use strict";
  const BL=window.BL,S=BL.scene,{block}=BL.dsbModels,{prop,sign}=BL.svrnModels;
  const build=()=>{
    const root=S.createNode({visible:false}),solids=[],seats=[],fixtures=[],displays=[];
    const C={wall:"#302e2a",wood:"#694b34",steel:"#252625",brass:"#ad8550",cream:"#eadbc0",amber:"#ffc579"};
    const counts={shirts:0,hoodies:0,foldedStacks:0,caps:0,mannequins:0,bays:0,collectionPanels:0};
    const group=(x,z,yaw=0)=>{const n=S.createNode({position:{x,y:0,z},rotation:{x:0,y:yaw,z:0}});S.addChild(root,n);return n;};
    const label=(p,t,x,y,z,size=.3,c=C.cream)=>{const n=sign(p,t,x,y,z,size,c);n.depthBias=-.2;return n;};
    const solid=(x,z,w,d)=>solids.push([x-w/2,x+w/2,z-d/2,z+d/2]);
    const display=(p,kind,x,y,z,tone="cream",motif="bitcoin")=>{const node=prop(p,kind,x,y,z,tone,motif);displays.push({kind,node,supportY:y});counts[{shirt:"shirts",hoodie:"hoodies",folded:"foldedStacks",cap:"caps",mannequin:"mannequins"}[kind]]++;return node;};
    const table=(x,z,w,d,height=1)=>{
      const n=group(x,z);block(n,C.wood,0,height-.09,0,w,.18,d);block(n,C.steel,0,.14,0,w,.14,d);
      for(const dx of [-w/2+.12,w/2-.12])for(const dz of [-d/2+.12,d/2-.12])block(n,C.steel,dx,height/2,dz,.14,height,.14);
      block(n,C.amber,0,height-.2,d/2-.06,w-.2,.025,.025).glow=.6;solid(x,z,w,d);fixtures.push({node:n,floor:0,kind:"table"});return n;
    };
    const plant=(x,z)=>{const n=S.createNode({geometry:BL.dressing.withoutRulers("planter"),position:{x,y:0,z}});S.addChild(root,n);solid(x,z,.7,.7);fixtures.push({node:n,floor:0,kind:"plant"});};
    const panel=(p,lines,x,y,z)=>{block(p,C.brass,x,y,z,2.96,1.62,.09);block(p,C.steel,x,y,z+.052,2.84,1.5,.025);lines.forEach((t,i)=>label(p,t,x,y+(lines.length-1)*.19-i*.38,z+.08,t.length>15?.22:.31));};
    const bay=(x,z,yaw,index,lines,motif="bitcoin",hats=false)=>{
      const n=group(x,z,yaw);prop(n,"bay",0,0,0);counts.bays++;fixtures.push({node:n,floor:0,kind:"bay"});solid(x,z,yaw?1.2:3.4,yaw?3.4:1.2);
      panel(n,lines,0,4.05,.02);
      for(let i=0;i<6;i++){
        const tone=(i+index)%3?"black":"cream",kind=motif==="faith"||index%3===0?"hoodie":"shirt";
        display(n,kind,-1.25+i*.5,1.31,.18,tone,motif);
      }
      for(const sx of [-1.05,0,1.05]){
        display(n,"folded",sx,.25,.09,index%2?"black":"cream",motif);
        display(n,hats?"cap":"folded",sx,3.17,.12,index%2?"cream":"black",motif);
      }
      return n;
    };
    // Floor/walls are segmented for the existing software renderer and mobile culling.
    for(let x=-12;x<=12;x+=2)for(let z=-14;z<=14;z+=2){block(root,(x+z)%4?"#55483c":"#604f40",x,-.08,z,1.985,.16,1.985);block(root,"#252422",x,6.3,z,2,.14,2);}
    for(const x of [-13,13])for(let z=-13.5;z<15;z+=3)block(root,C.wall,x,3.15,z,.3,6.3,3);
    for(let x=-11.5;x<13;x+=3)block(root,C.wall,x,3.15,-15,3,6.3,.3);
    for(const x of [-7.5,7.5])block(root,C.wall,x,3.15,15,11,6.3,.3);block(root,C.wall,0,4.9,15,4,2.8,.3);
    const exitDoor=block(root,"#584332",0,1.5,14.82,2.8,3,.16);const exitLabel=label(root,"CHORA",0,3.25,14.6,.33,C.amber);exitLabel.rotation.y=Math.PI;
    for(const z of [-12,-6,0,6,12]){
      block(root,C.wood,0,5.97,z,25.8,.3,.28);
      for(const x of [-8,0,8])prop(root,"pendant",x,5.3,z);
    }
    for(const x of [-12.6,12.6]){block(root,C.brass,x,5.7,0,.05,.05,29);block(root,C.amber,x,5.6,0,.04,.04,29).glow=.65;}
    // Compact entry brand wall spans the aisle overhead, leaving the existing doorway clear.
    for(const x of [-5.5,5.5]){block(root,C.steel,x,3,8.9,.24,6,.3);solid(x,8.9,.24,.3);}
    block(root,C.steel,0,4.96,8.9,11.25,1.85,.28);label(root,"SVRN",0,5.16,9.07,1.14);label(root,"SOCIETY",0,4.49,9.08,.44,C.brass);
    block(root,C.brass,0,4.06,8.9,10.9,.07,.35);
    prop(root,"rug",0,0,12.5);plant(-3.9,13.2);plant(3.9,13.2);
    // Four generous merchandise bays on either side; garments hang from continuous rails.
    for(let i=0;i<4;i++){
      bay(-12.1,-8+i*4,Math.PI/2,i,[i<2?"BITCOIN SHIRTS":"HOODIES"],"bitcoin");
      bay(12.1,-8+i*4,-Math.PI/2,i+4,[i<2?"FAITH APPAREL":"BITCOIN HATS"],i<2?"faith":"bitcoin",i>=2);
    }
    // The seven actual collection names, without invented product descriptions or slogans.
    const titles=[["1913"],["1984"],["CAPTIVATED"],["FAITH APPAREL"],["FIX THE MONEY"],["FLIP THE TABLES"],["MOMS AGAINST","MONEY PRINTING"]];
    titles.forEach((title,i)=>{bay(-10.5+i*3.5,-14.05,0,i+8,title,i===3?"faith":"bitcoin",i===1||i===6);counts.collectionPanels++;});
    label(root,"SVRN SOCIETY COLLECTIONS",0,5.61,-14.5,.47,C.brass);
    // Two stocked islands, low enough to keep the collection gallery visible from the door.
    for(const x of [-4,4]){
      prop(root,"rug",x,0,2.5);const n=table(x,2.5,3.5,2,1.05);
      for(const sx of [-1.05,0,1.05])for(const sz of [-.46,.46])display(n,"folded",sx,1.05,sz,sx===0?"black":"cream");
      for(const sx of [-1.05,0,1.05])display(n,"cap",sx,.22,.2,x<0?"black":"cream");
      block(n,C.wood,0,.63,1.02,3.1,.62,.07);label(n,"SVRN SOCIETY",0,.5,1.08,.28);
    }
    // Mannequins stand on plinths; no floating clothes or screen-space product labels.
    for(const [x,z,tone] of [[-4,7.5,"cream"],[4,7.5,"black"],[7,-8,"cream"]]){
      const n=table(x,z,1.35,1.35,.3);display(n,"mannequin",0,.3,0,tone,"faith");
    }
    // A restrained caps/Bitcoin feature within the right-side browse zone.
    const hats=table(8,1.8,2.2,2,1);
    for(const x of [-.65,0,.65])for(const z of [-.5,.35])display(hats,"cap",x,1,z,x===0?"cream":"black");
    label(hats,"BITCOIN HATS",0,.64,1.04,.24,C.brass);
    // Leather lounge, shared seat records; real walk-out points face an open aisle.
    prop(root,"rug",-6.5,0,-8.5);
    for(const x of [-8,-5]){
      BL.stackchainModels.prop(root,"leather",x,0,-10,Math.PI);solid(x,-10,1.62,1.34);
      seats.push({x,y:.54,z:-10,ry:0,viewYaw:Math.PI,floor:0,walkAt:{x,z:-8.5},sitter:null,allowWeapons:true,lockMovement:true});
    }
    const coffee=table(-6.5,-6.5,3,1.4,.58);BL.stackchainModels.prop(coffee,"books",-.65,.58,0);BL.stackchainModels.prop(coffee,"lamp",.8,.58,0);
    plant(-9.7,-6);plant(-3,-11.4);plant(9.7,-11.5);
    // Physical browse terminal: interaction uses the shared contextual menu and input isolation.
    const kiosk=table(8.3,9,1.5,1.1,1.05);block(kiosk,C.steel,0,1.58,-.1,1.36,1.02,.14);
    const screen=block(kiosk,"#494036",0,1.58,-.016,1.21,.86,.026);screen.glow=.4;
    label(kiosk,"SVRN",0,1.77,.004,.22);label(kiosk,"COLLECTIONS",0,1.53,.004,.12);label(kiosk,"LOOKBOOK",0,1.32,.004,.12,C.amber);
    label(kiosk,"EXPLORE",0,.66,.58,.22,C.brass);plant(10.4,10.3);
    const zone=BL.dsbMenuZones.zone,menuZones=[zone("home","Browse SVRN Society",8.3,8.9,2,1.8,3),zone("shirts","Browse Bitcoin Shirts",-9,-4,2,6),zone("hoodies","Browse Hoodies",-9,4,2,2),zone("faith","Browse Faith Apparel",9,-6,2,5),zone("hats","Browse Bitcoin Hats",9,2.5,2.5,3),zone("collections","Explore SVRN Collections",0,-11.7,10,1.4),zone("lookbook","Browse Lookbook",-6.5,-8.5,3,2,3)];
    const reviews={
      "svrn-entrance":{position:{x:0,y:0,z:12.3},yaw:0,pitch:-.18,dist:2.5},
      "svrn-retail":{position:{x:0,y:0,z:6.5},yaw:.15,pitch:.04,dist:3},
      "svrn-collections":{position:{x:0,y:0,z:-10.5},yaw:0,pitch:-.08,dist:3},
      "svrn-faith":{position:{x:8.5,y:0,z:-5},yaw:-Math.PI/2,pitch:-.08,dist:3},
      "svrn-hats":{position:{x:8,y:0,z:5.5},yaw:-.5,pitch:.07,dist:3},
      "svrn-kiosk":{position:{x:8.3,y:0,z:11},yaw:0,pitch:.05,dist:2.6},
      "svrn-lounge":{position:{x:-6.5,y:0,z:-3.5},yaw:0,pitch:.16,dist:3},
      "svrn-wide":{position:{x:0,y:0,z:8.6},yaw:0,pitch:.14,dist:4}
    };
    const lighting={clear:[.035,.03,.026],sky:[.5,.44,.35],ground:[.32,.27,.22],direct:[.85,.72,.5],directStrength:.3,ambientFloor:.44,sun:{x:.3,y:.9,z:.2},shadowCenter:{x:0,y:3,z:0},shadowExtent:23,shadowStrength:.16,bloomStrength:.25,fog:[.035,.03,.026],fogNear:60,fogFar:100,lights:new Float32Array([0,5,10,12,1,.71,.39,0,-7,4.7,1,11,1,.7,.4,0,7,4.7,1,11,1,.7,.4,0,-7,4.5,-9,10,1,.67,.36,0,7,4.5,-9,10,1,.72,.42,0,0,5,-12,10,1,.73,.45,0]),lightCount:6};
    return {id:"svrn-society",root,lighting,exitDoor,screen,solids,seats,reviews,menuZones,fixtures,displays,counts:{...counts,seats:seats.length,lights:6},dimensions:{width:26,depth:30,height:6.3},groundAt:()=>0,ceiling:6.23,spawnYaw:0,followDistance:3,spawn:{x:0,y:0,z:12.3},exit:{x:0,y:0,z:13.8},bounds:{minX:-12.7,maxX:12.7,minZ:-14.7,maxZ:14.7},browseGoals:Object.values(reviews).map(r=>r.position),tomatoContact:(x,y,z)=>y<.1||Math.abs(x)>12.75||Math.abs(z)>14.75};
  };
  BL.svrnRoom={build};
})();
