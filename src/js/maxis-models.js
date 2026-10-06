// Maxis additions to the shared dressing kit. Every repeated prop shares one immutable mesh.
(() => {
  "use strict";
  const BL=window.BL,cache=new Map();
  BL.dressing.maxis=kind=>{
    if(cache.has(kind))return cache.get(kind);
    const bits=[],b=(c,x,y,z,w,h,d,e=0)=>bits.push(BL.models.box({w,h,d,color:c,emissive:e,offset:{x,y,z}}));
    if(kind==="seat"||kind==="lounge"){
      const w=kind==="lounge"?1.3:1.1,c=kind==="lounge"?"#324b39":"#652a30";
      b("#211d1b",0,.21,0,w-.12,.42,.75);
      bits.push(BL.models.bevelBox({w,h:.18,d:.84,color:c,bevel:.055,offset:{x:0,y:.48,z:0}}));
      bits.push(BL.models.bevelBox({w,h:.76,d:.24,color:c,bevel:.07,offset:{x:0,y:.86,z:.36}}));
      b(kind==="lounge"?"#577352":"#8a4841",0,1.22,.36,w-.14,.035,.14);
      for(const x of [-w*.26,0,w*.26])b("#251d1b",x,.9,.224,.025,.025,.018);
      for(const x of [-w/2,w/2]){b("#37241a",x,.61,0,.13,.22,.92);b("#bf8846",x,.745,-.26,.12,.035,.22);}
      for(const x of [-w*.32,w*.32])b("#302624",x,.08,0,.12,.16,.7);
    }else if(kind==="table"){
      bits.push(BL.models.lathe({profile:[[0,.03],[.38,.03],[.38,.1],[.09,.12],[.09,.56],[.49,.58],[.49,.66],[0,.66]],segments:12,color:"#815130"}));
      b("#241c15",0,.69,0,.31,.055,.22);b("#bd9156",0,.725,0,.25,.018,.16);
    }else if(kind==="lamp"){
      b("#a57536",0,.035,0,.25,.07,.25);b("#a57536",0,.18,0,.055,.3,.055);
      bits.push(BL.models.lathe({profile:[[.19,.28],[.12,.58],[0,.58]],segments:8,color:"#ffc078",emissive:.7}));
      b("#835523",0,.605,0,.06,.06,.06);
    }else if(kind==="plant"){
      bits.push(BL.models.lathe({profile:[[.2,0],[.32,.42],[.32,.49],[.25,.49]],segments:8,color:"#69503a"}));
      b("#253827",0,.87,0,.08,.9,.08);
      for(let i=0;i<9;i++){
        const a=i*2.4,g=BL.models.box({w:.18,h:.8,d:.08,color:i%2?"#4a7040":"#274f32"});
        BL.models.turnedZ(g,.48+(i%3)*.13);BL.models.turnedY(g,a);BL.models.moved(g,Math.cos(a)*.24,.87+(i%3)*.15,Math.sin(a)*.24);bits.push(g);
      }
    }else if(kind==="bottle"||kind==="amber-bottle"){
      b(kind==="bottle"?"#416248":"#996334",0,.16,0,.14,.32,.14);b("#385538",0,.37,0,.07,.13,.07);b("#d19e4f",0,.45,0,.08,.04,.08);b("#e8cb8b",0,.17,.076,.1,.12,.015);
    }else if(kind==="glass"){
      b("#9b865d",0,.1,0,.11,.18,.11);b("#e8c482",0,.195,0,.13,.025,.13);b("#533921",0,.211,0,.07,.012,.07);
    }else if(kind==="stool"){
      b("#3a4d35",0,.66,0,.62,.14,.62);for(const x of [-.23,.23])for(const z of [-.23,.23])b("#412c1e",x,.3,z,.075,.6,.075);
      b("#af8244",0,.22,-.24,.5,.05,.05);
    }else if(kind==="frog"||kind==="crown-frog"||kind==="screen-frog"){
      // Original pixel frog art: hooded eyes, broad cheek and a peach grin; no remote image assets.
      const rows=[
        "       kkkkkkkkk       ","     kkgggggggggkk     ","    kggglllllllgggk    ","   kgglllllllgggggk   ",
        "  kkllllllggggggggkk  "," kggggggggggggggggggk "," kggkwwwwkkwwwwkggggk "," kggkwwwkkkwwwkkggggk ",
        " kggkwwkkwkwwkkwggggk "," kggkkkkkkkkkkkkggggk ","kggggggggggggggggggggk","kgggggglllllgggggggggk",
        "kgggglllllllllgggggggk","kggggkkppppppppkkggggk","kgggkppppppppppppkgggk"," kggkppkkkkkkkkppkggk ",
        " kgggkppppppppppkgggk ","  kgggkkkkkkkkkkgggk  ","   kggggggggggggggk   ","    kggggggggggggk    ",
        "     kkggggggggkk     ","    kkkkkkkkkkkkkk    "
      ],colors={k:"#183829",g:"#41954e",l:"#7fc674",w:"#e7e1b5",p:"#d79773"},cell=.062,e=kind==="screen-frog"?.75:.08;
      for(let y=0;y<rows.length;y++)for(let x=0;x<rows[y].length;x++){const c=colors[rows[y][x]];if(c)b(c,(x-10.5)*cell,(10.5-y)*cell,.06,cell,cell,.04,e);}
      if(kind==="crown-frog"){b("#e7b83e",0,.76,.1,.9,.15,.07);for(const x of [-.38,0,.38])b("#e7b83e",x,.91,.1,.15,.22,.07);}
    }else if(kind==="bitcoin"){
      bits.push(BL.models.box({w:.62,h:1,d:.04,color:"#ed9a38"}));
      for(const y of [-.28,.24])b("#19291d",.03,y,.035,.3,.16,.035);
      for(const x of [-.15,.09])b("#ed9a38",x,0,.015,.07,1.28,.055);
    }
    const geometry=BL.models.merge(...bits);cache.set(kind,geometry);return geometry;
  };
})();
