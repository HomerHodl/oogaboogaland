// A separate, cached room chunk. Coordinates and walk surfaces share the same stair specification.
(() => {
  "use strict";
  const BL=window.BL,{createNode,addChild}=BL.scene,{block,sign}=BL.dsbModels;
  const build=()=>{
    const root=createNode({visible:false}),seats=[],solids=[];
    const floor=(x,z)=>z>=8||Math.abs(x)>11.5&&z>=-4?3:z>=-4?(Math.abs(x)<1.6||Math.abs(x)>8.4?Math.ceil((z+4)/.8)*.2:Math.ceil((z+4)/3)*.75):z<-9?.6:z<-7?Math.min(3,Math.ceil((-z-7)/.667))*.2:0;
    block(root,"#27202b",0,-.22,1,31,.4,36);
    block(root,"#242329",-15.5,3.2,1,.4,6.4,36);block(root,"#242329",15.5,3.2,1,.4,6.4,36);
    block(root,"#1c1c22",0,6.4,1,31,.3,36);block(root,"#242329",0,3.2,19,31,6.4,.4);
    // Narrow arrival: archive on the left, enterable box office on the right.
    block(root,"#242329",-9.75,4.65,14.5,11.5,3.3,9);solids.push([-15.5,-4,10,19]);
    block(root,"#242329",11.25,4.65,14.5,8.5,3.3,9);solids.push([7,15.5,10,19]);
    block(root,"#584536",0,1.5,13.5,31,3,11);
    // Yellow's head top is 1.29 above the floor, with the lower face at .95. The sill clears the whole face.
    // Service wall keeps the same footprint and separate 2.4-unit doorway.
    block(root,"#654839",2.6,3.295,15.2,.25,.59,4);
    block(root,"#b48856",2.6,3.67,15.2,.8,.16,4.2);
    block(root,"#654839",2.6,5.185,15.2,.25,1.57,4);
    for(const z of [13.2,17.2])block(root,"#b48856",2.6,4.075,z,.25,.65,.18);
    for(const z of [10.6,17.4]){block(root,"#49343b",4.8,4.5,z,4.4,3,.25);solids.push([2.6,7,z-.13,z+.13]);}
    solids.push([2.2,3,13.1,17.3]);
    block(root,"#a08364",4.8,6.05,14,4.5,.2,7);
    sign(root,"TICKETS",2.43,4.75,15.2,.32,"#ffd38a").rotation.y=-Math.PI/2;
    block(root,"#ffbf67",5,5.85,14,.55,.12,.55,.6);
    // A low, dark corridor compresses the approach before the open rear gallery.
    block(root,"#222126",-.7,5.95,14.4,6.6,.2,9.2);
    block(root,"#57272f",0,3.025,14,3.6,.05,10);
    for(const x of [-1.65,1.65])block(root,"#9b754b",x,3.057,14,.05,.015,10);
    for(const z of [10,12.5,15,17.5]){
      block(root,"#3b2b27",-.7,5.78,z,6.6,.18,.2);
      block(root,"#44302a",-3.91,4.4,z,.16,2.8,.16);
    }
    block(root,"#44302a",-3.88,3.38,14.5,.16,.76,9);
    block(root,"#8e6545",-3.8,3.78,14.5,.12,.08,9);
    block(root,"#263e57",0,4.55,18.8,2.2,3.1,.18);
    sign(root,"EXIT",0,5.3,18.6,.45,"#f4cc84").rotation.y=Math.PI;
    for(const z of [11,15,17.5])for(const x of [-3.95,2.45]){
      if(x>0&&z!==15)continue;
      block(root,"#2a2529",x,x>0?3.35:4.3,z,.18,x>0?.5:.65,.4);
      block(root,"#ffbf67",x,x>0?3.35:4.3,z,.21,x>0?.25:.35,.26,.8);
    }
    // Seat tiers and the two side stairways plus central aisle. No hidden slope underneath.
    for(let row=0;row<4;row++){
      const y=(row+1)*.75,z=-2.5+row*3;
      for(const x of [-5,5])block(root,"#554039",x,y/2,z,6.8,y,3);
      for(const side of [-1,1])for(let col=0;col<4;col++){
        const x=side*(2.4+col*1.6),sz=z+.4;
        const chair=createNode({geometry:BL.dressing.studio("seat"),position:{x,y,z:sz}});chair.scale.y=.75;addChild(root,chair);
        const seat={x,y:y+.4875,z:sz,ry:Math.PI,floor:y,walkAt:{x,z:sz-1.45},sitter:null,allowWeapons:true,lockMovement:true};
        seats.push(seat);solids.push([x-.66,x+.66,sz-.42,sz+.55]);
      }
    }
    for(let step=0;step<15;step++){
      const y=(step+1)*.2,z=-3.6+step*.8;
      for(const [x,w] of [[0,3.2],[-9.9,3],[9.9,3]]){
        block(root,"#6c5650",x,y/2,z,w,y,.8);
        block(root,"#a1784f",x,y+.018,z-.35,w,.035,.07);
        if(step%3===0)for(const edge of [-1,1])block(root,"#ffc878",x+edge*(w/2-.16),y+.025,z-.3,.16,.035,.2,.5);
      }
    }
    // Railings frame the side aisles without crossing row entrances or the central stairs.
    for(const x of [-10.9,10.9])for(let i=0;i<8;i++){
      const z=-3.2+i*1.5,y=floor(x,z);
      block(root,"#282930",x,y+.55,z,.09,1.1,.09);
      const rail=block(root,"#584339",x,y+1.08,z+.65,.1,.1,1.6);rail.rotation.x=-.24;
    }
    // Small side galleries join the rear landing; rails keep their edge away from the stairs.
    for(const side of [-1,1]){
      const x=side*13.5;
      block(root,"#554039",x,1.5,2,4,3,12);
      block(root,"#57272f",x,3.025,2,3.4,.05,11.5);
      for(const z of [-4]){for(const y of [3.2,3.65,4.08])block(root,"#303037",x,y,z,4,.08,.12);
        for(let dx=-1.9;dx<2;dx+=.48)block(root,"#303037",x+dx,3.6,z,.07,1,.1);solids.push([side<0?-15.5:11.5,side<0?-11.5:15.5,z-.06,z+.06]);}
      for(const y of [3.2,3.65,4.08])block(root,"#303037",side*11.6,y,1.2,.1,.09,10.4);
      for(let z=-4;z<=6.4;z+=.52)block(root,"#303037",side*11.6,3.55,z,.07,1.1,.07);
      solids.push([side*11.6-.08,side*11.6+.08,-4,6.4]);
      for(const z of [-1,3.5]){
        const tx=side*14,cx=tx,sz=z+1.1,tz=z-1.6;
        addChild(root,createNode({geometry:BL.dressing.studio("lounge-table"),position:{x:tx,y:3,z:tz}}));
        const chair=createNode({geometry:BL.dressing.studio("seat"),position:{x:cx,y:3,z:sz}});chair.scale.y=.75;addChild(root,chair);
        block(root,"#ffc878",tx,4.05,tz,.15,.25,.15,.65);
        seats.push({x:cx,y:3.4875,z:sz,ry:Math.PI,floor:3,walkAt:{x:cx,z:sz-1.45},sitter:null,allowWeapons:true,lockMovement:true});
        solids.push([tx-.5,tx+.5,tz-.5,tz+.5],[cx-.66,cx+.66,sz-.42,sz+.55]);
      }
    }
    for(const x of [-13.3,13.3]){block(root,"#242329",x,3.2,-12.1,4.4,6.4,9.8);solids.push([x-2.2,x+2.2,-17,-7.2]);}
    // Stage and shallow, full-width steps. Raised only sixty centimetres above the lower floor.
    block(root,"#80583a",0,.3,-13,22,.6,8);
    for(let i=0;i<3;i++)block(root,"#a4774d",0,(i+1)*.1,-7.333-i*.667,22,(i+1)*.2,.667);
    for(let x=-10.5;x<11;x+=.75)block(root,"#a4774d",x,.615,-13,.025,.025,8);
    // Compact proscenium: brick, unboxed gold lettering and folded burgundy curtains.
    block(root,"#513a32",0,3.2,-17,23,6.4,.35);
    for(let row=0;row<15;row++)for(let col=0;col<22;col++){
      const x=-10.7+col+(row%2)*.5;
      if(x>11)continue;
      block(root,["#9b553b","#884b37","#ad6343"][(row+col)%3],x,.35+row*.39,-16.78,.94,.34,.14);
    }
    sign(root,"DSB",-1.15,3.8,-16.55,1.3,"#edbb75");
    sign(root,"STUDIO",-1.15,3.05,-16.55,.5,"#edbb75");
    const emblem=createNode({position:{x:2.25,y:3.6,z:-16.52},rotation:{x:0,y:0,z:-.3}});addChild(root,emblem);
    block(emblem,"#deb076",0,.5,0,.58,.94,.12,.2);
    for(let y=.2;y<.9;y+=.16)block(emblem,"#54352b",0,y,.075,.62,.055,.025);
    block(emblem,"#deb076",0,-.25,0,.12,.7,.12,.2);block(emblem,"#deb076",0,-.63,0,.58,.09,.12,.2);
    const prop=(kind,x,y,z)=>{const n=createNode({geometry:BL.dressing.studio(kind),position:{x,y,z}});addChild(root,n);return n;};
    const rug=(x,z,w,d)=>{
      block(root,"#662c35",x,.64,z,w,.06,d);
      for(const dx of [-w/2+.16,w/2-.16])block(root,"#b48a58",x+dx,.678,z,.11,.015,d-.2);
      for(const dz of [-d/2+.16,d/2-.16])block(root,"#b48a58",x,.678,z+dz,w-.2,.015,.11);
      for(let dx=-w/2+.6;dx<w/2-.4;dx+=.6)for(const dz of [-d/2+.4,d/2-.4])block(root,"#a46b4f",x+dx,.68,z+dz,.18,.02,.15);
    };
    rug(-3.5,-12.9,6.4,4.7);rug(4.2,-13.5,5,4.5);
    // Fronts face +Z: dark guest chairs, low coffee table, separate audience-facing host desk.
    const guestSeats=[];
    for(const [x,standX] of [[-5,-7],[-2,0]]){
      const facing=.3; // Present to the crowd, with a slight turn toward the host on +X.
      prop("armchair",x,.6,-13.4).rotation.y=Math.PI+facing;
      guestSeats.push({x,y:1.25,z:-13.4,ry:facing,viewYaw:Math.PI+facing,floor:.6,walkAt:{x:standX,z:-13.4},sitter:null,allowWeapons:true,lockMovement:true});
      solids.push([x-1.04,x+1.04,-14.22,-12.58]);
    }
    prop("table",-3.5,.6,-11.65);solids.push([-4.85,-2.15,-12.25,-11.05]);
    for(const x of [-4.1,-2.9])block(root,"#e5c69b",x,1.48,-11.65,.2,.23,.2);
    // Top is 1.04 above the stage; Yellow's seated face starts at 1.28.
    const hostDesk=prop("host-desk",4.2,.65,-13.5);hostDesk.scale.y=.6;hostDesk.scale.x=.85;
    prop("armchair",4.2,.6,-15.2).rotation.y=Math.PI;
    const hostSeat={x:4.2,y:1.25,z:-15.2,ry:0,viewYaw:Math.PI,floor:.6,walkAt:{x:6.85,z:-13.5},sitter:null,allowWeapons:true,lockMovement:true};
    seats.push(hostSeat,...guestSeats);
    const stageSeats=[...guestSeats,hostSeat];
    solids.push([2.415,5.985,-14.35,-12.65,1.64],[3.3,5.1,-15.85,-14.6]);
    prop("mic",8,.65,-11.8);const stool=prop("stool",8.8,.6,-13.8);stool.scale.y=.65;
    for(const side of [-1,1]){
      prop("speaker",side*10,.6,-15.4);
      for(let i=0;i<6;i++)block(root,i%2?"#632d35":"#81343e",side*(8.9+i*.36),3.2,-16.25+(i%2)*.16,.4,5.2,.48);
      // Paneled side walls and warm practical lamps frame the galleries without blocking them.
      for(const z of [-2,3,7]){
        block(root,"#3d2c29",side*15.2,4.6,z,.18,3.2,.2);
        prop("wall-lamp",side*15.1,4.6,z).rotation.y=side<0?Math.PI/2:-Math.PI/2;
      }
      block(root,"#49332c",side*15.2,3.4,2,.16,.65,12);
      block(root,"#70503b",side*15.15,3.78,2,.18,.09,12);
    }
    for(const z of [-10.5,-14.7]){
      for(const y of [5.5,5.95])block(root,"#303036",0,y,z,21,.09,.13);
      for(let x=-10;x<=10;x+=1){const strut=block(root,"#484149",x,5.725,z,.06,.62,.06);strut.rotation.z=x%2?.8:-.8;}
      for(const x of [-7,0,7])prop("light",x,5.25,z);
    }
    prop("stool",6.2,3,15.5);solids.push([5.8,6.6,15.1,15.9]);
    block(root,"#e2caa1",2.7,3.81,14.5,.4,.12,.55);
    const jukebox=prop("jukebox",-3.25,3,14.3);jukebox.rotation.y=Math.PI/2;
    const title=sign(root,"DSB SPACES",-2.5,5.6,14.3,.37,"#ffd38a");title.rotation.y=Math.PI/2;
    solids.push([-4,-2.5,13.5,15.1]);
    sign(root,"ON AIR",0,5.1,9.15,.45,"#ee9869");
    const lights=new Float32Array(BL.glRenderer.POINT_LIGHT_CAPACITY*8);
    lights.set([5,4.4,-12,11,1.35,.85,.42,0,-5,4.4,-12,10,1.15,.72,.4,0,1,4.8,14,5,.65,.36,.16,0]);
    const lighting={clear:[.04,.03,.045],sky:[.34,.27,.26],ground:[.22,.16,.17],direct:[.66,.5,.35],directStrength:.24,ambientFloor:.29,sun:{x:.3,y:.9,z:.4},shadowCenter:{x:0,y:3,z:0},shadowExtent:22,shadowStrength:.2,bloomStrength:.3,fog:[.04,.03,.045],fogNear:55,fogFar:85,lights,lightCount:3};
    return {id:"dsb-studio",root,seats,hostSeat,stageSeats,solids,lighting,groundAt:floor,ceiling:6.4,spawnYaw:0,followDistance:3,
      spawn:{x:0,y:3,z:17},exit:{x:0,y:3,z:18.1},jukeboxAt:{x:-1.3,y:3,z:14.3},jukeboxSource:{x:-2.5,y:4.2,z:14.3},
      bounds:{minX:-15.15,maxX:15.15,minZ:-16.25,maxZ:18.5},
      tomatoContact:(ax,ay,az,p,seat)=>{
        const steps=Math.max(1,Math.ceil(Math.hypot(p.x-ax,p.y-ay,p.z-az)/.15));
        for(let i=1;i<=steps;i++){
          const k=i/steps,x=ax+(p.x-ax)*k,y=ay+(p.y-ay)*k,z=az+(p.z-az)*k;
          let hit=x<=-15.1||x>=15.1||z<=-16.5||z>=18.7||y>=6.2||y<=floor(x,z)+.12;
          if(!hit)for(const s of solids)if(!(seat&&seat.x>s[0]&&seat.x<s[1]&&seat.z>s[2]&&seat.z<s[3])&&x>s[0]&&x<s[1]&&z>s[2]&&z<s[3]&&y<(s[4]??floor(x,z)+(z>9?4:1.7))){hit=true;break;}
          if(hit){p.x=x;p.y=Math.max(floor(x,z)+.12,y);p.z=z;return true;}
        }
        return false;
      },
      clampCamera:(p,focus)=>{
        if(focus&&focus.z<10){p.z=Math.min(p.z,9.6);return;}
        if(focus&&focus.x>3&&focus.z>10.6&&focus.z<17.4){p.x=Math.max(3.4,Math.min(6.7,p.x));p.z=Math.max(11,Math.min(17.1,p.z));p.y=Math.min(5.6,p.y);}
        else if(p.z>10){p.x=Math.max(-2.1,Math.min(2,p.x));p.y=Math.min(5.6,p.y);}
        p.y=Math.max(4,p.y);
      }
    };
  };
  BL.dsbStudio={build};
})();
