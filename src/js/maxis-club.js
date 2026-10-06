// A compact private screening club: poster passage, tiered red seats, green side galleries, rear bar.
(() => {
  "use strict";
  const BL=window.BL,{createNode,addChild}=BL.scene,{block,sign}=BL.dsbModels;
  const build=()=>{
    const root=createNode({visible:false}),seats=[],solids=[];
    const floor=(x,z)=>z>=5.25||Math.abs(x)>=9?2.4:z<-11.6&&Math.abs(x)<8.5?.44:z<-9.75?0:
      Math.min(2.4,(Math.abs(x)<1||Math.abs(x)>7.2?Math.floor((z+9.75))+1:Math.floor((z+9.75)/3)+1)*(Math.abs(x)<1||Math.abs(x)>7.2?.16:.48));
    const prop=(kind,x,y,z,yaw=0)=>{const n=createNode({geometry:BL.dressing.maxis(kind),position:{x,y,z},rotation:{x:0,y:yaw,z:0}});addChild(root,n);return n;};
    const solid=(x,z,w,d)=>solids.push([x-w/2,x+w/2,z-d/2,z+d/2]);
    const rug=(x,y,z,w,d)=>{
      block(root,"#632b2b",x,y+.023,z,w,.035,d);
      for(const dx of [-w/2+.15,w/2-.15])block(root,"#bc8d52",x+dx,y+.045,z,.08,.015,d-.18);
      for(const dz of [-d/2+.15,d/2-.15])block(root,"#bc8d52",x,y+.045,z+dz,w-.18,.015,.08);
      for(let dz=-d/2+.55;dz<d/2;dz+=.68)for(const dx of [-w/2+.37,w/2-.37])block(root,"#966344",x+dx,y+.047,z+dz,.16,.015,.23);
      for(let dz=-d/2+1.1;dz<d/2-.7;dz+=1.6){
        const diamond=block(root,"#bc8d52",x,y+.05,z+dz,.46,.016,.46);diamond.rotation.y=Math.PI/4;
        const inset=block(root,"#33432c",x,y+.062,z+dz,.28,.012,.28);inset.rotation.y=Math.PI/4;
        for(const dx of [-.64,.64])block(root,"#966344",x+dx,y+.05,z+dz,.16,.014,.16);
      }
    };
    const poster=(x,y,z,yaw,kind,label)=>{
      const group=createNode({position:{x,y,z},rotation:{x:0,y:yaw,z:0}});addChild(root,group);
      block(group,"#a17643",0,0,0,1.8,2.5,.13);block(group,"#17261e",0,0,.08,1.64,2.32,.06);
      addChild(group,createNode({geometry:BL.dressing.maxis(kind),position:{x:0,y:.2,z:.13}}));
      sign(group,label,0,-.98,.18,.19,"#e8bb70");
    };
    const seat=(kind,x,y,z,yaw=0,walkX=x,walkZ=z-1.4)=>{
      prop(kind,x,y,z,yaw);
      seats.push({x,y:y+.48,z,ry:Math.PI+yaw,viewYaw:yaw,floor:y,walkAt:{x:walkX,z:walkZ},sitter:null,allowWeapons:true,lockMovement:true});
      solid(x,z,kind==="lounge"?1.48:1.25,1.02);
    };
    // Tiled shell keeps the fallback painter from sorting a room-sized face over nearby art / trusses.
    // All tiles instance the same colour meshes in WebGL; no extra material or render target.
    for(let col=0;col<8;col++)for(let row=0;row<11;row++){
      const x=-13+(col+.5)*3.25,z=-15+(row+.5)*3;
      block(root,"#281d17",x,-.15,z,3.25,.3,3);block(root,"#1e221d",x,8.5,z,3.25,.3,3);
    }
    for(let row=0;row<3;row++){
      const y=(row+.5)*2.8;
      for(const x of [-13,13])for(let col=0;col<11;col++)block(root,"#302822",x,y,-13.5+col*3,.35,2.8,3);
      for(let col=0;col<8;col++){
        block(root,"#39271f",-13+(col+.5)*3.25,y,-15,3.25,2.8,.35);
        block(root,"#302822",-13+(col+.5)*3.25,y,18,3.25,2.8,.35);
      }
    }
    // Timber arrival and private threshold at the back, to the left of a low bar.
    block(root,"#523726",0,1.2,11.625,26,2.4,12.75);
    for(const x of [-8.4,-2.8]){
      for(let i=0;i<4;i++)block(root,"#31251f",x,4.3,10.475+i*2.15,.25,3.8,2.15);solid(x,13.7,.25,8.6);
      block(root,"#62452c",x,3,13.7,.31,1.2,8.6);block(root,"#a27847",x,3.66,13.7,.33,.08,8.6);
      for(const z of [10.5,13.5,16.5]){poster(x+(x< -5?.2:-.2),4.65,z,x< -5?Math.PI/2:-Math.PI/2,"crown-frog",z===13.5?"21 MILLION":"MAXIS CLUB");}
    }
    for(let i=0;i<4;i++)block(root,"#251d17",-5.6,6.25,10.65+i*2.1,5.8,.2,2.1);rug(-5.6,2.4,13.1,3.6,9.6);
    for(const z of [10,12.5,15,17.5]){
      block(root,"#65442b",-5.6,6.08,z,5.6,.16,.2);prop("lamp",-5.6,5.39,z);
      for(const x of [-8.1,-3.1]){block(root,"#a17643",x,4.55,z,.18,.12,.18);prop("lamp",x,4.62,z);}
    }
    for(const x of [-8.22,-2.98]){prop("plant",x,2.4,9.5);solid(x,9.5,.8,.8);}
    for(const x of [-8.15,-3.05])for(let z=10;z<17.8;z+=.8)block(root,"#9a693a",x,3.07,z,.12,1.25,.055);
    for(const x of [-7.5,-3.7])for(const z of [11,15]){block(root,"#b08a48",x,2.94,z,.07,1.08,.07);block(root,"#d1a45c",x,3.5,z,.16,.15,.16);}
    block(root,"#33432c",-5.6,3.9,17.8,2.1,3,.13);sign(root,"EXIT",-5.6,5.25,17.63,.35,"#ebc380").rotation.y=Math.PI;
    sign(root,"MAXIS CLUB",-5.6,5.52,9.45,.5,"#eb8455");sign(root,"THEATER",-5.6,5.08,9.43,.24,"#d8b685");
    // Five rows, two blocks of four; the centre and side steps all meet the rear landing.
    for(let row=0;row<5;row++){
      const y=(row+1)*.48,z=-8.25+row*3;
      for(const side of [-1,1]){
        block(root,"#433125",side*4.1,y/2,z,6.2,y,3);
        for(let col=0;col<4;col++)seat("seat",side*(1.7+col*1.5),y,z+.2);
        // Side tables sit beyond the row, with an unobstructed aisle on their outside.
        prop("table",side*6.98,y,z+.22);prop("lamp",side*6.98,y+.68,z+.22);solid(side*6.98,z+.22,.65,.7);
      }
    }
    for(let step=0;step<15;step++){
      const y=(step+1)*.16,z=-9.75+step+.5;
      for(const [x,w] of [[0,2],[-8.1,1.8],[8.1,1.8]]){
        block(root,"#5b4230",x,y/2,z,w,y,1);block(root,"#a6763b",x,y+.014,z-.46,w,.028,.07);
        if(step%3===0)for(const s of [-1,1])block(root,"#ffc076",x+s*(w/2-.16),y+.028,z-.3,.1,.035,.2,.7);
      }
    }
    // Side galleries continue to the rear walkway. Dense railings do not cross their entry gaps.
    for(const side of [-1,1]){
      block(root,"#493321",side*11,1.2,-1.4,4,2.4,20.3);rug(side*11,2.4,-1,3.5,19);
      for(const y of [2.6,3.04,3.42]){block(root,"#392b1c",side*9.12,y,-2.2,.12,.08,17.6);block(root,"#392b1c",side*11,y,-11,3.9,.08,.13);}
      for(let z=-10.9;z<6.6;z+=.5)block(root,"#af874a",side*9.12,2.95,z,.045,.94,.045);
      for(let x=9.2;x<12.9;x+=.5)block(root,"#af874a",side*x,2.95,-11,.045,.94,.045);
      solid(side*9.12,-2.2,.16,17.6);solid(side*11,-11,4,.16);
      for(const z of [-7,-2.5,2]){
        seat("lounge",side*11.8,2.4,z,0,side*10.3,z-1.25);
        prop("table",side*11.8,2.4,z-2.1);prop("lamp",side*11.8,3.08,z-2.1);solid(side*11.8,z-2.1,.8,.8);
      }
      for(const z of [-9,-4,1,6]){
        poster(side*12.77,5,z,-side*Math.PI/2,z%2?"frog":"bitcoin",z===6?"HIGHER GROUND":"GOOD MEMES");
        prop("lamp",side*12.65,6.36,z);
        block(root,"#66472e",side*12.7,4.9,z+1.9,.22,6.1,.2);
      }
      block(root,"#4f3525",side*12.74,3,-1.4,.18,1.2,20);
      block(root,"#b48649",side*12.6,3.7,-1.4,.16,.07,20);
      for(const z of [-9,0,7])block(root,"#442e20",side*10.9,7.4,z,4.1,.32,.4);
    }
    // Brick panels between framed artwork, backed by dark timber rails.
    for(const side of [-1,1])for(let row=0;row<8;row++)for(let col=0;col<18;col++){
      const z=-10.5+col+(row%2)*.48;
      block(root,(row+col)%3?"#493329":"#604032",side*12.78,3.92+row*.32,z,.055,.27,.91);
    }
    // Low proscenium and dominating 16:9 screen, below a visible black lighting truss.
    block(root,"#75482a",0,.22,-13.3,17,.44,3.4);
    for(const side of [-1,1])block(root,"#131b15",side*7.03,4.23,-14.51,.65,7.26,.35);
    for(const y of [.63,7.88])block(root,"#131b15",0,y,-14.51,14.7,.16,.35);
    // Small screen facets preserve the artwork's ordering in Canvas 2D, including oblique views.
    const screenParts=[];
    for(let row=0;row<14;row++)for(let col=0;col<20;col++)screenParts.push(BL.models.box({w:13.4/20,h:7.05/14,d:.05,color:"#213d27",emissive:.38,offset:{x:-6.7+(col+.5)*13.4/20,y:-3.525+(row+.5)*7.05/14,z:0}}));
    const screen=createNode({geometry:BL.models.merge(...screenParts),position:{x:0,y:4.25,z:-14.29}});addChild(root,screen);
    const idle=createNode();addChild(root,idle);
    for(const side of [-1,1])for(let i=0;i<6;i++){const n=block(idle,i%2?"#d17a2b":"#7ca94c",side*(3.5+i*.4),4.2,-14.23,.055,5.2,.02,.6);n.rotation.z=side*(.15+i*.13);}
    for(let i=0;i<28;i++){const x=((i*71)%127)/10-6.3,y=1.1+((i*29)%62)/10;block(idle,"#e9c775",x,y,-14.21,.06,.11,.025,.7);}
    const frog=prop("screen-frog",0,4.32,-14.18);frog.scale.x=3.2;frog.scale.y=3.2;BL.scene.removeChild(root,frog);addChild(idle,frog);
    sign(idle,"MAXIS CLUB",0,6.96,-14.15,.72,"#edd987");sign(idle,"MORE MEMES  BRIGHTER SIGNAL",0,1.2,-14.15,.4,"#a5d29c");
    const playing=createNode({visible:false});addChild(root,playing);
    sign(playing,"MAXIS MEDIA",0,4.8,-14.13,.93,"#d8d385");sign(playing,"LOCAL SCREENING",0,3.72,-14.13,.52,"#7bca89");
    sign(playing,"PLAYER OPEN ON YOUR DEVICE",0,2.8,-14.13,.34,"#d8c3a1");
    block(root,"#76292f",0,8.08,-14.05,18.7,.65,.6);
    for(const side of [-1,1]){
      for(let i=0;i<8;i++)block(root,i%2?"#542026":"#862c31",side*(7.1+i*.3),4.35,-14.04+(i%2)*.15,.36,7.6,.6);
      block(root,"#b78b40",side*8.1,1.6,-13.72,1.45,.2,.24);
      const speaker=createNode({geometry:BL.dressing.studio("speaker"),position:{x:side*8,y:.44,z:-12.9}});addChild(root,speaker);
      prop("plant",side*11.5,0,-12.6); // Decorative wing: blocked from the raised side gallery.
    }
    for(const z of [-12,-5,3]){
      for(const y of [7.85,8.2])block(root,"#242421",0,y,z,25,.09,.13);
      for(let x=-12;x<=12;x+=1.2){const n=block(root,"#40372d",x,8,z,.06,.5,.06);n.rotation.z=x%2?.8:-.8;}
      for(const x of [-8,-4,0,4,8])addChild(root,createNode({geometry:BL.dressing.studio("light"),position:{x,y:7.52,z}}));
    }
    for(const x of [-9,-4.5,0,4.5,9])block(root,"#40372d",x,8.27,-2.4,.24,.2,24.6);
    // Suspended warm practicals and timber coffers, kept outside all walking clearances.
    for(const side of [-1,1])for(const z of [-8,-2,4]){
      block(root,"#40372d",side*10.9,7.32,z,.055,1.5,.055);prop("lamp",side*10.9,6.02,z);
    }
    // Rear-right social lounge: usable green chairs, Persian-style rug, bottles and low timber bar.
    rug(5.6,2.4,10.8,11.7,7.2);
    block(root,"#654126",6,2.86,14.3,10,.92,1.12);block(root,"#b98748",6,3.39,14.3,10.4,.13,1.4);solid(6,14.3,10.4,1.4);
    for(const x of [1.6,3.8,6,8.2,10.4]){prop("stool",x,2.4,12.85);solid(x,12.85,.72,.72);}
    block(root,"#422c20",6,4.7,17.65,10.6,4.6,.3);
    for(const y of [3.1,4,4.9]){
      block(root,"#ad8047",6,y,17.25,10.2,.12,.72);
      for(let i=0;i<20;i++)prop(i%3?"bottle":"amber-bottle",1.3+i*.49,y+.06,17.14);
      block(root,"#bc8d52",6,y-.1,17.13,10,.045,.05);
    }
    for(let x=.8;x<=11.2;x+=.8)block(root,"#8e653b",x,2.89,15.02,.06,.8,.045);
    for(let x=-2;x<12.9;x+=.55)block(root,"#281e18",x,2.413,11.8,.022,.015,11.8);
    sign(root,"LIQUID MEMES",6,5.88,17.05,.32,"#c6a271").rotation.y=Math.PI;
    sign(root,"MAXIS CLUB",6,6.28,17.05,.72,"#df7854").rotation.y=Math.PI;
    for(const x of [2,6,10])prop("lamp",x,3.47,14.3);
    for(const x of [3,4,8,9]){prop("glass",x,3.46,14);block(root,"#33432c",x,3.46,14,.3,.016,.3);}
    const menu=createNode({position:{x:-.7,y:4.6,z:17.1},rotation:{x:0,y:Math.PI,z:0}});addChild(root,menu);
    block(menu,"#a17643",0,0,0,2,2.5,.12);block(menu,"#17261e",0,0,.08,1.85,2.32,.05);
    sign(menu,"DRINKS",0,.68,.13,.3,"#e8bb70");
    for(const [i,label] of ["SATS SOUR","FIAT TEARS","BULL TONIC","LIQUID MEMES"].entries())sign(menu,label,0,.23-i*.31,.13,.17,"#d8b685");
    poster(12.78,4.8,11,-Math.PI/2,"crown-frog","LIQUID MEMES");
    poster(12.78,4.8,15.7,-Math.PI/2,"bitcoin","SAME MEMES");
    for(const [x,z] of [[.8,9.4],[3.8,9.4],[8.4,9.4],[11.4,9.4]])seat("lounge",x,2.4,z,0,x,z-1.25);
    for(const x of [2.3,9.9]){prop("table",x,2.4,10.15);prop("lamp",x,3.08,10.15);solid(x,10.15,1,1);}
    for(const [x,z] of [[12,16.6],[-.5,15.4],[12,5.6],[-12,5.6]]){prop("plant",x,2.4,z);solid(x,z,.85,.85);}
    const console=block(root,"#324f35",7.4,.63,-12,.86,1.26,.6);solid(7.4,-12,.86,.6);
    sign(root,"MAXIS MEDIA",7.4,1.6,-12,.2,"#ecbc70");
    const lights=new Float32Array(BL.glRenderer.POINT_LIGHT_CAPACITY*8);
    lights.set([0,5,-12,14,.42,.65,.38,0, -8,5,-8,10,.88,.39,.17,0, 8,5,-8,10,.88,.39,.17,0, -5.6,5,13,6,.95,.6,.28,0, 6,5.2,12,10,1,.55,.23,0]);
    const lighting={clear:[.024,.028,.022],sky:[.36,.31,.23],ground:[.2,.15,.1],direct:[.64,.46,.28],directStrength:.23,ambientFloor:.34,sun:{x:.2,y:.8,z:.4},shadowCenter:{x:0,y:3,z:0},shadowExtent:24,shadowStrength:.18,bloomStrength:.3,lights,lightCount:5,fog:[.024,.028,.022],fogNear:55,fogFar:85};
    return {id:"maxis-club",root,seats,solids,lighting,groundAt:floor,ceiling:8.5,spawnYaw:0,followDistance:2.8,
      spawn:{x:-5.6,y:2.4,z:16},exit:{x:-5.6,y:2.4,z:17},mediaAt:{x:7.4,y:0,z:-10.4},screen,console,
      bounds:{minX:-12.75,maxX:12.75,minZ:-14,maxZ:17.6},
      setMedia:on=>{idle.visible=!on;playing.visible=!!on;},
      gainAt:(x,z)=>z<8?.8:Math.max(.12,.8-(z-8)*.085),
      reviews:{"maxis-theater":{position:{x:0,y:2.4,z:7.5},yaw:0,pitch:.17,dist:3},"maxis-balcony":{position:{x:-10.8,y:2.4,z:6.9},yaw:-.35,pitch:.12,dist:3},"maxis-bar":{position:{x:6,y:2.4,z:8},yaw:Math.PI,pitch:.05,dist:3},"maxis-screen":{position:{x:0,y:0,z:-9.7},yaw:0,pitch:-.2,dist:3}},
      clampCamera:(p,focus)=>{if(focus?.z>9&&focus.x< -2.9&&focus.x> -8.2){p.x=Math.max(-7.9,Math.min(-3.3,p.x));p.y=Math.min(5.9,p.y);}else if(focus?.z<9)p.z=Math.min(p.z,9);},
      tomatoContact:(ax,ay,az,p,occupied)=>{
        const steps=Math.max(1,Math.ceil(Math.hypot(p.x-ax,p.y-ay,p.z-az)/.15));
        for(let i=1;i<=steps;i++){
          const k=i/steps,x=ax+(p.x-ax)*k,y=ay+(p.y-ay)*k,z=az+(p.z-az)*k;
          let hit=x<=-12.7||x>=12.7||z<=-14.2||z>=17.8||y>=8.3||y<=floor(x,z)+.1;
          if(!hit)for(const s of solids)if(!(occupied&&occupied.x>s[0]&&occupied.x<s[1]&&occupied.z>s[2]&&occupied.z<s[3])&&x>s[0]&&x<s[1]&&z>s[2]&&z<s[3]&&y<floor(x,z)+1.2){hit=true;break;}
          if(hit){p.x=x;p.y=Math.max(floor(x,z)+.1,y);p.z=z;return true;}
        }return false;
      }
    };
  };
  BL.maxisClub={build};
})();
