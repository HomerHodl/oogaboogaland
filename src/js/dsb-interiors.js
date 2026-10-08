// Shared entry, exit, collision and audio contracts for approved DSB venues.
(() => {
  "use strict";
  const BL=window.BL, {addChild,removeChild}=BL.scene;
  // Only implemented interiors register here. Later venues supply the same room contract.
  const definitions=[{id:"meme-factory",building:"Meme Factory House",ambience:"meme-factory",build:BL.memeFactoryRoom.build},{id:"dsb-studio",building:"DSB Studio Stage",ambience:"studio",build:BL.dsbStudio.build},{id:"maxis-club",building:"Maxis Club Theater",ambience:"studio",build:BL.maxisClub.build},{id:"without-rulers",building:"Without Rulers Shop",ambience:"shop",build:BL.withoutRulersShop.build},{id:"proof-of-ink",building:"Proof Of Ink",ambience:"shop",build:BL.proofOfInkRoom.build},{id:"big-bitcoin",building:"Big Bitcoin",ambience:"shop",build:BL.bigBitcoinRoom.build},{id:"stackchain-magazine",building:"Stackchain Magazine",ambience:"shop",build:BL.stackchainRoom.build},{id:"svrn-society",building:"VACANT 2",label:"SVRN Society",ambience:"shop",build:BL.svrnRoom.build}];
  const create=({root,exterior,land,weather,relocate,lock,onChange})=>{
    const rooms=new Map(),registry=new Map(),entries=[];
    const exteriorGround=land.groundAt||land.heightAt;
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
      if(!room){room=definition.build();room.menuZones=BL.dsbMenuZones.forRoom(room);rooms.set(definition.id,room);addChild(root,room.root);}
      return room;
    };
    const swap=definition=>{
      if(active)active.room.root.visible=false;
      active=definition?{definition,room:roomFor(definition)}:null;
      exterior.visible=!active;weather.setInterior(!!active);audio.update(weather.shared.state.muted);audio.setActive(!!active,active?.definition.ambience);
      if(active)active.room.root.visible=true;
      onChange(active?active.room.lighting:null,active?(active.definition.label||active.definition.building.name):"DSB LAND · CHORA");
      const point=active?active.room.spawn:pending.returnPoint;
      relocate(point,active?active.room.spawnYaw:pending.building.yaw,active?active.room.followDistance:7);
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
    const clampCamera=(p,focus)=>{
      if(!active){p.y=Math.max(p.y,exteriorGround(p.x,p.z)+1);return;}
      const b=active.room.bounds;
      p.x=Math.max(b.minX+.2,Math.min(b.maxX-.2,p.x));p.z=Math.max(b.minZ+.2,Math.min(b.maxZ-.2,p.z));
      p.y=Math.max(active.room.groundAt(p.x,p.z)+.74,Math.min(active.room.ceiling-.7,p.y));
      active.room.clampCamera?.(p,focus);
    };
    return {registry,rooms,audio,
      get lighting(){return active?.room.lighting||null;},request,target,update,walkable,clampCamera,
      get active(){return active;},get transitioning(){return fade>0;},
      get fade(){return fade>.18?( .36-fade)/.18:fade/.18;},
      groundAt:(x,z)=>active?active.room.groundAt(x,z):exteriorGround(x,z),
      review:(id,inside)=>{if(active||fade>0)return;const d=registry.get(id);if(!d)return;relocate(d.entry,d.building.yaw,7);if(inside)request(d.entry);},
      dispose:()=>{disposed=true;audio.dispose();weather.setInterior(false);for(const room of rooms.values())removeChild(root,room.root);rooms.clear();registry.clear();entries.length=0;active=pending=null;}
    };
  };
  BL.dsbInteriors={create,definitions};
})();
