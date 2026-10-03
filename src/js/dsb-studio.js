// A separate, cached room chunk. Coordinates and walk surfaces share the same stair specification.
(() => {
  "use strict";
  const BL=window.BL,{createNode,addChild}=BL.scene,{block,sign}=BL.dsbModels;
  const build=()=>{
    const root=createNode({visible:false}),seats=[],solids=[];
    const floor=(x,z)=>z>=8||Math.abs(x)>11.5&&z>=-4?3:z>=-4?(Math.abs(x)<1.6||Math.abs(x)>8.4?Math.ceil((z+4)/.8)*.2:Math.ceil((z+4)/3)*.75):z<-9?.6:z<-7?Math.min(3,Math.ceil((-z-7)/.667))*.2:0;
    block(root,"#27202b",0,-.22,1,31,.4,36);
    block(root,"#332933",-15.5,4.5,1,.4,9,36);block(root,"#332933",15.5,4.5,1,.4,9,36);
    block(root,"#24212b",0,9,1,31,.3,36);block(root,"#332933",0,4.5,19,31,9,.4);
    // Narrow arrival: archive on the left, enterable box office on the right.
    block(root,"#262333",-9.75,5.9,14.5,11.5,5.9,9);solids.push([-15.5,-4,10,19]);
    block(root,"#262333",11.25,5.9,14.5,8.5,5.9,9);solids.push([7,15.5,10,19]);
    block(root,"#584536",0,1.5,13.5,31,3,11);
    // Service wall: open window above the counter; a separate 2.4-unit doorway at its front.
    block(root,"#654839",2.6,3.65,15.2,.25,1.3,4);
    block(root,"#b48856",2.6,4.35,15.2,.8,.16,4.2);
    block(root,"#654839",2.6,6.45,15.2,.25,1.1,4);
    for(const z of [13.2,17.2])block(root,"#b48856",2.6,5.1,z,.25,1.65,.18);
    for(const z of [10.6,17.4]){block(root,"#49343b",4.8,5,z,4.4,4,.25);solids.push([2.6,7,z-.13,z+.13]);}
    solids.push([2.2,3,13.1,17.3]);
    block(root,"#a08364",4.8,7.1,14,4.5,.2,7);
    sign(root,"TICKETS",2.43,6.22,15.2,.42,"#ffd38a").rotation.y=-Math.PI/2;
    block(root,"#ffbf67",5,6.8,14,.55,.12,.55,.6);
    block(root,"#873f42",0,3.025,14,3.6,.05,10);
    block(root,"#263e57",0,4.55,18.8,2.2,3.1,.18);
    sign(root,"EXIT",0,6.35,18.6,.55,"#f4cc84").rotation.y=Math.PI;
    for(const z of [11,15,17.5])for(const x of [-3.95,2.45]){
      if(x>0&&z!==15)continue;
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
    // Small side galleries join the rear landing; rails keep their edge away from the stairs.
    for(const side of [-1,1]){
      const x=side*13.5;
      block(root,"#554039",x,1.5,2,4,3,12);
      block(root,"#873f42",x,3.025,2,3.4,.05,11.5);
      for(const z of [-4]){block(root,"#a08364",x,3.55,z,4,1.1,.12);solids.push([side<0?-15.5:11.5,side<0?-11.5:15.5,z-.06,z+.06]);}
      block(root,"#a08364",side*11.6,4.08,1.2,.1,.1,10.4);
      for(let z=-4;z<=6.4;z+=1.3)block(root,"#a08364",side*11.6,3.55,z,.09,1.1,.09);
      solids.push([side*11.6-.08,side*11.6+.08,-4,6.4]);
      for(const z of [-1,3.5]){
        const tx=side*14,cx=tx,sz=z+1.1,tz=z-1.6;
        addChild(root,createNode({geometry:BL.dressing.studio("lounge-table"),position:{x:tx,y:3,z:tz}}));
        addChild(root,createNode({geometry:BL.dressing.studio("seat"),position:{x:cx,y:3,z:sz}}));
        block(root,"#ffc878",tx,4.05,tz,.15,.25,.15,.65);
        seats.push({x:cx,y:3.65,z:sz,ry:Math.PI,floor:3,walkAt:{x:cx,z:sz-1.45},sitter:null,allowWeapons:true,lockMovement:true});
        solids.push([tx-.5,tx+.5,tz-.5,tz+.5],[cx-.66,cx+.66,sz-.42,sz+.55]);
      }
    }
    for(const x of [-13.3,13.3]){block(root,"#332933",x,4.5,-12.1,4.4,9,9.8);solids.push([x-2.2,x+2.2,-17,-7.2]);}
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
    block(root,"#86484b",-2.2,.64,-12.7,5.8,.07,4.9);
    // Fronts face +Z, toward the audience; backs sit toward the brick wall.
    for(const [x,yaw] of [[-3.7,Math.PI-.12],[-.7,Math.PI+.12]])prop("armchair",x,.68,-13).rotation.y=yaw;
    prop("table",-2.2,.68,-11.25);solids.push([-3.55,-.85,-11.85,-10.65],[-4.65,-2.75,-13.7,-12.3],[-1.65,.25,-13.7,-12.3]);
    for(const x of [-2.8,-1.6])block(root,"#f6d7a5",x,1.55,-11.25,.22,.27,.22);
    // Classic shallow wooden host desk, open behind for the host chair and access.
    prop("host-desk",-7.4,.65,-13.5);prop("armchair",-7.4,.65,-15.2).rotation.y=Math.PI;
    solids.push([-9.5,-5.3,-14.35,-12.65],[-8.3,-6.5,-15.85,-14.6]);
    for(const x of [-10,10]){block(root,"#5b3340",x,4,-16.35,1.4,7,.4);prop("speaker",x,.65,-15);}
    for(const z of [-10,-14]){
      block(root,"#3f4046",0,7.8,z,20,.22,.22);
      for(const x of [-7,0,7]){block(root,"#45434a",x,8.35,z,.09,1.1,.09);prop("light",x,7.35,z);}
    }
    prop("stool",6.2,3,15.5);solids.push([5.8,6.6,15.1,15.9]);
    block(root,"#e2caa1",2.7,4.49,14.5,.4,.12,.55);
    const jukebox=prop("jukebox",-3.25,3,14.3);jukebox.rotation.y=Math.PI/2;
    const title=sign(root,"DSB SPACES",-2.5,5.6,14.3,.37,"#ffd38a");title.rotation.y=Math.PI/2;
    solids.push([-4,-2.5,13.5,15.1]);
    sign(root,"ON AIR",0,6.5,9.15,.65,"#ee9869");
    const lights=new Float32Array(BL.glRenderer.POINT_LIGHT_CAPACITY*8);
    lights.set([5,5,-12,10,1.35,.85,.42,0,-5,4.5,-12,9,1.15,.72,.4,0,1,5,14,7,.65,.36,.16,0]);
    const lighting={clear:[.04,.03,.045],sky:[.34,.27,.26],ground:[.22,.16,.17],direct:[.66,.5,.35],directStrength:.24,ambientFloor:.35,sun:{x:.3,y:.9,z:.4},shadowCenter:{x:0,y:3,z:0},shadowExtent:22,shadowStrength:.2,bloomStrength:.3,fog:[.04,.03,.045],fogNear:55,fogFar:85,lights,lightCount:3};
    return {id:"dsb-studio",root,seats,solids,lighting,groundAt:floor,ceiling:9,spawnYaw:0,followDistance:3,
      spawn:{x:0,y:3,z:17},exit:{x:0,y:3,z:18.1},jukeboxAt:{x:-1.3,y:3,z:14.3},jukeboxSource:{x:-2.5,y:4.2,z:14.3},
      bounds:{minX:-15.15,maxX:15.15,minZ:-16.25,maxZ:18.5},
      tomatoContact:(ax,ay,az,p,seat)=>{
        const steps=Math.max(1,Math.ceil(Math.hypot(p.x-ax,p.y-ay,p.z-az)/.15));
        for(let i=1;i<=steps;i++){
          const k=i/steps,x=ax+(p.x-ax)*k,y=ay+(p.y-ay)*k,z=az+(p.z-az)*k;
          let hit=x<=-15.1||x>=15.1||z<=-16.5||z>=18.7||y>=8.7||y<=floor(x,z)+.12;
          if(!hit)for(const s of solids)if(!(seat&&seat.x>s[0]&&seat.x<s[1]&&seat.z>s[2]&&seat.z<s[3])&&x>s[0]&&x<s[1]&&z>s[2]&&z<s[3]&&y<floor(x,z)+(z>9?4:1.7)){hit=true;break;}
          if(hit){p.x=x;p.y=Math.max(floor(x,z)+.12,y);p.z=z;return true;}
        }
        return false;
      },
      clampCamera:(p,focus)=>{
        if(focus&&focus.z<10){p.z=Math.min(p.z,9.6);return;}
        if(focus&&focus.x>3&&focus.z>10.6&&focus.z<17.4){p.x=Math.max(3.4,Math.min(6.7,p.x));p.z=Math.max(11,Math.min(17.1,p.z));p.y=Math.min(6.7,p.y);}
        else if(p.z>10)p.x=Math.max(-2.1,Math.min(2,p.x));
        p.y=Math.max(4,p.y);
      }
    };
  };
  BL.dsbStudio={build};
})();
