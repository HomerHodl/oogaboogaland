// Mediterranean extension of the shared dressing kit, like its cached palm/islet builders.
// Chunky opaque blocks, no textures, alpha cards, emissive flowers or per-plant materials.
(() => {
  "use strict";
  const BL = window.BL, M = BL.models, cache = new Map();
  const mediterranean = kind => {
    if (cache.has(kind)) return cache.get(kind);
    const parts = [], rand = BL.math.mulberry32(BL.math.fnv1a(kind));
    const block = (x,y,z,w,h,d,color,turn=0) => {
      const g=M.box({w,h,d,color});
      if(turn) M.turnedZ(g,turn);
      parts.push(M.moved(g,x,y,z));
    };
    if(kind === "olive") {
      block(0,.95,0,.42,1.9,.4,"#74644e");
      block(-.4,1.8,0,.23,1.5,.24,"#817057",-.6);
      block(.45,1.9,.1,.23,1.5,.24,"#74644e",.65);
      for(let i=0;i<11;i++) {
        const a=i*2.4,r=.4+rand()*1.15;
        block(Math.cos(a)*r,2.25+rand()*.95,Math.sin(a)*r,1+rand()*.8,.65+rand()*.4,.85+rand()*.65,["#7d8861","#939d77","#657650","#a3aa88"][i%4]);
      }
    } else if(kind === "cypress") {
      block(0,.5,0,.28,1,.28,"#756449");
      for(let i=0;i<8;i++) {
        const w=(1-i/9)*1.05;
        block(Math.sin(i)*.08,.9+i*.57,Math.cos(i)*.06,w,.85,w,["#425d43","#526b49","#5f7652"][i%3]);
      }
    } else if(kind === "shrub" || kind === "cover") {
      for(let i=0;i<6;i++) {
        const a=i*2.4, r=i*.09, h=.26+rand()*.35;
        block(Math.cos(a)*r,h/2,Math.sin(a)*r,.4+rand()*.35,h,.42+rand()*.25,["#81875b","#6d784e","#929367"][i%3]);
      }
    } else if(kind === "grass" || kind === "flowers") {
      for(let i=0;i<7;i++) {
        const x=(rand()-.5)*.65,z=(rand()-.5)*.65,h=.24+rand()*.4;
        block(x,h/2,z,.055,h,.065,kind==="grass"?["#b2a36b","#c6b47e","#92915c"][i%3]:"#768151");
        if(kind==="flowers")block(x,h,z,.14,.1,.14,["#dac894","#b69aad","#e2dbc5"][i%3]);
      }
    } else if(kind === "rock") {
      block(0,.3,0,1.55,.6,1.15,"#aba58f");
      block(-.15,.7,.02,1.16,.45,.95,"#bdb49b");
      block(.18,.91,-.03,.64,.2,.65,"#c9c0a9");
      block(.65,.19,.15,.65,.38,.6,"#928f7e");
    } else if(kind === "bougainvillea") {
      block(0,1.15,0,.08,2.3,.08,"#827155");
      for(let i=0;i<12;i++) {
        const x=Math.sin(i*2.2)*.26,y=.45+i*.23,z=Math.cos(i*2.2)*.19;
        block(x,y,z,.4,.32,.35,i%3?"#68804d":"#80915b");
        block(x+.09,y+.15,z+.1,.28,.23,.25,["#b54d82","#cc639b","#d786ac"][i%3]);
      }
    } else if(kind === "planter") {
      block(0,.22,0,.6,.44,.6,"#b78b6b");
      block(0,.45,0,.67,.12,.67,"#c69a78");
      block(0,.53,0,.5,.12,.5,"#687b4e");
      for(let i=0;i<5;i++)block(Math.cos(i*2.4)*.22,.66+rand()*.15,Math.sin(i*2.4)*.22,.18,.18,.18,["#d59aaa","#e0d0ba"][i%2]);
    } else throw new Error(`Unknown Mediterranean dressing: ${kind}`);
    const geometry=M.merge(...parts);
    geometry.castShadow=kind==="olive"||kind==="cypress";
    cache.set(kind,geometry);
    return geometry;
  };
  BL.dressing.mediterranean=mediterranean;
})();
