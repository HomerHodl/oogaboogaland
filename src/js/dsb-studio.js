// A separate, cached room chunk. Coordinates and walk surfaces share the same stair specification.
(() => {
  "use strict";
  const BL=window.BL,{createNode,addChild}=BL.scene,{block,sign}=BL.dsbModels;
  const build=()=>{
    const root=createNode({visible:false}),seats=[],solids=[];
    const floor=(x,z)=>z>=8?3:z>=-4?(Math.abs(x)<1.6||Math.abs(x)>8.4?Math.ceil((z+4)/.8)*.2:Math.ceil((z+4)/3)*.75):z<-9?.6:z<-7?Math.min(3,Math.ceil((-z-7)/.667))*.2:0;
    block(root,"#27202b",0,-.22,1,23,.4,36);
    block(root,"#332933",-11.5,4.5,1,.4,9,36);block(root,"#332933",11.5,4.5,1,.4,9,36);
    block(root,"#24212b",0,9,1,23,.3,36);block(root,"#332933",0,4.5,19,23,9,.4);
    // Rear corridor has a right-hand kiosk alcove; its opening reveals the full descending room.
    block(root,"#262333",-6.95,5.9,14,9.1,5.9,10);solids.push([-11.5,-2.4,9,19]);
    block(root,"#262333",8,5.9,14,7,5.9,10);solids.push([4.5,11.5,9,19]);
    block(root,"#584536",0,1.5,13.5,23,3,11);
    block(root,"#873f42",0,3.025,14,3.6,.05,10);
    block(root,"#263e57",0,4.55,18.8,2.2,3.1,.18);
    sign(root,"EXIT",0,6.35,18.6,.55,"#f4cc84").rotation.y=Math.PI;
    for(const z of [11,15,17.5])for(const x of [-2.35,4.4]){
      block(root,"#2a2529",x,4.3,z,.18,.65,.4);
      block(root,"#ffbf67",x,4.3,z,.21,.35,.26,.8);
    }
    // Seat tiers and the two side stairways plus central aisle. No hidden slope underneath.
    for(let row=0;row<4;row++){
      const y=(row+1)*.75,z=-2.5+row*3;
      for(const x of [-5,5])block(root,"#554039",x,y/2,z,6.8,y,3);
      for(const side of [-1,1])for(let col=0;col<3;col++){
        const x=side*(2.5+col*2.05),sz=z+.4;
        const chair=createNode({geometry:BL.dressing.studio("seat"),position:{x,y,z:sz}});addChild(root,chair);
        const seat={x,y:y+.65,z:sz,ry:Math.PI,floor:y,walkAt:{x,z:sz-1.45},sitter:null,allowWeapons:true,lockMovement:true};
        seats.push(seat);solids.push([x-.66,x+.66,sz-.42,sz+.55]);
      }
    }
    for(let step=0;step<15;step++){
      const y=(step+1)*.2,z=-3.6+step*.8;
      for(const [x,w] of [[0,3.2],[-9.9,3],[9.9,3]]){
        block(root,"#6c5650",x,y/2,z,w,y,.8);
        block(root,"#e2af65",x,y+.018,z-.35,w,.035,.07,.25);
      }
    }
    // Railings frame the side aisles without crossing row entrances or the central stairs.
    for(const x of [-10.9,10.9])for(let i=0;i<8;i++){
      const z=-3.2+i*1.5,y=floor(x,z);
      block(root,"#a08364",x,y+.55,z,.09,1.1,.09);
      const rail=block(root,"#a08364",x,y+1.08,z+.65,.1,.1,1.6);rail.rotation.x=-.24;
    }
    // Stage and shallow, full-width steps. Raised only sixty centimetres above the lower floor.
    block(root,"#80583a",0,.3,-13,22,.6,8);
    for(let i=0;i<3;i++)block(root,"#a4774d",0,(i+1)*.1,-7.333-i*.667,22,(i+1)*.2,.667);
    for(let x=-10.5;x<11;x+=.75)block(root,"#a4774d",x,.615,-13,.025,.025,8);
    block(root,"#69483d",0,4.4,-17,23,9,.35);
    for(let row=0;row<14;row++)for(let col=0;col<17;col++){
      const x=-10.6+col*1.3+(row%2)*.6;
      if(x>11)continue;
      block(root,["#a95c43","#94533f","#b56749"][(row+col)%3],x,.45+row*.49,-16.78,1.23,.43,.14);
    }
    block(root,"#2b252d",0,5.15,-16.56,10.5,2.05,.14);
    sign(root,"DSB Studio",.45,4.8,-16.4,1.1,"#ffd99b");
    // Microphone emblem, alongside the lettering.
    block(root,"#ffc878",-4.2,5.55,-16.35,.32,.72,.13,.7);
    block(root,"#ffc878",-4.2,4.95,-16.35,.09,.65,.13,.7);block(root,"#ffc878",-4.2,4.62,-16.35,.7,.1,.13,.7);
    const prop=(kind,x,y,z)=>{const n=createNode({geometry:BL.dressing.studio(kind),position:{x,y,z}});addChild(root,n);return n;};
    block(root,"#b98a56",5,.63,-12,5,.04,4);prop("mic",5,.65,-12.1);prop("stool",7,.65,-13.2);
    block(root,"#86484b",-4.5,.64,-12.8,7,.07,5);
    for(const x of [-6.6,-2.5])prop("armchair",x,.68,-13.5);
    prop("table",-4.55,.68,-11.9);solids.push([-5.9,-3.2,-12.5,-11.3],[-7.5,-5.7,-14.2,-12.8],[-3.4,-1.6,-14.2,-12.8]);
    for(const x of [-5.2,-4])block(root,"#f6d7a5",x,1.55,-11.9,.22,.27,.22);
    for(const x of [-10,10]){block(root,"#5b3340",x,4,-16.35,1.4,7,.4);prop("speaker",x,.65,-15);}
    for(const z of [-10,-14]){
      block(root,"#3f4046",0,7.8,z,20,.22,.22);
      for(const x of [-7,0,7]){block(root,"#45434a",x,8.35,z,.09,1.1,.09);prop("light",x,7.35,z);}
    }
    const jukebox=prop("jukebox",3.25,3,14.3);jukebox.rotation.y=-Math.PI/2;
    const title=sign(root,"DSB SPACES",2.5,5.6,14.3,.37,"#ffd38a");title.rotation.y=-Math.PI/2;
    solids.push([2.5,4,13.5,15.1]);
    prop("table",3.2,3,11.3);solids.push([1.9,4.5,10.7,11.9]);
    sign(root,"ON AIR",0,6.5,9.15,.65,"#ee9869").rotation.y=Math.PI;
    const lights=new Float32Array(BL.glRenderer.POINT_LIGHT_CAPACITY*8);
    lights.set([5,5,-12,10,1.35,.85,.42,0,-5,4.5,-12,9,1.15,.72,.4,0,1,5,14,7,.65,.36,.16,0]);
    const lighting={clear:[.04,.03,.045],sky:[.34,.27,.26],ground:[.22,.16,.17],direct:[.66,.5,.35],directStrength:.24,ambientFloor:.35,sun:{x:.3,y:.9,z:.4},shadowCenter:{x:0,y:3,z:0},shadowExtent:22,shadowStrength:.2,bloomStrength:.3,fog:[.04,.03,.045],fogNear:55,fogFar:85,lights,lightCount:3};
    return {id:"dsb-studio",root,seats,solids,lighting,groundAt:floor,ceiling:9,spawnYaw:0,followDistance:3,
      spawn:{x:0,y:3,z:17},exit:{x:0,y:3,z:18.1},jukeboxAt:{x:1.2,y:3,z:14.3},
      bounds:{minX:-11.15,maxX:11.15,minZ:-16.25,maxZ:18.5},
      clampCamera:p=>{if(p.z>9){p.x=Math.max(-2.1,Math.min(4.1,p.x));p.y=Math.max(4, p.y);}},
      toggleLights:()=>{const comedy=lights[12]>.8;lights[4]=comedy?1.8:1.35;lights[12]=comedy?.55:1.15;return comedy?"Comedy spotlight":"Talk-show lighting";}
    };
  };
  BL.dsbStudio={build};
})();
