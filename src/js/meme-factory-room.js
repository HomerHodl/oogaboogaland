// Approved concept: charcoal media factory, red laser installation and warm working studio.
(() => {
  "use strict";
  const BL=window.BL,S=BL.scene,{block}=BL.dsbModels,sign=BL.memeFactorySign;
  const build=()=>{
    const root=S.createNode({visible:false}),solids=[],walls=[],seats=[],menuZones=[],D=BL.memeFactoryData;
    const C={steel:"#30383e",wall:"#34383a",black:"#131a20",amber:"#f3b970",red:"#f32c36",blue:"#6aaee9",white:"#e9dec7"};
    const group=(x=0,z=0,yaw=0)=>{const n=S.createNode({position:{x,y:0,z},rotation:{x:0,y:yaw,z:0}});S.addChild(root,n);return n;};
    const label=(p,t,x,y,z,size=.3,c=C.white)=>{const n=sign(p,t,x,y,z,size,c);n.depthBias=-.2;return n;};
    const prop=(kind,x,y,z,p=root,yaw=0)=>{const n=S.createNode({geometry:BL.dressing.memeFactory(kind),position:{x,y,z},rotation:{x:0,y:yaw,z:0}});S.addChild(p,n);return n;};
    const familiar=(kind,x,y,z,p=root)=>{const n=S.createNode({geometry:BL.dressing.withoutRulers(kind),position:{x,y,z}});S.addChild(p,n);return n;};
    const solid=(x,z,w,d,wall=false)=>{const b=[x-w/2,x+w/2,z-d/2,z+d/2];solids.push(b);if(wall)walls.push(b);};
    const zone=(route,title,x,z,rx,rz,priority=2)=>menuZones.push(BL.dsbMenuZones.zone(route,title,x,z,rx,rz,priority));
    const portrait=(p,id,x,y,z,size)=>{
      block(p,"#867153",x,y,z,size+.15,size+.15,.13);block(p,C.black,x,y,z+.08,size+.04,size+.04,.03);
      const n=S.createNode({geometry:BL.memeFactoryPortrait(id),position:{x,y,z:z+.105},scale:{x:size,y:size,z:1}});n.depthBias=-.2;S.addChild(p,n);return n;
    };
    const seat=(x,z,yaw=0,walkX=x,walkZ=z-1.65)=>{
      prop("chair",x,0,z,root,yaw);solid(x,z,1.42,1.03);
      seats.push({x,y:.53,z,ry:yaw+Math.PI,viewYaw:yaw,floor:0,walkAt:{x:walkX,z:walkZ},sitter:null,allowWeapons:true,lockMovement:true});
    };
    // Tiled shell: shared meshes also sort correctly in the Canvas fallback.
    for(let x=-16.5;x<18;x+=3)for(let z=-19.5;z<21;z+=3){block(root,(Math.round(x+z)%2)?"#565653":"#60605b",x,-.09,z,2.97,.18,2.97);block(root,"#1c242b",x,7.45,z,3,.15,3);}
    for(const x of [-18,18])for(let z=-19.5;z<21;z+=3)for(const y of [1.85,5.55])block(root,C.wall,x,y,z,.35,3.7,3);
    for(let x=-16.5;x<18;x+=3)for(const y of [1.85,5.55])block(root,C.wall,x,y,-21,3,3.7,.35);
    for(const x of [-10,10])block(root,C.wall,x,3.7,21,16,7.4,.35);block(root,C.wall,0,5.35,21,4,4.1,.35);
    const exitDoor=block(root,"#354450",0,1.5,20.8,2.8,3,.16);label(root,"CHORA",0,3.3,20.55,.4,C.blue).rotation.y=Math.PI;
    for(const z of [-19,-13,-7,-1,5,11,17]){
      for(const y of [6.93,7.26])block(root,C.steel,0,y,z,35.4,.1,.14);
      for(let x=-16;x<=16;x+=2){const n=block(root,"#566065",x,7.1,z,.075,.52,.08);n.rotation.z=.8;}
      for(const x of [-15,-7,0,7,15]){block(root,C.black,x,6.67,z,.43,.32,.43);block(root,C.amber,x,6.49,z,.26,.025,.26,.85);}
    }
    for(const x of [-17.5,17.5])for(const z of [-18,-10,-2,6,14]){block(root,C.steel,x,3.6,z,.26,7.2,.26);familiar("lantern",x,3.5,z);}
    for(const x of [-16,-6,6,16]){block(root,C.steel,x,6.85,0,.14,.14,41);block(root,"#936142",x+.19,6.84,0,.04,.04,41);}
    // Entry brand portal and side statements leave a generous view toward the laser room.
    for(const x of [-5.4,5.4]){block(root,C.black,x,1.8,9,.42,3.6,.55);solid(x,9,.42,.55,true);}
    block(root,C.black,0,4.1,9,11.4,1.05,.55);label(root,"THE MEME FACTORY",0,3.92,9.31,.92);label(root,"TM",5.0,4.36,9.32,.17);
    block(root,C.amber,0,3.53,9.32,10.6,.055,.045,.85);
    const statement=group(-10,17);
    block(statement,C.black,0,2.8,0,6.5,5.3,.23);solid(-10,17,6.5,.23,true);
    for(const [i,t] of ["THE MEME FACTORY","DOES NOT EXIST","WE ARE THE REASON","YOUR MOTHER HAS","LASER EYES IN HER","PROFILE PIC"].entries())label(statement,t,0,4.7-i*.61,.15,i<2?.39:.3,i<2?C.white:C.amber);
    const entryRight=group(10,17);block(entryRight,C.black,0,2.8,0,5.5,5.3,.23);solid(10,17,5.5,.23,true);
    for(const [i,t] of ["MEMES","PODCASTS","CREATORS","CULTURE","BITCOIN"].entries())label(entryRight,t,0,4.65-i*.7,.15,.5,C.blue);
    for(const x of [-14.2,-6,6,14.2]){familiar("planter",x,0,17.2);solid(x,17.2,.7,.7);}
    block(root,C.black,0,.022,17,7,.025,4.5);const floorWord=label(root,"BITCOIN",0,.055,17.7,.78,C.amber);floorWord.rotation.x=-Math.PI/2;
    zone("home","Explore Meme Factory",0,17,5,4);
    // Laser exhibit: portrait mosaic, radiant eye bars and suspended elliptical light ring.
    const laser=group(-8,-20.65);block(laser,C.black,0,3.5,0,17,6.8,.15);
    label(laser,"#LASERRAYUNTIL100K",0,6.02,.15,.67,C.red);
    portrait(laser,"chairforce",0,3.85,.15,4.1);
    for(const [i,id] of ["yellow","gregzaj","rd","plan-marcus"].entries())portrait(laser,id,i<2?-5.5:5.5,2.2+(i%2)*2.6,.18,2.1);
    for(const side of [-1,1]){
      block(laser,"#ff253b",side*.56,4.13,.34,.27,.17,.03,1);
      const ray=block(laser,C.red,side*2.55,4.3,.33,4.3,.035,.04,1);ray.rotation.z=side*.12;
    }
    for(let i=0;i<44;i++){
      const a=i*Math.PI*2/44,n=block(root,i%3?C.red:C.amber,-8+Math.cos(a)*7.7,6.22,-15.6+Math.sin(a)*4.2,Math.hypot(7.7*Math.sin(a),4.2*Math.cos(a))*Math.PI*2/44+.035,.045,.06,.95);n.rotation.y=Math.atan2(-4.2*Math.cos(a),-7.7*Math.sin(a));
    }
    for(const x of [-14,-2])block(root,C.steel,x,6.79,-15.6,.03,1.18,.03);
    for(const x of [-13,-9,-5])seat(x,-12.8,0,x,-11.05);
    block(root,"#352e32",-9,.49,-16,4.2,.98,1.5);label(root,"BITCOIN",-9,.52,-15.22,.44,C.amber);solid(-9,-16,4.2,1.5);familiar("lantern",-9,1.02,-16);
    const history=group(-16.2,-15,Math.PI/2);block(history,C.black,0,2.7,0,3.7,4.8,.16);
    for(const [i,t] of ["2021","PROFILE PICTURES","LASER EYES","UNTIL $100000","CHAIRFORCE_BTC","KNOW YOUR MEME"].entries())label(history,t,0,4.3-i*.59,.13,i===0?.5:.23,i===0?C.red:C.white);
    zone("laser","Explore #LaserRayUntil100K",-8,-15,9,5.7);
    // Gallery wraps the rear/right walls. One floor-accessible proximity per actual person.
    label(root,"THE MEME FACTORY CONTRIBUTORS",10.8,6.25,-20.6,.46,C.amber);
    D.contributors.forEach((p,i)=>{
      const back=i<6,x=back?4.8+i*2.2:17.55,z=back?-20.6:-16+(i-6)*2.85,yaw=back?0:-Math.PI/2,g=group(x,z,yaw);
      portrait(g,p.id,0,3.75,.1,1.86);label(g,p.name.toUpperCase(),0,2.49,.24,p.name.length>11?.19:.23);
      block(g,"#755d42",0,1.45,.2,2,.1,.7);familiar("lantern",.55,1.51,.2,g);
      zone(p.id,"View "+p.name,back?x:15.7,back?-18.3:z,back?1.05:1.3,back?1.4:1.32,3);
    });
    label(root,"CREATORS  CULTURE  BITCOIN",10,5.43,-20.55,.34,C.blue);
    zone("contributors","Meet the Contributors",10.6,-11,6.8,9.7,1);
    // Sound booth: timber acoustic treatment, studio window mullions, a real round-table layout.
    for(const x of [-4.5,4.5]){
      block(root,C.black,x,1,-3,.22,2,10.2);block(root,C.steel,x,5.2,-3,.24,.18,10.3);solid(x,-3,.25,10.3,true);
      for(const z of [-8,-5,-2,1.9])block(root,C.steel,x,3.55,z,.08,3.1,.08);
      for(const z of [-7,-4,-1]){const g=group(x*.982,z,x<0?Math.PI/2:-Math.PI/2);prop("acoustic",0,3.55,.03,g);}
      // Narrow tinted edges suggest glass; clear middle avoids transparent passes/targets.
      block(root,"#486b79",x,2.07,-3,.04,.08,10);block(root,"#486b79",x,5.06,-3,.04,.08,10);
    }
    block(root,C.wall,0,2.8,-8.2,9.2,5.6,.25);solid(0,-8.2,9.2,.25,true);
    for(const x of [-3.3,3.3]){block(root,C.black,x,2.65,2.1,2.3,5.3,.2);solid(x,2.1,2.3,.2,true);}
    block(root,C.black,0,5.2,2.1,9.2,.3,.3);block(root,"#6f262d",0,4.65,2.22,3.1,.8,.08);label(root,"ON AIR",0,4.61,2.29,.48,C.red);
    label(root,"RECORDING STUDIO",0,5.54,2.28,.5,C.amber);label(root,"THE MEME FACTORY",0,4.5,-8.01,.53);
    block(root,"#7c5b3e",0,1.01,-4,3.6,.18,2.25);block(root,C.black,0,.46,-4,1.1,.92,1.3);solid(0,-4,3.6,2.25);
    for(const x of [-2.9,2.9]){seat(x,-4,x<0?-Math.PI/2:Math.PI/2,x,-.3);prop("mic",x*.47,1.13,-4);}
    for(const x of [-3,3])prop("speaker",x,.2,-7.55);
    prop("console",0,0,5.8);solid(0,5.8,3.5,1.3);
    for(const x of [-1.15,1.15])prop("monitor",x,1.03,5.5);label(root,"PRODUCER / PODCAST",0,2.58,5.5,.32,C.blue);
    for(const x of [-3.6,3.6]){prop("rack",x,0,5.4);solid(x,5.4,1.15,.9);}
    zone("podcast","Listen to Podcast",0,-3,4.35,5.1);zone("podcast","Listen to Podcast",0,5.8,4.9,2.1);
    // Production benches: paired monitor arrays, export lights, rolling carts and overhead cable trays.
    let editingPortrait=0;
    for(const x of [-14,-8.7])for(const z of [1.5,7.9]){
      prop("desk",x,0,z);solid(x,z,3.8,1.65);
      for(const dx of [-.86,.86])prop("monitor",x+dx,1.09,z-.5);
      portrait(root,D.contributors[editingPortrait++*3].id,x-.95,1.91,z-.44,.62);
      prop("chair",x,0,z+1.6);solid(x,z+1.6,1.42,1.03);
      prop("box",x-1.05,.24,z);familiar("books",x+.9,1.09,z+.26);
      block(root,C.steel,x,6.26,z,4.2,.16,.34);block(root,C.amber,x,6.16,z,3.9,.025,.12,.7);
      for(const zz of [-.4,.4])block(root,"#312826",x-1.7,.085,z+zz,.035,.04,1.5);
    }
    const production=group(-17.6,4.7,Math.PI/2);block(production,C.black,0,4.8,0,6.1,2.2,.15);
    label(production,"IDEA  EDIT  EXPORT",0,5.05,.12,.42);label(production,"REPEAT",0,4.37,.12,.48,C.amber);
    for(const z of [-7,-3]){prop("rack",-17,0,z);solid(-17,z,1.15,.9);}
    for(const [x,z] of [[-12.2,-4],[-16.7,10.8]]){prop("cart",x,0,z);solid(x,z,1.2,.9);}
    label(root,"MEME PRODUCTION FLOOR",-11.4,5.55,-8.9,.45,C.blue);
    zone("home","Explore Meme Factory",-11.6,3,6,9);
    // Archive: drawers, labeled boxes, old media equipment and a reading bench.
    const archive=group(17.5,8.5,-Math.PI/2);label(archive,"MEME ARCHIVE",0,5.68,0,.61,C.amber);
    for(const x of [-4.4,0,4.4]){prop("files",x,0,.04,archive);prop("bookshelf",x,2.5,.04,archive);}
    solid(17.2,8.5,1,12.2);
    for(const x of [8.3,11.4,14.5]){prop("files",x,0,3.2);solid(x,3.2,2.8,.85);prop("box",x-.6,2.48,3.2);prop("box",x+.5,2.48,3.2);}
    block(root,"#816449",11.4,1,8.3,5.2,.15,2.2);for(const x of [9.2,13.6])block(root,C.steel,x,.46,8.3,.15,.92,1.9);solid(11.4,8.3,5.2,2.2);
    for(const x of [9.5,11,12.5])familiar("books",x,1.09,8.3);familiar("lantern",13.1,1.09,8.3);
    for(const x of [10.2,12.2])seat(x,12.5,0,x,10.85);
    label(root,"BITCOIN MEME CULTURE",11.4,4.6,3.36,.48);label(root,"2021  LASER EYES",11.4,3.93,3.36,.36,C.red);
    zone("home","Explore Meme Factory",11.4,9,5.8,7);
    for(const [x,z] of [[-16,12.4],[-16,-10],[2.7,-18],[14.8,15],[6,10],[13.7,-.2]]){familiar("planter",x,0,z);solid(x,z,.7,.7);}
    const lighting={clear:[.032,.034,.04],sky:[.46,.44,.42],ground:[.28,.25,.23],direct:[.75,.67,.55],directStrength:.3,ambientFloor:.36,sun:{x:.3,y:.9,z:.2},shadowCenter:{x:0,y:3,z:0},shadowExtent:28,shadowStrength:.22,bloomStrength:.35,fog:[.032,.034,.04],fogNear:65,fogFar:100,
      lights:new Float32Array([0,4.8,16,13,1,.65,.33,0,-8,4.8,-15,13,1,.13,.12,0,12,4.8,-12,12,.36,.57,.9,0,0,4.2,-3,8,1,.69,.4,0,-11,4.8,4,12,1,.67,.37,0,11,4.6,9,10,1,.69,.41,0]),lightCount:6};
    const reviews={
      "meme-entrance":{position:{x:0,y:0,z:18.5},yaw:0,pitch:.13,dist:3},
      "meme-laser":{position:{x:-8,y:0,z:-9.7},yaw:0,pitch:-.06,dist:3},
      "meme-contributors":{position:{x:10.8,y:0,z:-11.5},yaw:-.5,pitch:-.06,dist:3},
      "meme-yellow":{position:{x:9.2,y:0,z:-18.3},yaw:0,pitch:-.18,dist:3},
      "meme-production":{position:{x:-11.4,y:0,z:12},yaw:0,pitch:.16,dist:3},
      "meme-studio":{position:{x:0,y:0,z:9},yaw:0,pitch:.12,dist:3},
      "meme-recording":{position:{x:0,y:0,z:.2},yaw:0,pitch:.14,dist:3},
      "meme-archive":{position:{x:8,y:0,z:10.8},yaw:-1.35,pitch:-.08,dist:3}
    };
    const clampCamera=(p,focus)=>{
      if(!focus)return;const dx=p.x-focus.x,dz=p.z-focus.z;let limit=1;
      for(const s of walls){let lo=0,hi=1;for(let axis=0;axis<2;axis++){const a=axis?focus.z:focus.x,d=axis?dz:dx,mn=s[axis*2]-.2,mx=s[axis*2+1]+.2;if(Math.abs(d)<1e-8){if(a<mn||a>mx){lo=2;break;}}else{const t1=(mn-a)/d,t2=(mx-a)/d;lo=Math.max(lo,Math.min(t1,t2));hi=Math.min(hi,Math.max(t1,t2));}}if(lo<=hi&&lo>0)limit=Math.min(limit,Math.max(0,lo-.04));}
      p.x=focus.x+dx*limit;p.z=focus.z+dz*limit;
    };
    return {id:"meme-factory",root,lighting,exitDoor,solids,seats,menuZones,reviews,clampCamera,
      groundAt:()=>0,ceiling:7.4,spawnYaw:0,followDistance:3,spawn:{x:0,y:0,z:18.5},exit:{x:0,y:0,z:19.4},bounds:{minX:-17.55,maxX:17.55,minZ:-20.55,maxZ:20.45},
      browseGoals:Object.values(reviews).map(r=>r.position),tomatoContact:(x,y,z)=>y<.1||Math.abs(x)>17.7||Math.abs(z)>20.7,
      counts:{contributors:D.contributors.length,workstations:4,monitors:10,seats:seats.length,lights:6}
    };
  };
  BL.memeFactoryRoom={build};
})();
