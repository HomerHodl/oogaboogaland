// Boutique display studies, not replicas or claims about particular products. Immutable shared meshes.
(() => {
  "use strict";
  const BL=window.BL,M=BL.models,S=BL.scene,cache=new Map();
  const geometry=(kind,tone="cream",motif="bitcoin")=>{
    const key=[kind,tone,motif].join(":");if(cache.has(key))return cache.get(key);
    const parts=[],b=(c,x,y,z,w,h,d,e=0)=>parts.push(M.box({color:c,w,h,d,emissive:e,offset:{x,y,z}}));
    const dark="#252321",metal="#32302c",wood="#694b34",brass="#a17a49",cream="#e6dcc7",amber="#ffc579",color=tone==="cream"?cream:tone==="orange"?"#b75f29":"#242526",ink=tone==="cream"?dark:cream;
    if(kind==="shirt"||kind==="hoodie"){
      b(color,0,.5,0,.65,.86,.14);b(color,0,.095,0,.67,.055,.16);
      for(const side of [-1,1]){const p=M.box({color,w:.23,h:kind==="hoodie"?.78:.36,d:.16,offset:{x:side*.4,y:kind==="hoodie"?.44:.75,z:0}});M.turnedZ(p,-side*.16);parts.push(p);}
      b(dark,0,.92,.005,.21,.075,.15);
      if(kind==="hoodie"){b(color,0,.97,-.06,.37,.31,.26);b(dark,0,1,.087,.23,.18,.014);b(tone==="cream"?"#cabea9":"#3b3a39",0,.3,.08,.38,.16,.02);for(const x of [-.09,.09])b(cream,x,.75,.1,.018,.26,.018);}
      // A rail hook and wooden hanger physically support every wall garment.
      b(wood,0,1.14,-.035,.62,.045,.04);b(brass,0,1.24,-.035,.025,.18,.025);b(brass,.03,1.32,-.035,.08,.025,.025);
      if(motif==="faith"){b(ink,0,.6,.083,.052,.3,.014);b(ink,0,.65,.083,.23,.052,.014);}
      else {const g=BL.dsbModels.text("B",ink);parts.push(M.moved(M.merge(g),0,.38,.088));const last=parts.pop();for(let i=0;i<last.verts.length;i+=3){last.verts[i]*=.33;last.verts[i+1]=.43+(last.verts[i+1]-.38)*.33;}parts.push(last);for(const x of [-.045,.045])b(ink,x,.61,.085,.022,.29,.018);}
    }else if(kind==="folded"){
      for(let i=0;i<4;i++){const c=i%2?color:(tone==="cream"?"#d2c4ac":"#353432");b(c,(i%2)*.018,.046+i*.09,0,.62,.082,.52);b(brass,.22,.052+i*.09,.265,.08,.025,.015);}
    }else if(kind==="cap"){
      parts.push(M.lathe({profile:[[0,.31],[.12,.29],[.22,.19],[.23,.045]],segments:10,color}));b(color,0,.035,.19,.43,.04,.47);b(ink,0,.18,.205,.1,.075,.02);
    }else if(kind==="bay"){
      b(dark,0,2.6,-.53,3.4,5.2,.14);
      for(const x of [-1.63,1.63])b(metal,x,2.6,0,.1,5.2,1.1);
      for(const y of [.18,1,3.1,4.9]){b(wood,0,y,0,3.4,.14,1.12);b(amber,0,y-.09,.45,3.18,.035,.035,.8);}
      b(brass,0,2.64,.15,3.13,.04,.04);for(const x of [-1.5,1.5])b(metal,x,2.7,-.15,.045,.045,.63);
      b(brass,0,.06,.48,3.2,.04,.045);
    }else if(kind==="pendant"){
      b(metal,0,.45,0,.035,.9,.035);for(const x of [-.28,.28])for(const z of [-.28,.28])b(metal,x,-.14,z,.035,.54,.035);
      for(const y of [-.4,.12]){b(metal,0,y,0,.63,.045,.63);}
      b(amber,0,-.12,0,.22,.37,.22,.85);
    }else if(kind==="mannequin"){
      b(metal,0,.04,0,.7,.08,.65);b(brass,0,.32,0,.06,.55,.06);
      for(const x of [-.16,.16]){b(dark,x,.67,0,.23,.9,.24);b(dark,x,.25,.09,.26,.14,.43);}
      b(color,0,1.35,0,.6,.65,.34);for(const x of [-.4,.4])b(color,x,1.24,0,.2,.78,.26);
      b(wood,0,1.94,0,.31,.42,.3);b(ink,0,1.42,.178,.07,.27,.015);b(ink,0,1.49,.178,.22,.05,.015);
    }else if(kind==="rug"){
      b("#392b27",0,.008,0,5.6,.016,3.7);
      for(const z of [-1.7,1.7])b(cream,0,.02,z,5.35,.01,.12);
      for(const x of [-2.62,2.62])b(cream,x,.02,0,.12,.01,3.4);
      for(let x=-2.3;x<2.4;x+=.46)for(const z of [-1.42,1.42]){const p=M.box({color:brass,w:.17,h:.01,d:.17,offset:{x,y:.028,z}});M.turnedY(p,.785);parts.push(p);}
      for(const x of [-1.5,0,1.5]){const p=M.box({color:"#986245",w:.8,h:.01,d:.8,offset:{x,y:.024,z:0}});M.turnedY(p,.785);parts.push(p);}
    }
    const g=M.merge(...parts);cache.set(key,g);return g;
  };
  const prop=(p,kind,x,y,z,tone="cream",motif="bitcoin",yaw=0)=>{const n=S.createNode({geometry:geometry(kind,tone,motif),position:{x,y,z},rotation:{x:0,y:yaw,z:0}});S.addChild(p,n);return n;};
  BL.svrnModels={geometry,prop,sign:BL.memeFactorySign};
})();
