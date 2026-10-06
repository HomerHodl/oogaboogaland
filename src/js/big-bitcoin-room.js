// BIG BITCOIN: concept-led institutional headquarters, on the shared DSB interior contract.
(() => {
  "use strict";
  const BL=window.BL,S=BL.scene,{block,sign}=BL.dsbModels;
  const build=()=>{
    const root=S.createNode({visible:false}),solids=[],walls=[],seats=[],counts={chairs:0,monitors:0,books:0,banners:0,cameras:0};
    const C={black:"#242326",stone:"#454044",red:"#9e2028",gold:"#b89a62",light:"#e3c88d",wood:"#43312c"};
    const group=(x=0,y=0,z=0,yaw=0)=>{const n=S.createNode({position:{x,y,z},rotation:{x:0,y:yaw,z:0}});S.addChild(root,n);return n;};
    const prop=(kind,x,y,z,v=0,parent=root,yaw=0)=>{const n=S.createNode({geometry:BL.dressing.bigBitcoin(kind,v),position:{x,y,z},rotation:{x:0,y:yaw,z:0}});if(kind==="desk")n.scale.y=.78;if(kind==="monitor")n.scale.x=n.scale.y=n.scale.z=.8;S.addChild(parent,n);return n;};
    const solid=(x,z,w,d,wall=false)=>{const box=[x-w/2,x+w/2,z-d/2,z+d/2];solids.push(box);if(wall)walls.push(box);};
    const label=(p,t,x,y,z,s=.3,c=C.light)=>{const n=sign(p,t,x,y,z,s,c);n.depthBias=-.15;return n;};
    const coin=(p,x,y,z,size=1)=>{const n=prop("coin",x,y,z,0,p);n.scale.x=n.scale.y=n.scale.z=size;return n;};
    const border=(p,x,y,z,w,h)=>{for(const s of [-1,1]){block(p,C.gold,x+s*w/2,y,z,.06,h,.07);block(p,C.gold,x,y+s*h/2,z,w,.06,.07);}};
    const plaque=(p,t,x,y,z,w,s=.27)=>{block(p,C.black,x,y+.1,z,w,.78,.12);border(p,x,y+.1,z+.08,w-.12,.65);label(p,t,x,y,z+.13,s);};
    const banner=(p,x,y,z,w=1.7,h=4.5,text="")=>{
      counts.banners++;block(p,C.red,x,y,z,w,h,.065);
      for(let i=0;i<8;i++)block(p,i%2?"#841b23":"#ad2931",x-w/2+w*(i+.5)/8,y,z+.055,w/14,h,.06);
      for(const side of [-1,1])block(p,C.gold,x+side*(w/2-.06),y,z+.13,.035,h,.02);
      block(p,C.gold,x,y+h/2+.08,z,w+.45,.06,.08);coin(p,x,y+.75,z+.2,.44);
      if(text)label(p,text,x,y-.75,z+.2,.2);
    };
    const rug=(x,z,w,d)=>{
      block(root,"#341e23",x,.028,z,w,.035,d);
      for(const s of [-1,1]){block(root,C.red,x+s*(w/2-.14),.05,z,.12,.015,d-.15);block(root,C.red,x,.05,z+s*(d/2-.14),w-.15,.015,.12);}
      for(const z0 of [-d*.32,0,d*.32]){const n=coin(root,x,.066,z+z0,.5);n.rotation.x=-Math.PI/2;n.scale.z=.06;}
    };
    const seat=(x,z,yaw,kind="chair",zone="boardroom",walk=1.7)=>{
      prop(kind,x,0,z,0,root,yaw);solid(x,z,1.32,1.22);counts.chairs++;
      const facing=yaw+Math.PI;seats.push({x,y:.54,z,ry:facing,viewYaw:yaw,floor:0,walkAt:{x:x+Math.sin(yaw)*walk,z:z+Math.cos(yaw)*walk},sitter:null,allowWeapons:true,lockMovement:true,zone});
    };
    const chandelier=(x,z,w,d,y=6.9)=>{
      for(const s of [-1,1]){block(root,C.gold,x+s*w/2,y,z,.11,.13,d);block(root,C.gold,x,y,z+s*d/2,w,.13,.11);block(root,C.light,x+s*w/2,y-.08,z,.055,.03,d,.9);block(root,C.light,x,y-.08,z+s*d/2,w,.03,.055,.9);}
      for(const xx of [-w/2,w/2])for(const zz of [-d/2,d/2])block(root,C.gold,x+xx,(y+7.7)/2,z+zz,.028,7.7-y,.028);
    };
    // Stone tiles and veins are one cached assembly per variant; the engine instances every tile.
    for(let x=-20;x<=20;x+=2)for(let z=-26;z<=26;z+=2)prop("tile",x,0,z,Math.abs((x+z)/2)%2);
    // Doorways centred at -17, 0 and 17: 6 m clear, with brass jambs and tall lintels.
    for(const x of [-7.2,7.2])for(const z of [-17,0,17]){
      block(root,C.black,x,6,z,.34,3.6,6);for(const side of [-1,1]){block(root,C.gold,x,2.1,z+side*3,.42,4.2,.07);block(root,C.gold,x,4.22,z, .42,.08,6.1);}
    }
    // Close the small intervals between the repeated wall panels, without narrowing the doorways.
    for(const x of [-7.2,7.2])for(const [a,b] of [[-27,-20],[-14,-3],[3,14],[20,27]]){
      block(root,C.black,x,3.9,(a+b)/2,.35,7.8,b-a);solid(x,(a+b)/2,.35,b-a,true);
    }
    for(const side of [-1,1])for(const z of [-8,8]){block(root,C.stone,side*14.2,3.9,z,13.6,7.8,.35);solid(side*14.2,z,13.6,.35,true);}
    for(const x of [-21,21]){block(root,C.black,x,3.9,0,.3,7.8,54);for(let z=-24;z<27;z+=3){const p=group(x*.993,0,z,x<0?Math.PI/2:-Math.PI/2);prop("panel",0,2.05,0,0,p);prop("panel",0,5.9,0,0,p);}}
    for(const z of [-27,27])for(let x=-19.8;x<21;x+=2.4){
      if(z===27&&Math.abs(x)<2.4)continue;
      const p=group(x,0,z*.994,z>0?Math.PI:0);prop("panel",0,2.05,0,0,p);prop("panel",0,5.9,0,0,p);
    }
    for(let x=-19.5;x<21;x+=3)for(let z=-25.5;z<27;z+=3){const central=Math.abs(x)<7;block(root,"#2d292b",x,central?9.5:7.85,z,3,.15,3);}
    for(const z of [-26,-20,-12,-4,4,12,20,26]){
      for(const x of [-6.85,6.85]){
        block(root,C.stone,x,4.7,z,.52,9.4,.65);block(root,C.gold,x,1.15,z,.62,.085,.76);block(root,C.gold,x,7.85,z,.62,.11,.76);solid(x,z,.55,.68,true);
        const p=group(x,0,z,x<0?Math.PI/2:-Math.PI/2);prop("sconce",0,3.2,.34,0,p);
      }
      block(root,C.gold,0,9.18,z,13.4,.1,.11);
    }
    for(const x of [-20.75,20.75])for(const y of [.3,1.25,7.4])block(root,C.gold,x,y,0,.08,.065,53.5);
    const exitDoor=block(root,"#332e2a",0,1.5,26.8,3.6,3,.16);for(const x of [-.23,.23])block(root,C.gold,x,1.4,26.69,.055,.7,.045);
    const exitSign=group(0,0,26.6,Math.PI);plaque(exitSign,"EXIT TO CHORA",0,3.3,0,3.8,.3);
    // Monumental architecture; the .94-unit counter stays below Yellow's standing face.
    rug(0,21,7,10);block(root,C.stone,0,4.1,12,8.5,8.2,.6);solid(0,12,8.5,.6,true);
    for(const x of [-4.05,4.05])block(root,C.gold,x,4.1,12.34,.06,8.2,.03);
    block(root,C.black,0,7.23,12.38,10.5,1.8,.2);label(root,"BIG BITCOIN",0,7.2,12.52,1.25,"#e33a29");label(root,"IN CONTROL",0,6.69,12.53,.35);
    coin(root,0,4.57,12.58,1.9);for(const x of [-3.25,3.25])banner(root,x,4.3,12.57,1.7,4.65,x<0?"PLAN":"COMPLY");
    block(root,C.black,0,.4,15,6.7,.8,1.35);block(root,"#65574b",0,.87,15,7,.14,1.5);border(root,0,.43,15.7,6.3,.67);label(root,"IN CONTROL",0,.3,15.78,.47);solid(0,15,7,1.5);
    for(const x of [-2.7,2.7])prop("lamp",x,.95,15);prop("documents",-1.3,.95,15);prop("monitor",1,.95,15,1);
    for(const x of [-2.3,2.3]){const n=prop("planter",x,.95,14.7);n.scale.x=n.scale.y=n.scale.z=.55;}
    for(const x of [-3.9,3.9]){
      for(const z of [18,20.7]){block(root,C.gold,x,.55,z,.08,1.1,.08);block(root,C.gold,x,.07,z,.46,.14,.46);}
      for(let i=0;i<9;i++)block(root,C.red,x,.94-Math.sin(i/8*Math.PI)*.14,18+i*.3375,.07,.07,.4);
      solid(x,19.35,.48,3.15);
    }
    for(const side of [-1,1]){
      const p=group(side*5.65,0,23.3,side*.18);block(p,C.black,0,1.45,0,1.7,2.9,.3);border(p,0,1.45,.18,1.54,2.7);label(p,side<0?"DIRECTORY":"PODCONF",0,2.55,.22,.22);
      for(let i=0;i<6;i++)label(p,(side<0?["LOBBY","BOARDROOM","PRESS","CONTROL","ARCHIVE","MERCH"]:["BIG BITCOIN","NEWS","RESEARCH","OFFICIAL SITE","INFORMATION","TERMINAL"])[i],0,2.13-i*.3,.22,.17);
      solid(side*5.65,23.3,1.75,.6);
    }
    chandelier(0,21,5.5,7,8.5);
    // The central hall repeats the concept's formal plinth, anonymous executive monument and banners.
    rug(0,-5.5,6,27);block(root,C.black,0,.23,-21.8,5.5,.46,4.1);block(root,C.gold,0,.5,-21.8,5.2,.07,3.8);block(root,C.stone,0,1.19,-21.8,4.7,1.35,3.5);border(root,0,1.15,-19.99,4.3,1.07);
    label(root,"BIG BITCOIN",0,1.38,-19.9,.45);label(root,"IN WORLD MONUMENT",0,.88,-19.89,.22);solid(0,-21.8,5.5,4.1);
    const statue=prop("statue",0,1.86,-21.8);statue.scale.x=statue.scale.y=statue.scale.z=1.22;
    coin(root,0,5.32,-26.55,2.2);label(root,"IN CONTROL",0,8,-26.53,.88);
    for(const x of [-4.8,4.8]){banner(root,x,4.7,-26.45,2.65,5.9,x<0?"ACCUMULATE":"STRATEGY");prop("planter",x,0,-24.7);solid(x,-24.7,.8,.8);}
    for(const z of [-11,-3,5]){chandelier(0,z,4.2,3.5,8.5);for(const x of [-6.8,6.8]){const p=group(x,0,z,x<0?Math.PI/2:-Math.PI/2);banner(p,0,5.8,.3,2,3.1,z<0?"NARRATIVE":"ADOPTION");}}
    // Side-room portal plaques point into each wing, all factual attribution reserved for the terminal.
    for(const [x,z,title] of [[-7.2,-17,"BOARDROOM"],[7.2,-17,"PRESS ROOM"],[-7.2,0,"CONTROL"],[7.2,0,"ARCHIVE"],[-7.2,17,"MERCH"],[7.2,17,"INFORMATION"]]){
      const p=group(x,0,z,x<0?Math.PI/2:-Math.PI/2);plaque(p,title,0,4.6,.3,4.8,.42);
    }
    // Executive boardroom, ten seats with outside-aisle stand points.
    rug(-14.3,-17.6,9.4,14.5);block(root,C.wood,-14.3,.38,-17.6,2.6,.76,8.9);block(root,"#24272a",-14.3,.86,-17.6,3.25,.14,9.2);solid(-14.3,-17.6,3.25,9.2);
    for(const x of [-15.91,-12.69])block(root,C.gold,x,.9,-17.6,.045,.07,9.15);
    for(const side of [-1,1])for(let row=0;row<5;row++){
      const z=-23+row*2.7;seat(-14.3+side*2.8,z,side<0?-Math.PI/2:Math.PI/2);
      prop("documents",-14.3+side*.95,.95,z);prop("monitor",-14.3+side*.75,.95,z,1,root,side<0?-Math.PI/2:Math.PI/2);counts.monitors++;
    }
    for(const z of [-20,-15]){prop("lamp",-14.3,.95,z);block(root,C.gold,-14.3,.99,z+1,.14,.09,.14);}
    const board=group(-14.3,0,-26.65);block(board,C.black,0,4.1,0,10.6,3.9,.15);border(board,0,4.1,.11,10.4,3.7);label(board,"BIG BITCOIN",0,5.06,.2,.85,"#e33a29");label(board,"STRATEGY",0,4.1,.2,.5);label(board,"PLAN  ACCUMULATE  COMPLY",0,3.3,.2,.35);
    for(const x of [-19.6,-9]){prop("planter",x,0,-25.8);solid(x,-25.8,.8,.8);}chandelier(-14.3,-17.6,5,11,6.7);
    // Press room: continuous red curtain, low dais, small microphones, cameras and 12 shared seats.
    for(let i=0;i<30;i++)block(root,i%2?"#591d25":"#81232d",8+i*.425,3.6,-26.35,.42,7.2,.22);
    block(root,C.black,14.4,.06,-23.7,11.9,.12,4.3);block(root,C.gold,14.4,.13,-21.58,11.9,.025,.035);
    block(root,C.black,14.4,5.7,-26,8.4,2,.18);label(root,"BIG BITCOIN",14.4,5.73,-25.87,.92,"#ed3c28");label(root,"PRESS BRIEFING",14.4,5.05,-25.87,.35);
    for(const x of [9.2,19.5])banner(root,x,3.8,-25.99,1.65,4.6,"NARRATIVE");
    block(root,C.wood,14.4,.45,-23.7,1.45,.9,.83);block(root,C.gold,14.4,.95,-23.7,1.65,.1,1);coin(root,14.4,.54,-23.24,.28);solid(14.4,-23.7,1.65,1);
    for(const x of [14.1,14.7]){block(root,C.gold,x,1.105,-23.7,.025,.21,.025);block(root,C.black,x,1.22,-23.64,.095,.08,.18);}
    for(const x of [10.1,12.5,16.3,18.7])for(const z of [-18.9,-15.4,-11.9])seat(x,z,0,"pressChair","press",1.7);
    for(const x of [8.8,20]){prop("camera",x,0,-21);solid(x,-21,.75,.75);counts.cameras++;}
    for(const x of [11,17.8]){prop("planter",x,0,-25);solid(x,-25,.8,.8);}chandelier(14.4,-17,8,10,6.7);
    // Static decorative command centre. No numbers, quotes, prices, feed, timers or new network API.
    const control=group(-20.6,0,0,Math.PI/2);prop("map",0,4.8,.07,0,control);label(control,"DECORATIVE DISPLAY",0,2.82,.18,.32);
    for(const x of [-4.7,4.7])for(const y of [3.55,5.95]){prop("screen",x,y,.08,x<0?0:1,control);counts.monitors++;}
    label(control,"CONTROL",0,7.05,.14,.56,"#e33a29");
    for(const z of [-5,0,5]){
      prop("desk",-19.2,0,z,0,root,Math.PI/2);solid(-19.2,z,1.4,2.8);prop("monitor",-19.2,.95,z,1,root,Math.PI/2);counts.monitors++;
      seat(-17.2,z,Math.PI/2,"chair","control");
      prop("desk",-11.6,0,z,0,root,Math.PI/2);solid(-11.6,z,1.4,2.8);prop("monitor",-11.6,.95,z,0,root,Math.PI/2);counts.monitors++;
      prop("documents",-11.4,.95,z+.8);
    }
    chandelier(-14.3,0,7,11,6.85);
    // Archive: actual data lives in the terminal; the shelves and old machines are explicitly props.
    for(const z of [-5.3,-2.65,0,2.65,5.3]){prop("bookcase",20.3,0,z,0,root,-Math.PI/2);solid(20.3,z,.85,2.7);counts.books+=55;}
    for(const x of [9,11.8,14.6,17.4]){prop("bookcase",x,0,-7.35,1);solid(x,-7.35,2.7,.85);counts.books+=55;}
    for(const x of [18.9,20.3]){prop("cabinet",x,0,6.95);solid(x,6.95,1.3,.8);}
    label(root,"ARCHIVE AND RESEARCH",14.5,5.7,-7.5,.58);label(root,"IN WORLD COLLECTION",14.5,5.14,-7.48,.3);
    block(root,C.black,14.4,.54,0,4.1,1.08,2.25);block(root,C.gold,14.4,1.12,0,4.2,.07,2.35);solid(14.4,0,4.2,2.35);
    // Thin brass vitrine edges imply glass without transparency or another render target.
    for(const x of [12.35,16.45])for(const z of [-1.1,1.1])block(root,C.gold,x,1.55,z,.035,.84,.035);
    for(const x of [12.35,16.45])block(root,C.gold,x,1.97,0,.035,.035,2.2);for(const z of [-1.1,1.1])block(root,C.gold,14.4,1.97,z,4.1,.035,.035);
    prop("hardware",13.1,1.17,0);prop("documents",14.4,1.17,0);coin(root,15.6,1.52,0,.3);plaque(root,"EXHIBIT PROPS",14.4,.52,1.16,3.3,.26);
    prop("desk",12,0,5.7);solid(12,5.7,2.8,1.35);prop("lamp",11.15,.95,5.7);prop("documents",12.5,.95,5.7);seat(12,3.8,Math.PI,"chair","archive");chandelier(14.4,0,7,9,6.85);
    // PODCONF's homepage lists real shirts and Red Team caps. These are block display stand-ins.
    const merch=group(-20.55,0,17,Math.PI/2);label(merch,"BIG BITCOIN",0,5.9,.16,.75,"#e33a29");label(merch,"PODCONF MERCH",0,5.25,.16,.32);
    for(const x of [-4.3,0,4.3]){
      for(const y of [.35,3.2])block(merch,C.wood,x,y,.45,3.8,.1,.9);block(merch,C.gold,x,2.92,.65,3.7,.04,.04);
      for(let i=0;i<4;i++){prop("shirt",x-1.25+i*.82,1.8,.65,i%2,merch);prop("cap",x-1.25+i*.82,3.27,.44,0,merch);prop("folded",x-1.25+i*.82,.42,.44,0,merch);}
    }
    solid(-20.15,17,1.2,12.5);
    for(const z of [13.5,20.5]){prop("desk",-14.3,0,z);solid(-14.3,z,2.8,1.35);for(const x of [-15.1,-14.3,-13.5]){prop("folded",x,.95,z);prop("cap",x,1.32,z);}plaque(root,"VIEW OFFICIAL SHOP",-14.3,.55,z+.72,2.5,.18);}
    rug(-14.3,17,6.4,13);chandelier(-14.3,17,7,11,6.85);
    // Information gallery: a portrait terminal plus framed in-world propaganda, never a fake catalog.
    const posters=group(20.55,0,17,-Math.PI/2);
    for(const [i,t] of ["PLAN","ACCUMULATE","COMPLY"].entries()){
      const x=-4.4+i*4.4;block(posters,C.black,x,3,.06,3.4,4.7,.14);border(posters,x,3,.16,3.3,4.6);coin(posters,x,3.65,.22,.88);label(posters,t,x,1.61,.23,.32);label(posters,"IN WORLD SATIRE",x,1.22,.23,.17);
      for(let j=0;j<7;j++)block(posters,j%2?C.red:C.gold,x-1.2+j*.39,2.1,.22,.25,.4+(j%3)*.25,.04);
    }
    const kiosk=group(13.7,0,22.3);block(kiosk,C.black,0,.58,0,1.5,1.16,.8);block(kiosk,C.gold,0,1.2,0,1.7,.07,.86);block(kiosk,C.black,0,2.02,0,1.95,1.85,.16);
    const screen=block(kiosk,"#221d21",0,2.02,.095,1.77,1.67,.025);border(kiosk,0,2.02,.13,1.83,1.73);label(kiosk,"BIG BITCOIN",0,2.57,.16,.24,"#ec492c");label(kiosk,"INFORMATION",0,2.18,.16,.2);
    for(const [i,t] of ["NEWS","RESEARCH","OFFICIAL SHOP"].entries())label(kiosk,t,0,1.87-i*.23,.16,.16);solid(13.7,22.3,1.96,.87);
    rug(13.7,22.3,5,6);for(const x of [9.4,18]){prop("planter",x,0,25.7);solid(x,25.7,.8,.8);}
    const gallery=group(14.3,0,8.3,Math.PI);label(gallery,"PUBLIC INFORMATION",0,5.75,0,.65);label(gallery,"PODCONF.XYZ",0,4.95,.01,.48,"#e33a29");
    for(const x of [11,14,17])seat(x,11.2,0,"chair","lounge");chandelier(14.3,17,7,11,6.85);
    const lighting={clear:[.045,.035,.04],sky:[.47,.42,.37],ground:[.28,.24,.22],direct:[.78,.65,.48],directStrength:.42,ambientFloor:.35,sun:{x:.3,y:.9,z:.2},shadowCenter:{x:0,y:3,z:0},shadowExtent:32,shadowStrength:.27,bloomStrength:.24,fog:[.045,.035,.04],fogNear:70,fogFar:105,
      lights:new Float32Array([0,5.4,19,14,1,.66,.35,0,0,6,-20,15,1,.64,.32,0,-14,5,-17,12,1,.72,.48,0,14,5,-18,13,1,.4,.25,0,-14,5,0,12,.69,.59,.52,0,14,5,0,12,1,.7,.42,0,0,6,-3,14,1,.65,.4,0]),lightCount:7};
    const reviews={
      "big-lobby":{position:{x:0,y:0,z:23.8},yaw:0,pitch:.18,dist:3},
      "big-monument":{position:{x:0,y:0,z:-12.5},yaw:0,pitch:.15,dist:3},
      "big-boardroom":{position:{x:-10,y:0,z:-10.5},yaw:.35,pitch:.16,dist:3},
      "big-press":{position:{x:14.4,y:0,z:-10.3},yaw:0,pitch:.16,dist:3},
      "big-control":{position:{x:-8.8,y:0,z:2.5},yaw:Math.PI/2,pitch:.14,dist:3},
      "big-archive":{position:{x:9.6,y:0,z:1},yaw:-Math.PI/2,pitch:.16,dist:3},
      "big-merch":{position:{x:-10,y:0,z:17},yaw:Math.PI/2,pitch:.14,dist:3},
      "big-terminal":{position:{x:13.7,y:0,z:24.3},yaw:0,pitch:.13,dist:3}
    };
    // Stop the trailing camera before a partition; outer bounds remain in the shared framework.
    const clampCamera=(p,focus)=>{
      if(!focus)return;const dx=p.x-focus.x,dz=p.z-focus.z;let limit=1;
      for(const s of walls){
        let lo=0,hi=1;
        for(let axis=0;axis<2;axis++){
          const a=axis?focus.z:focus.x,d=axis?dz:dx,min=s[axis*2]-.2,max=s[axis*2+1]+.2;
          if(Math.abs(d)<1e-7){if(a<min||a>max){hi=-1;break;}}
          else{const v=(min-a)/d,w=(max-a)/d;lo=Math.max(lo,Math.min(v,w));hi=Math.min(hi,Math.max(v,w));}
        }
        if(hi>=lo&&hi>=0&&lo>0)limit=Math.min(limit,Math.max(0,lo-.035));
      }
      p.x=focus.x+dx*limit;p.z=focus.z+dz*limit;
    };
    return {id:"big-bitcoin",root,exitDoor,lighting,solids,seats,counts,walls,screen,kiosk,mediaAt:{x:13.7,y:0,z:24.3},groundAt:()=>0,ceiling:9.4,bounds:{minX:-20.65,maxX:20.65,minZ:-26.6,maxZ:26.55},spawn:{x:0,y:0,z:25.2},spawnYaw:0,followDistance:3,exit:{x:0,y:0,z:25.4},reviews,
      browseGoals:[{x:-5.3,z:16},{x:5.3,z:16},{x:0,z:4},{x:0,z:-18},...Object.values(reviews).map(v=>v.position),...seats.map(s=>s.walkAt)],clampCamera,
      tomatoContact:(x,y,z)=>y<.1||Math.abs(x)>20.8||Math.abs(z)>26.7
    };
  };
  BL.bigBitcoinRoom={build};
})();
