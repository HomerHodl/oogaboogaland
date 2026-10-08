// Factory props extend the shared dressing kit, with one immutable mesh per kind.
(() => {
  "use strict";
  const BL=window.BL,M=BL.models,cache=new Map(),portraits=new Map();
  const signs=new Map(),extra={"#":["101","111","101","111","101"],"$":["011","110","011","110","010"],"_":["000","000","000","000","111"]};
  BL.memeFactorySign=(parent,text,x,y,z,size,color)=>{
    const key=text+color;let geometry=signs.get(key);
    if(!geometry){geometry={verts:[],faces:[],lines:[],castShadow:false};const width=(text.length*4-1)*.16,ink=BL.math.hexToRgb(color);
      for(let i=0;i<text.length;i++){if(text[i]===" ")continue;const glyph=extra[text[i]]||BL.hubModels.SIGN_GLYPHS[text[i]]||BL.hubModels.SIGN_GLYPHS[text[i].toLowerCase()];if(!glyph)throw Error("Missing factory glyph "+text[i]);
        for(let r=0;r<5;r++)for(let c=0;c<3;c++)if(glyph[r][c]==="1"){const n=geometry.verts.length/3,a=i*.64+c*.16-width/2,b=(4-r)*.16;geometry.verts.push(a-.0675,b-.0675,.061,a+.0675,b-.0675,.061,a+.0675,b+.0675,.061,a-.0675,b+.0675,.061);geometry.faces.push({i:[n,n+1,n+2,n+3],color:ink,emissive:.6});}}
      signs.set(key,geometry);
    }
    const n=BL.scene.createNode({geometry,position:{x,y,z},scale:{x:size,y:size,z:size}});BL.scene.addChild(parent,n);return n;
  };
  BL.dressing.memeFactory=kind=>{
    if(cache.has(kind))return cache.get(kind);
    const parts=[],b=(c,x,y,z,w,h,d,e=0)=>{const g=M.box({color:c,w,h,d,emissive:e,offset:{x,y,z}});parts.push(g);return g;};
    const steel="#333a3f",black="#161b20",amber="#f4b669",blue="#699cd3";
    if(kind==="desk"){
      b("#71604d",0,1,0,3.8,.15,1.65);b(steel,0,.18,0,3.5,.1,1.3);
      for(const x of [-1.65,1.65])for(const z of [-.62,.62])b(steel,x,.48,z,.12,.96,.12);
      b(black,-1.05,1.12,.37,1.1,.055,.32);for(let i=0;i<13;i++)b("#737d84",-1.54+i*.08,1.153,.38,.05,.015,.19);
      b(black,.14,1.13,.36,.18,.06,.27);b("#b9a486",1.25,1.1,.42,.56,.035,.38);
      b(black,1.25,.61,-.15,.58,.98,1);for(let i=0;i<4;i++)b(blue,1.25,.44+i*.12,.36,.36,.02,.025,.55);
    }else if(kind==="monitor"){
      b(steel,0,.08,0,.65,.12,.4);b(steel,0,.34,-.06,.09,.52,.08);
      b(black,0,.82,-.06,1.5,.92,.12);b("#1c3445",0,.82,.009,1.36,.79,.025,.22);
      for(let i=0;i<5;i++)b(i===1?amber:blue,-.14,.57+i*.11,.03,.84-(i%3)*.12,.025,.015,.65);
      b(amber,-.53,.82,.03,.04,.6,.015,.8);b("#e8d7b6",.54,.97,.03,.15,.18,.015,.45);
    }else if(kind==="rack"){
      b(black,0,1.25,0,1.15,2.5,.9);
      for(let i=0;i<8;i++){
        const y=.22+i*.3;b(steel,0,y,.47,1.01,.24,.06);
        for(let j=0;j<5;j++)b("#13191e",-.35+j*.14,y,.506,.055,.12,.016);
        b(i%2?blue:amber,.42,y,.513,.05,.06,.02,.8);
      }
    }else if(kind==="mic"){
      b(black,0,.035,0,.35,.07,.3);b(steel,0,.32,0,.045,.59,.045);
      const arm=b(steel,.18,.61,0,.45,.045,.045);M.turnedZ(arm,-.35);
      b(black,.4,.7,0,.28,.13,.14);b("#7b8182",.54,.7,0,.055,.13,.14);
      b(steel,.62,.7,0,.025,.27,.25);
    }else if(kind==="chair"){
      b(black,0,.22,0,.13,.43,.13);b(steel,0,.08,0,1.05,.07,.16);b(steel,0,.08,0,.16,.07,.9);
      parts.push(M.bevelBox({color:"#41434a",w:1.2,h:.23,d:.95,bevel:.07,offset:{x:0,y:.52,z:0}}));
      parts.push(M.bevelBox({color:"#373b42",w:1.2,h:.83,d:.22,bevel:.06,offset:{x:0,y:1,z:.4}}));
      for(const x of [-.66,.66])b(black,x,.73,0,.11,.34,.92);
    }else if(kind==="files"){
      b("#3c4140",0,1.23,0,2.8,2.46,.85);
      for(let i=0;i<4;i++)for(let j=0;j<3;j++){
        const x=-.92+j*.92,y=.32+i*.58;b("#736656",x,y,.44,.82,.49,.045);
        b("#c4aa7a",x,y+.08,.473,.4,.1,.015);b(black,x,y-.09,.48,.26,.05,.04);
      }
    }else if(kind==="bookshelf"){
      for(const x of [-1.42,1.42])b(steel,x,1.6,0,.12,3.2,.8);
      for(let r=0;r<5;r++){
        const y=.15+r*.67;b("#7e6244",0,y,0,2.9,.1,.8);
        for(let i=0;i<12;i++)b(["#bc9f67","#333e49","#77402e","#8b7d62"][i%4],-1.23+i*.22,y+.29,-.03,.17,.45+(i%3)*.05,.48);
      }
    }else if(kind==="cart"){
      for(const x of [-.5,.5])for(const z of [-.35,.35]){b(black,x,.08,z,.15,.16,.15);b(steel,x,.55,z,.06,.9,.06);}
      for(const y of [.24,.96])b("#833c31",0,y,0,1.2,.1,.9);
      for(let i=0;i<4;i++){b("#aa9874",-.4+i*.27,.42,0,.22,.27,.55);b("#e1d2ad",-.4+i*.27,.45,.29,.13,.08,.015);}
    }else if(kind==="speaker"){
      b(black,0,.65,0,.68,1.3,.48);
      for(const y of [.32,.94]){b(steel,0,y,.25,.48,.46,.025);b("#0c1014",0,y,.273,.3,.29,.02);}
    }else if(kind==="acoustic"){
      b(black,0,0,0,1.4,2.2,.14);
      for(let i=0;i<11;i++)b(i%2?"#39434a":"#303940",-.63+i*.125,0,.1,.055,2.1,.12);
    }else if(kind==="box"){
      b("#8e7854",0,.22,0,.75,.44,.63);b("#c0a77d",0,.22,.325,.31,.13,.025);b("#544b3c",0,.453,0,.11,.018,.64);
    }else if(kind==="console"){
      b(black,0,.88,0,3.5,.3,1.25);
      for(let i=0;i<16;i++){
        const x=-1.54+i*.205;b(steel,x,1.04,.17,.018,.01,.54);b("#d4cfba",x,1.067,.2-(i%4)*.09,.11,.045,.055);
        for(let j=0;j<3;j++)b(j?blue:amber,x,1.067,-.45+j*.12,.05,.03,.05,.4);
      }
      for(const x of [-1.5,1.5])b(steel,x,.4,0,.12,.8,1.1);
    }
    const geometry=M.merge(...parts);cache.set(kind,geometry);return geometry;
  };
  BL.memeFactoryPortrait=id=>{
    if(portraits.has(id))return portraits.get(id);
    const p=BL.memeFactoryData.contributors.find(p=>p.id===id),g={verts:[],faces:[],lines:[],castShadow:false};
    // Merge equal-colour horizontal runs; one static geometry, no texture upload or live surface.
    for(let y=0;y<40;y++)for(let x=0;x<40;){
      const color=p.pixels.charCodeAt(y*40+x)-65;let end=x+1;while(end<40&&p.pixels.charCodeAt(y*40+end)-65===color)end++;
      const n=g.verts.length/3,x0=x/40-.5,x1=end/40-.5,y0=.5-y/40;g.verts.push(x0,y0-.025,0,x1,y0-.025,0,x1,y0,0,x0,y0,0);g.faces.push({i:[n,n+1,n+2,n+3],color:p.palette.slice(color*3,color*3+3),emissive:.55});x=end;
    }
    portraits.set(id,g);return g;
  };
})();
