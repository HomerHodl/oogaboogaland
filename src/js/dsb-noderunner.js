// Historical blue waterfront taverna/pergola adapted to the approved harbor facade.
(() => {
  "use strict";
  const BL=window.BL,S=BL.scene,{block,sign}=BL.dsbModels;
  const create=({root,land})=>{
    const building=land.buildings.find(b=>b.name==="Noderunner waterfront");
    const group=S.createNode({position:{x:building.x,y:0,z:building.z},rotation:{x:0,y:building.yaw,z:0}});
    S.addChild(root,group);
    const c=Math.cos(building.yaw),s=Math.sin(building.yaw),glows=[],contacts=[];
    const at=(x,z)=>({x:building.x+c*x+s*z,z:building.z-s*x+c*z});
    const ground=(x,z)=>{const p=at(x,z);return land.heightAt(p.x,p.z);};
    const foot=(color,x,z,w,h,d)=>{
      // Seat every prop's bottom on the highest sampled footprint corner.
      const y=Math.max(ground(x-w/2,z-d/2),ground(x+w/2,z-d/2),ground(x-w/2,z+d/2),ground(x+w/2,z+d/2));
      contacts.push({x,z,w,d,y});return block(group,color,x,y+h/2,z,w,h,d);
    };
    const roof=building.floor+4.65;
    block(group,"#2b6599",0,building.floor+5.08,0,11.4,.22,8.3);
    sign(group,"NODERUNNER",0,building.floor+3.85,4.12,.9,"#4fb7d5");
    // Screen and mixer stay on the exterior face; no interior or old stream UI is restored.
    block(group,"#78543b",0,building.floor+2.3,4.14,5.8,2.5,.22);
    block(group,"#142d35",0,building.floor+2.3,4.28,5.35,2.1,.12);
    sign(group,"HARBOR RADIO",0,building.floor+2.6,4.38,.43,"#49ddd9");
    sign(group,"OOGA FM",0,building.floor+1.85,4.38,.48,"#ffdf38");
    const console=foot("#78543b",0,4.35,4.8,1.05,.55);
    block(group,"#283d46",0,console.position.y+.6,4.35,5,.14,.7);
    for(const x of [-1.4,1.4])block(group,"#25252d",x,console.position.y+.7,4.35,.8,.08,.45);
    for(const x of [-3.7,3.7]){
      const speaker=foot("#28313c",x,4.3,1.15,2.1,.42);
      for(const dy of [-.5,.35])block(group,"#101d26",x,speaker.position.y+dy,4.55,.74,.66,.08);
    }
    // Slender outdoor pergola: road remains beyond the front posts.
    for(const x of [-4.6,4.6])for(const z of [4.45,6.45]){
      const y=ground(x,z);contacts.push({x,z,w:.18,d:.18,y});
      block(group,"#2f6fa5",x,(y+roof)/2,z,.18,roof-y,.18);
    }
    for(const z of [4.45,5.1,5.75,6.45])block(group,"#7e5c3c",0,roof,z,9.4,.15,.16);
    for(const x of [-4.6,0,4.6])block(group,"#2f6fa5",x,roof-.12,5.45,.16,.18,2.25);
    for(const x of [-4.4,4.4]){
      const bench=foot("#e7ddc8",x,5.3,1.15,.65,.6);
      block(group,"#386ea0",x,bench.position.y+.58,5.03,1.15,.6,.12);
      const lamp=block(group,"#ffe2a4",x,roof-.38,6.4,.24,.34,.24,.1);glows.push(lamp);
    }
    // Small port details beside the equipment, clear of the promenade and doors.
    for(const x of [-5,5]){
      const crate=foot("#8b7047",x,3.65,.75,.7,.65);
      block(group,"#c5ab79",x,crate.position.y+.2,3.65,.8,.12,.7);
    }
    const source=at(0,4.8);source.y=ground(0,4.8)+1.4;
    const review=at(0,9.5);review.y=land.heightAt(review.x,review.z);
    const solids=BL.solidProps.create();S.updateWorld(group);solids.add(group);solids.sync();
    let audio=null,distance=Infinity;
    return {group,building,source,review,contacts,solids,
      createAudio:(context,master)=>audio=BL.dsbRadio.create(context,master),
      update:(dt,listener,state,lampFactor)=>{
        distance=Math.hypot(listener.x-source.x,listener.y-source.y,listener.z-source.z);
        if(audio)audio.update(dt,distance,state.audioEnabled);
        for(let i=0;i<glows.length;i++)glows[i].glow=lampFactor*.65;
      },
      clearSegment:(ax,az,bx,bz,y,h,actor)=>solids.segmentClear(ax,y,az,bx,land.heightAt(bx,bz),bz,actor?.bodyRadius||.4,h),
      get audio(){return audio;},
      get stats(){return {distance,target:audio?audio.stats.target:0,level:audio?audio.stats.level:0,sources:audio?audio.stats.sources:0};},
      dispose:()=>{solids.remove(group);S.removeChild(root,group);}
    };
  };
  BL.dsbNoderunner={create};
})();
