// Meme Factory room selectively restored from redesign 75cb039; no old world/scene code.
(() => {
  "use strict";
  const BL=window.BL, {createNode,addChild,removeChild}=BL.scene;
  const {block,sign,C}=BL.dsbModels;
  const factoryLighting={clear:[.055,.05,.04],sky:[.58,.53,.44],ground:[.31,.27,.21],
      direct:[.7,.64,.51],directStrength:.35,ambientFloor:.4,sun:{x:.2,y:.9,z:.4},
      shadowCenter:{x:0,y:2,z:0},shadowExtent:18,shadowStrength:.25,bloomStrength:.3,
      fog:[.055,.05,.04],fogNear:50,fogFar:90};

  const buildMemeFactoryInterior = () => {
    // Interiors are deliberately "bigger on the inside": a separate chunk with its own dimensions.
    const root=createNode({ visible:false });

    // Room shell: ~29 x 21 world units, much roomier than the exterior house.
    block(root,"#575350",0,-0.08,0,29,0.16,21);
    for(let x=-13;x<=13;x+=2) block(root,"#e8e1d8",x,0.03,0,0.08,0.04,21);
    for(let z=-9;z<=9;z+=2) block(root,"#e8e1d8",0,0.04,z,29,0.04,0.08);
    block(root,"#f6f1e8",-14.4,3.8,0,0.55,7.6,21);
    block(root,"#f6f1e8", 14.4,3.8,0,0.55,7.6,21);
    block(root,"#f6f1e8",0,3.8,-10.3,29,7.6,0.55);
    // Front wall leaves a generous blue-doored opening.
    block(root,"#f6f1e8",-8.1,3.8,10.3,12.8,7.6,0.55);
    block(root,"#f6f1e8", 8.1,3.8,10.3,12.8,7.6,0.55);
    block(root,"#f6f1e8",0,6.45,10.3,3.4,2.3,0.55);
    for(let x=-13.2;x<=13.2;x+=1.45) block(root,"#8a6646",x,7.35,0,0.18,0.18,20.4);

    block(root,"#f6f1e8",0,7.65,0,29,.2,21);

    // Exit door / threshold.
    const exitDoor=createNode({ position:{x:0,y:0,z:9.95} }); addChild(root,exitDoor);
    block(exitDoor,"#2d6fa8",0,1.55,0,2.4,3.1,0.2);
    sign(root,"EXIT",0,4.4,9.8,0.5,"#59b9df").rotation.y=Math.PI;

    // Larger counter zone leaves room for future tenant content behind it.
    const counter=createNode({ position:{x:0,y:0,z:-5.2} }); addChild(root,counter);
    block(counter,"#8a6646",0,1.05,0,13.5,2.1,2.2);
    block(counter,"#f0d99b",0,2.18,0,14,0.2,2.5);
    sign(root,"MEME FACTORY",0,5.15,-10.0,0.85,C.yellow);

    // Merchandise islands / production tables.
    for(let row=0;row<2;row++) for(let i=0;i<5;i++){
      const x=-8+i*4, z=1.4+row*3.6;
      block(root,"#7f6042",x,0.5,z,2.2,1,1.8);
      if((i+row)%2===0){
        const banana=BL.models.banana(); banana.position.x=x; banana.position.y=1.3; banana.position.z=z; addChild(root,banana);
      } else block(root,"#ef4256",x,1.2,z,0.8,0.8,0.8);
    }

    // Meme gallery wall.
    const captions=["STACK","HODL","OOGA","21M","MEMES"];
    for(let i=0;i<captions.length;i++){
      const z=-7.2+i*3.25;
      block(root,i%2?"#c7e3ee":"#f2d79a",-14.05,2.9,z,0.18,2.9,2.6);
      const caption=sign(root,captions[i],-13.91,2.5,z,0.35,i%2?"#2865a3":"#8f5a2c");
      caption.rotation.y=Math.PI/2;
    }

    // Lounge corner and plants.
    block(root,"#386ea0",10.7,0.68,5.8,5.2,1.35,1.8);
    block(root,"#e8ddc7",10.7,0.62,3.2,2.8,0.18,2.8);
    for(const [x,z] of [[12.5,8.2],[-12.0,8.0]]){
      block(root,"#b8754b",x,0.38,z,0.72,0.76,0.72);
      block(root,"#568744",x,1.25,z,1.5,1.7,1.5);
    }

    // Swept, radius-expanded floor-plan blockers. Tiny exhibits do not get individual colliders.
    const solids=[[-7,7,-6.45,-3.95],[8.1,13.3,4.9,6.7],[9.3,12.1,1.8,4.6]];
    for(let row=0;row<2;row++)for(let i=0;i<5;i++){
      const x=-8+i*4,z=1.4+row*3.6;solids.push([x-1.1,x+1.1,z-.9,z+.9]);
    }

    // Room navigation metadata travels with its builder.
    return {
      id:"meme-factory",lighting:factoryLighting,groundAt:()=>.06,ceiling:7.6,spawnYaw:0,followDistance:3,
      root,
      exitDoor,
      counter,
      spawn:{x:0,y:.06,z:8.2},
      exit:{x:0,y:0,z:9.1},
      counterAt:{x:0,y:0,z:-3.9},
      solids,
      bounds:{minX:-13.7,maxX:13.7,minZ:-9.6,maxZ:9.5}
    };
  };


  // Only implemented interiors register here. Later venues supply the same room contract.
  const definitions=[{id:"meme-factory",building:"Meme Factory House",ambience:"meme-factory",build:buildMemeFactoryInterior}];
  const create=({root,exterior,land,weather,relocate,lock,onChange})=>{
    const rooms=new Map(),registry=new Map(),entries=[];
    for(const definition of definitions){
      const building=land.buildings.find(b=>b.name===definition.building);
      if(!building)continue;
      const x=building.x+Math.sin(building.yaw)*(building.d/2+1.6);
      const z=building.z+Math.cos(building.yaw)*(building.d/2+1.6);
      const entry={x,y:land.heightAt(x,z),z};
      const entryDefinition={...definition,building,entry,returnPoint:entry};
      registry.set(definition.id,entryDefinition);entries.push(entryDefinition);
    }
    const audio=BL.dsbInteriorAudio.create();
    let active=null,pending=null,fade=0,swapped=false,disposed=false;
    const near=(position,point,radius)=>Math.hypot(position.x-point.x,position.z-point.z)<radius&&Math.abs(position.y-point.y)<4;
    const target=position=>{
      if(active)return near(position,active.room.exit,2.4)?active.definition:null;
      for(let i=0;i<entries.length;i++)if(near(position,entries[i].entry,2.5))return entries[i];
      return null;
    };
    const roomFor=definition=>{
      let room=rooms.get(definition.id);
      if(!room){room=definition.build();rooms.set(definition.id,room);addChild(root,room.root);}
      return room;
    };
    const swap=definition=>{
      if(active)active.room.root.visible=false;
      active=definition?{definition,room:roomFor(definition)}:null;
      exterior.visible=!active;weather.setInterior(!!active);audio.update(weather.shared.state.muted);audio.setActive(active?.definition.ambience==="meme-factory");
      if(active)active.room.root.visible=true;
      onChange(active?active.room.lighting:null,active?active.definition.building.name:"DSB LAND · CHORA");
      const point=active?active.room.spawn:pending.returnPoint;
      relocate(point,active?active.room.spawnYaw:pending.building.yaw+Math.PI,active?active.room.followDistance:7);
    };
    const request=position=>{
      if(fade>0)return true;
      const definition=target(position);if(!definition)return false;
      pending=definition;swapped=false;fade=.36;lock(true);return true;
    };
    const update=dt=>{
      if(disposed)return;
      if(fade>0){
        fade=Math.max(0,fade-dt);
        if(!swapped&&fade<=.18){swap(active?null:pending);swapped=true;}
        if(fade===0){pending=null;lock(false);}
      }
      audio.update(weather.shared.state.muted);
    };
    const walkable=(ax,az,bx,bz,y,height,actor)=>{
      if(!active)return land.walkable(ax,az,bx,bz,y,height,actor);
      const r=actor?.bodyRadius||.4,b=active.room.bounds,steps=Math.max(1,Math.ceil(Math.hypot(bx-ax,bz-az)/.2));
      for(let i=0;i<=steps;i++){
        const x=ax+(bx-ax)*i/steps,z=az+(bz-az)*i/steps;
        if(x<b.minX+r||x>b.maxX-r||z<b.minZ+r||z>b.maxZ-r)return false;
        for(const s of active.room.solids)if(x>s[0]-r&&x<s[1]+r&&z>s[2]-r&&z<s[3]+r)return false;
      }
      return true;
    };
    const clampCamera=p=>{
      if(!active){p.y=Math.max(p.y,land.heightAt(p.x,p.z)+1);return;}
      const b=active.room.bounds;
      p.x=Math.max(b.minX+.2,Math.min(b.maxX-.2,p.x));p.z=Math.max(b.minZ+.2,Math.min(b.maxZ-.2,p.z));
      p.y=Math.max(active.room.groundAt(p.x,p.z)+.74,Math.min(active.room.ceiling-.7,p.y));
    };
    return {registry,rooms,audio,
      get lighting(){return active?.room.lighting||null;},request,target,update,walkable,clampCamera,
      get active(){return active;},get transitioning(){return fade>0;},
      get fade(){return fade>.18?( .36-fade)/.18:fade/.18;},
      groundAt:(x,z)=>active?active.room.groundAt(x,z):land.heightAt(x,z),
      review:(id,inside)=>{if(active||fade>0)return;const d=registry.get(id);if(!d)return;relocate(d.entry,d.building.yaw,7);if(inside)request(d.entry);},
      dispose:()=>{disposed=true;audio.dispose();weather.setInterior(false);for(const room of rooms.values())removeChild(root,room.root);rooms.clear();registry.clear();entries.length=0;active=pending=null;}
    };
  };
  BL.dsbInteriors={create,definitions};
})();
