// Additive Mediterranean pieces in the existing shared dressing kit.
// All geometry is opaque, cached and instanced by the DSB placement owner.
(() => {
  "use strict";
  const BL=window.BL,M=BL.models,cache=new Map();
  const coastal=kind=>{
    if(cache.has(kind))return cache.get(kind);
    const simple=kind.endsWith("-low"),shape=simple?kind.slice(0,-4):kind;
    const parts=[],stone="#d8ccb0",blue="#376e9a",wood="#94704a",rope="#c1a47a",leaf="#637851";
    const box=(x,y,z,w,h,d,color,rz=0)=>{const g=M.box({w,h,d,color,emissive:color==="#ffd18a"||color==="#eebd77"?1:0});if(rz)M.turnedZ(g,rz);parts.push(M.moved(g,x,y,z));};
    const beam=(a,b,w,color)=>parts.push(M.beam(...a,...b,w,color));
    if(shape==="flowerbox"||shape==="vine"){
      if(shape==="flowerbox"){box(0,.13,0,1.5,.26,.48,"#b88762");box(0,.28,0,1.58,.1,.55,"#d0a27b");}
      for(let j=0;j<(simple?6:18);j++){
        const i=simple?j*3:j;
        const x=Math.sin(i*2.4)*.78,y=shape==="vine"?i*.19:.36+Math.sin(i)*.14,z=Math.cos(i*2.4)*.2;
        box(x,y,z,.4,.3,.32,leaf);
        box(x+.12,y+.1,z+.13,.27,.2,.25,["#bc3178","#d55094","#e079ad"][i%3]);
      }
    }else if(kind==="agave"){
      for(let i=0;i<9;i++){const a=i*Math.PI*2/9,r=.45+(i%2)*.15;beam([0,.08,0],[Math.cos(a)*r,.35+i%3*.17,Math.sin(a)*r],.12,i%2?"#789a85":"#527963");}
    }else if(kind==="herbs"){
      for(let i=0;i<11;i++){const a=i*2.4,r=.12+i*.035;box(Math.cos(a)*r,.16+i%3*.04,Math.sin(a)*r,.24,.3,.25,["#879767","#647e59","#b4a173"][i%3]);}
    }else if(kind==="lantern"||kind==="glass"){
      if(kind==="glass")box(0,.52,0,.23,.35,.23,"#ffd18a");
      else{
        box(0,.13,0,.4,.26,.4,stone);box(0,.3,0,.34,.09,.34,"#5b4a36");box(0,.75,0,.42,.12,.42,"#5b4a36");
        for(const x of [-.15,.15])for(const z of [-.15,.15])box(x,.52,z,.045,.42,.045,"#584530");
        beam([-.08,.84,0],[0,.96,0],.045,wood);beam([0,.96,0],[.08,.84,0],.045,wood);
      }
    }else if(kind==="windowglow"){
      box(0,0,0,.76,.9,.035,"#eebd77");
      box(0,0,.024,.055,.94,.04,"#486877");box(0,0,.024,.8,.055,.04,"#486877");
    }else if(kind==="post"){
      box(0,.5,0,.17,1,.17,wood);
    }else if(kind==="pergola"||kind==="pergolaroof"){
      if(kind==="pergola")for(const x of [-2,2])for(const z of [-1.5,1.5]){box(x,.12,z,.42,.24,.42,stone);box(x,1.48,z,.17,2.96,.17,wood);}
      for(const z of [-1.65,1.65])box(0,3,z,4.6,.24,.2,wood);
      for(let i=0;i<9;i++)box((i-4)*.5,3.17,0,.16,.16,3.6,"#aa8960");
      for(const x of [-2,2])for(const z of [-1.5,1.5])beam([x,2.2,z],[x*.7,3,z],.12,wood);
    }else if(kind==="shade"){
      for(let i=0;i<7;i++)box((i-3)*.52,3.22,0,.5,.045,2.8,i%2?"#e9dbb9":"#c4ae83");
    }else if(kind==="parasol"){
      box(0,1.13,0,.1,2.26,.1,wood);
      for(let j=0;j<4;j++){const size=2.9-j*.6;for(let x=0;x<4;x++)for(let z=0;z<4;z++)box((x-1.5)*size/4,2.1+j*.15,(z-1.5)*size/4,size/4,.12,size/4,["#bda371","#cfb584","#d8c290","#ead4a2"][j]);}
      for(let i=0;i<8;i++){const a=i*Math.PI/4;beam([0,2.66,0],[Math.cos(a)*1.35,2.06,Math.sin(a)*1.35],.055,"#92754c");}
    }else if(kind==="lounger"){
      for(const x of [-.35,.35])for(const z of [-.72,.72])box(x,.18,z,.09,.36,.09,wood);
      box(0,.4,0,.85,.15,1.85,wood);box(0,.51,.1,.73,.09,1.44,blue);
      const back=M.box({w:.74,h:.12,d:.66,color:"#e5d6b2"});M.turnedX(back,-.48);parts.push(M.moved(back,0,.66,-.7));
      for(const x of [-.4,.4])box(x,.61,.05,.075,.06,.9,wood);
      box(0,.57,.35,.74,.035,.16,"#e7dabe");
    }else if(kind==="ropepost"){
      box(0,.6,0,.16,1.2,.16,wood);box(0,.08,0,.35,.16,.35,stone);box(0,1.05,0,.24,.13,.24,rope);
    }else if(kind==="rope"){
      for(let i=0;i<8;i++)beam([i/8-.5,.94-.2*Math.sin(i/8*Math.PI),0],[(i+1)/8-.5,.94-.2*Math.sin((i+1)/8*Math.PI),0],.045,rope);
    }else if(kind==="coil"){
      for(let j=0;j<3;j++)for(let i=0;i<12;i++){
        const a=i*Math.PI/6,b=(i+1)*Math.PI/6,r=.24+j*.075;
        beam([Math.cos(a)*r,.055+j*.02,Math.sin(a)*r],[Math.cos(b)*r,.055+j*.02,Math.sin(b)*r],.055,rope);
      }
    }else if(kind==="fishing"){
      box(0,.23,0,1,.46,.65,"#608084");
      for(let i=0;i<5;i++){box((i-2)*.18,.48,0,.1,.09,.6,stone);box((i-2)*.18,.52,.1,.18,.08,.08,"#a8bfc0");}
      box(.38,.64,-.1,.16,.32,.16,"#cb9865");
    }else if(kind==="netrack"){
      for(const x of [-.9,.9])box(x,.95,0,.09,1.9,.09,wood);
      box(0,1.85,0,2,.08,.09,wood);
      for(let i=0;i<11;i++)beam([(i-5)*.16,.4+(i%2)*.07,.07],[(i-5)*.16,1.78,.03],.025,rope);
      for(let i=0;i<8;i++)beam([-.84,.48+i*.16,.07],[.84,.53+i*.16,.03],.025,rope);
      for(const x of [-.72,-.24,.24,.72])box(x,.42,.06,.1,.2,.11,"#3b717c");
    }else if(kind==="fender"){
      box(0,.48,0,.25,.96,.23,"#e9ddbc");box(0,.96,0,.14,.12,.14,blue);
    }else if(kind==="boat"){
      // Moored decorative caique only: no movement, collision or boarding system.
      for(let i=0;i<5;i++){const z=(i-2)*.66,w=[.6,1.25,1.6,1.55,1.1][i];box(0,.12,z,w,.3,.67,"#e7ddc3");for(const side of [-1,1]){box(side*w*.46,.38,z,.13,.45,.67,blue);box(side*w*.46,.63,z,.16,.08,.69,"#d8c7a0");}}
      box(0,.43,.32,1.3,.1,1.8,wood);box(0,.8,.45,.85,.65,.8,stone);box(0,1.15,.45,1.05,.1,1,blue);
      box(0,.89,.87,.55,.29,.03,"#305566");box(0,1.5,-.52,.075,1.5,.075,wood);
      for(const x of [-.5,.5])box(x,.65,-.8,.14,.22,.14,"#c59253");
    }else if(kind==="wall"){
      for(let j=0;j<3;j++)for(let i=0;i<3;i++)box((i-1)*.55+(j%2)*.08,.13+j*.25,0,.52,.24,.43,j%2?"#c7bda5":stone);
      box(0,.8,0,1.85,.14,.53,"#ece1c7");
    }else if(kind==="column"||kind==="broken"){
      box(0,.14,0,1.35,.28,1.35,stone);box(0,.37,0,1.06,.18,1.06,"#eee0bf");
      const h=kind==="column"?3.15:1.22;
      box(0,.48+h/2,0,.63,h,.63,"#d0c2a3");
      for(let i=0;i<8;i++){const a=i*Math.PI/4;box(Math.cos(a)*.34,.48+h/2,Math.sin(a)*.34,.12,h,.12,i%2?stone:"#eee0bf");}
      if(kind==="column"){box(0,h+.58,0,1.02,.2,1.02,stone);box(0,h+.78,0,1.2,.2,1.2,"#eee0bf");}
      else{box(.08,h+.5,0,.52,.25,.63,"#bdaf92");box(-.23,h+.44,.09,.2,.12,.39,stone);}
    }else if(kind==="lintel"){
      box(0,0,0,1,.7,1.06,stone);box(0,.35,0,1.07,.13,1.22,"#eee0bf");
      for(let i=0;i<5;i++)box((i-2)*.18,0,.54,.065,.4,.04,"#ac9e83");
    }else if(kind==="fragment"){
      box(0,.2,0,1.05,.4,.65,"#d4c7a8");box(-.12,.48,.06,.6,.2,.45,"#eee0bf");
    }else if(kind==="paving"){
      for(let x=0;x<2;x++)for(let z=0;z<2;z++)box((x-.5)*.43,.006,(z-.5)*.37,.4,.012,.34,(x+z)%2?"#cebea0":"#e5d4b3");
    }else if(kind==="mosaic"){
      for(let x=-2;x<=2;x++)for(let z=-2;z<=2;z++)box(x*.2,.012,z*.2,.18,.024,.18,(x+z)%2?blue:stone);
    }else throw new Error(`Unknown coastal dressing: ${kind}`);
    const geometry=M.merge(...parts);geometry.castShadow=false;cache.set(kind,geometry);return geometry;
  };
  BL.dressing.coastal=coastal;
})();
