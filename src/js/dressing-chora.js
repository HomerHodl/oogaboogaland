// Static Cycladic extension of the shared dressing kit. Geometry is cached across visits.
(() => {
  "use strict";
  const BL=window.BL,M=BL.models,cache=new Map();
  const chora=kind=>{
    if(cache.has(kind))return cache.get(kind);
    if(kind==="crate"||kind==="barrel"){
      const set=BL.dressing.set();set.put(kind,0,0,0);const geometry=set.build().solid;
      let bottom=Infinity;for(let i=1;i<geometry.verts.length;i+=3)bottom=Math.min(bottom,geometry.verts[i]);
      M.moved(geometry,0,-bottom,0);geometry.castShadow=false;cache.set(kind,geometry);return geometry;
    }
    const parts=[],box=(x,y,z,w,h,d,color)=>parts.push(M.box({w,h,d,color,offset:{x,y,z}}));
    const white="#fbf8f1",blue="#326c99",wood="#90714f",iron="#425360";
    if(kind==="window"){
      box(0,0,0,1.1,1.35,.12,white);box(0,0,.08,.83,1.08,.08,"#263f51");
      for(const x of [-.7,.7]){box(x,0,.06,.38,1.3,.13,blue);for(let y=-.45;y<.5;y+=.18)box(x,y,.14,.34,.045,.045,"#6596b1");}
      box(0,0,.14,.065,1.08,.06,white);box(0,0,.14,.83,.06,.06,white);box(0,-.73,.09,1.65,.16,.35,white);
    }else if(kind==="balcony"){
      box(0,0,.45,2.3,.18,1.05,white);
      for(const y of [.2,.9])box(0,y,.93,2.2,.08,.08,blue);
      for(let x=-1.05;x<=1.06;x+=.3)box(x,.5,.93,.055,.8,.055,blue);
      for(const x of [-1.08,1.08]){box(x,.9,.48,.08,.08,.95,blue);box(x,.47,.1,.07,.94,.07,blue);}
    }else if(kind==="vent"){
      box(0,.35,0,.48,.7,.48,white);box(0,.76,0,.7,.14,.65,white);box(0,.55,.25,.25,.18,.03,iron);
    }else if(kind==="bench"){
      for(const x of [-.65,.65])box(x,.28,0,.18,.56,.5,white);
      box(0,.6,0,1.8,.14,.58,wood);box(0,1,-.22,1.8,.55,.1,blue);
    }else if(kind==="pot"){
      box(0,.24,0,.42,.48,.42,"#b78062");box(0,.49,0,.49,.1,.49,"#c99b74");box(0,.54,0,.3,.045,.3,"#594f3d");
    }else if(kind==="table"){
      box(0,.43,0,.12,.86,.12,blue);box(0,.08,0,.62,.14,.62,blue);box(0,.9,0,1,.12,1,white);
      for(const x of [-.85,.85]){for(const z of [-.18,.18])box(x,.26,z,.07,.52,.07,blue);box(x,.55,0,.5,.1,.5,wood);box(x,.9,-.2,.5,.65,.07,blue);}
    }else if(kind==="bollard"){
      box(0,.3,0,.24,.6,.24,iron);box(0,.54,0,.48,.13,.22,iron);box(0,.08,0,.4,.16,.4,"#c1b393");
      for(const y of [.26,.34])box(0,y,0,.32,.065,.32,"#c4a77b");
    }else if(kind==="driftwood"){
      box(0,.12,0,1.5,.24,.21,"#a89776");box(.4,.1,.17,.45,.15,.34,"#baac8e");
    }else if(kind==="marker"){
      box(0,.2,0,.55,.4,.5,"#b7ae96");box(0,.45,0,.4,.15,.38,white);box(0,.47,.2,.17,.09,.035,blue);
    }else if(kind==="net"){
      for(let x=-.65;x<.7;x+=.16)box(x,0,0,.025,.9,.025,"#a29376");
      for(let y=-.4;y<.5;y+=.15)box(0,y,0,1.4,.025,.025,"#a29376");
    }else throw new Error(`Unknown Chora dressing: ${kind}`);
    const geometry=M.merge(...parts);geometry.castShadow=false;cache.set(kind,geometry);return geometry;
  };
  BL.dressing.chora=chora;
})();
