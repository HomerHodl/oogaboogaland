// Immutable newsroom kit. Repeated shelves, books, lamps and covers share geometry.
(() => {
  "use strict";
  const BL=window.BL,M=BL.models,S=BL.scene,cache=new Map(),covers=new Map();
  const sign=BL.memeFactorySign; // Existing cached glyph mesh; no new text/rendering framework.
  BL.dressing.stackchain=kind=>{
    if(cache.has(kind))return cache.get(kind);
    const parts=[],b=(c,x,y,z,w,h,d,e=0)=>{const g=M.box({color:c,w,h,d,emissive:e,offset:{x,y,z}});parts.push(g);return g;};
    const wood="#684b33",dark="#20262b",brass="#b28b50",paper="#d7c8a5",leather="#67402d";
    if(kind==="shelf"){
      b("#242b2d",0,2.55,-.4,3.1,5.1,.13);
      for(const x of [-1.5,1.5])b(dark,x,2.55,0,.14,5.1,.95);
      for(let r=0;r<5;r++){const y=.22+r*1.01;b(wood,0,y,0,3.05,.13,1);b(brass,0,y+.1,.39,2.8,.04,.04,.65);}
      b(wood,0,5.13,0,3.25,.17,1.06);
    }else if(kind==="books"){
      for(let i=0;i<9;i++){const h=.35+(i%3)*.065,c=[paper,"#8e4e38","#45505a","#a58a50"][i%4];b(c,-.65+i*.16,h/2,0,.125,h,.38);b(brass,-.65+i*.16,.09,.195,.08,.025,.014);}
    }else if(kind==="stack"){
      for(let i=0;i<7;i++){b(i%2?paper:"#eee1bf",(i%3)*.014,.025+i*.04,0,.66,.035,.9);b([dark,"#aa683b","#5b6e79"][i%3],(i%3)*.014,.044+i*.04,0,.67,.009,.91);}
    }else if(kind==="pendant"){
      parts.push(M.lathe({profile:[[.04,.34],[.13,.29],[.47,.03],[.49,0],[.42,-.035]],segments:10,color:brass}));b("#ffc874",0,-.026,0,.54,.025,.54,.9);
    }else if(kind==="lamp"){
      b(brass,0,.025,0,.3,.05,.3);b(dark,0,.35,0,.035,.65,.035);
      parts.push(M.bevelBox({color:"#e3c28b",w:.52,h:.34,d:.48,bevel:.08,emissive:.3,offset:{x:0,y:.75,z:0}}));b("#ffc874",0,.58,0,.39,.025,.35,.9);
    }else if(kind==="desk"){
      b(wood,0,1.03,0,3.15,.14,1.55);for(const x of [-1.35,1.35])for(const z of [-.58,.58])b(dark,x,.5,z,.09,1,.09);
      b("#544534",-1,.53,0,.75,.95,1.18);for(let i=0;i<3;i++){b("#816449",-1,.26+i*.29,.604,.68,.26,.03);b(brass,-1,.29+i*.29,.638,.25,.035,.035);}
      b("#272a2b",.15,1.13,.35,.96,.045,.3);for(let i=0;i<11;i++)b("#808080",-.27+i*.085,1.157,.35,.055,.009,.17);
      b(paper,1.02,1.12,.31,.48,.04,.64);for(let i=0;i<5;i++)b("#625b4c",1.02,1.147,.1+i*.075,.31,.006,.009);
      b(brass,1.28,1.29,-.48,.14,.32,.14);for(let i=0;i<3;i++)b(dark,1.24+i*.04,1.47,-.48,.019,.27,.02);
    }else if(kind==="monitor"){
      b(dark,0,.035,0,.55,.07,.33);b(brass,0,.29,-.02,.055,.48,.055);b(dark,0,.73,0,1.3,.83,.1);
      b("#d3ccb7",0,.73,.058,1.15,.69,.025,.3);b("#344250",-.34,.74,.076,.32,.55,.012,.25);
      for(let i=0;i<7;i++)b("#55574f",.19,.48+i*.078,.076,.47-(i%3)*.07,.018,.012);
    }else if(kind==="chair"||kind==="leather"){
      const lounge=kind==="leather",w=lounge?1.6:1.15,d=lounge?1.32:1.02;
      for(const x of [-w*.38,w*.38])for(const z of [-d*.35,d*.35])b(dark,x,.2,z,.1,.4,.1);
      parts.push(M.bevelBox({color:leather,w,h:.28,d,bevel:.07,offset:{x:0,y:.53,z:0}}));
      parts.push(M.bevelBox({color:leather,w,h:.87,d:.24,bevel:.08,offset:{x:0,y:1.01,z:d*.41}}));
      for(const x of [-w*.46,w*.46])b(leather,x,.76,0,.16,.42,d*.93);
      for(const x of [-w*.27,0,w*.27])for(const y of [.89,1.17])b(brass,x,y,d*.275,.035,.035,.025);
    }else if(kind==="drawers"){
      b(wood,0,.68,0,2.6,1.36,.9);for(let r=0;r<3;r++)for(let c=0;c<3;c++){const x=-.84+c*.84,y=.24+r*.42;b("#7b6042",x,y,.46,.76,.35,.035);b(paper,x,y+.07,.485,.29,.06,.012);b(brass,x,y-.06,.5,.2,.035,.04);}
    }else if(kind==="inbox"){
      for(let i=0;i<3;i++){b(brass,0,.07+i*.18,0,.56,.03,.43);b(paper,0,.105+i*.18,0,.47,.035,.35);}for(const x of [-.26,.26])b(dark,x,.23,-.18,.025,.43,.025);
    }else if(kind==="rug"){
      for(let x=0;x<12;x++)for(let z=0;z<8;z++)b("#293039",-2.75+x*.5,0,-1.8375+z*.525,.5,.018,.525);
      for(const z of [-1.94,1.94]){b("#b2935f",0,.014,z,5.7,.008,.16);b("#5c332c",0,.022,z,5.4,.006,.05);}
      for(const x of [-2.84,2.84]){b("#b2935f",x,.014,0,.16,.008,3.8);b("#5c332c",x,.022,0,.05,.006,3.6);}
      for(let x=-2.5;x<2.6;x+=.5)for(const z of [-1.65,1.65]){const g=b("#947849",x,.02,z,.14,.012,.14);M.turnedY(g,.785);}
      for(const x of [-1.8,-.6,.6,1.8]){const g=b("#655a47",x,.016,0,.55,.01,.55);M.turnedY(g,.785);}
    }
    const g=M.merge(...parts);cache.set(kind,g);return g;
  };
  const cover=id=>{
    if(covers.has(id))return covers.get(id);
    const a=BL.stackchainArt[id],g={verts:[],faces:[],lines:[],castShadow:false},w=a.width,h=a.height;
    for(let y=0;y<h;y++)for(let x=0;x<w;){const color=a.pixels.charCodeAt(y*w+x)-65;let end=x+1;while(end<w&&a.pixels.charCodeAt(y*w+end)-65===color)end++;
      const n=g.verts.length/3,x0=x/w-.5,x1=end/w-.5,y0=.5-y/h;g.verts.push(x0,y0-1/h,0,x1,y0-1/h,0,x1,y0,0,x0,y0,0);g.faces.push({i:[n,n+1,n+2,n+3],color:a.palette.slice(color*3,color*3+3),emissive:.4});x=end;}
    covers.set(id,g);return g;
  };
  BL.stackchainModels={sign,cover,prop:(p,kind,x,y,z,yaw=0)=>{const n=S.createNode({geometry:BL.dressing.stackchain(kind),position:{x,y,z},rotation:{x:0,y:yaw,z:0}});if(kind==="rug")n.depthBias=-.08;S.addChild(p,n);return n;}};
})();
