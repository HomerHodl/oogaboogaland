// Shared, cached workshop assemblies. Repeated stock uses the renderer's existing instancing.
(() => {
  "use strict";
  const BL=window.BL,M=BL.models,cache=new Map(),C={ink:"#202326",bone:"#d8cbb1",orange:"#e68a35",wood:"#876647",steel:"#42494b",sage:"#65735a"};
  BL.dressing.proofOfInk=(kind,tone="ink")=>{
    const key=kind+":"+tone;if(cache.has(key))return cache.get(key);
    const parts=[],color=C[tone]||C.ink;
    const b=(c,x,y,z,w,h,d,e=0)=>{const g=M.box({w,h,d,color:c,emissive:e,offset:{x,y,z}});parts.push(g);return g;};
    const nib=(x,y,z,s=.08)=>{const rows=["   o   ","  ooo  "," ooooo ","ooo ooo","ooo ooo"," oo oo "," oo oo ","  o o  ","  o o  "];for(let r=0;r<rows.length;r++)for(let c=0;c<7;c++)if(rows[r][c]==="o")b(C.orange,x+(c-3)*s,y+(4-r)*s,z,s,s,.025);};
    if(kind==="nib")nib(0,0,0,.12);
    else if(kind==="shirt"||kind==="hoodie"){
      b(color,0,.42,0,.55,.72,.14);for(const s of [-1,1]){const g=b(color,s*.37,kind==="hoodie"?.43:.66,0,.23,kind==="hoodie"?.7:.26,.17);M.turnedZ(g,s*.13);}
      b(C.wood,0,.83,-.025,.7,.05,.045);b(C.steel,0,.9,-.025,.035,.15,.035);
      if(kind==="hoodie"){b(color,0,.84,-.07,.32,.24,.25);b(C.ink,0,.84,.07,.18,.14,.025);b(color,0,.25,.09,.35,.15,.045);}
      nib(0,.48,.084,.03);b(C.bone,0,.21,.084,.23,.015,.015);
    }else if(kind==="folded"){
      for(let i=0;i<4;i++){b(color,0,.04+i*.08,0,.66,.073,.44);b(tone==="bone"?"#a89c89":"#515452",0,.045+i*.08,.226,.61,.012,.01);}b(C.orange,.18,.33,0,.09,.015,.14);
    }else if(kind==="cap"){
      b(color,0,.16,0,.42,.24,.36);b(color,0,.28,0,.31,.045,.28);b(color,0,.055,.2,.46,.05,.29);nib(0,.16,.188,.016);
    }else if(kind==="table"){
      b(C.wood,0,1.02,0,2.5,.14,1.35);b("#5a4534",0,.26,0,2.4,.1,1.24);
      for(const x of [-1.12,1.12])for(const z of [-.53,.53])b(C.steel,x,.51,z,.13,1.02,.13);
      b("#b99062",0,1.1,0,2.4,.015,1.24);
    }else if(kind==="ink"){
      b(color,0,.14,0,.21,.27,.21);b(C.steel,0,.295,0,.235,.045,.235);b(C.bone,0,.15,.11,.16,.11,.014);b(C.orange,0,.15,.12,.045,.055,.015);
    }else if(kind==="box"){
      b("#9b7d56",0,.22,0,.6,.44,.48);b("#baa070",0,.447,0,.095,.015,.48);b(C.bone,0,.23,.25,.23,.12,.02);b(C.ink,-.1,.23,.265,.017,.085,.01);
    }else if(kind==="books"){
      for(let i=0;i<4;i++){b(i%2?C.bone:C.ink,0,.04+i*.08,0,.56-i*.015,.072,.43);b(C.orange,-.19,.04+i*.08,.22,.035,.045,.014);}
    }else if(kind==="pins"){
      b(C.wood,0,.035,0,.7,.07,.5);b(C.ink,0,.078,0,.62,.015,.42);
      for(let x=-.22;x<.3;x+=.22)for(const z of [-.12,.12]){b(C.bone,x,.098,z,.13,.023,.14);b(C.orange,x,.115,z,.065,.013,.065);}
    }else if(kind==="screen"){
      b("#a18c63",0,0,0,1.08,1.32,.09);b("#b8b39c",0,0,.053,.89,1.13,.014);nib(0,0,.066,.071);
      for(const x of [-.4,.4])b(C.steel,x,-.58,.069,.07,.11,.025);
    }else if(kind==="press"){
      b(C.steel,0,.12,0,1.7,.24,1.6);b("#566366",0,.65,0,.45,1.05,.45);b(C.orange,0,1.15,0,.66,.16,.66);
      for(let i=0;i<4;i++){
        const a=i*Math.PI/2,assembly=[];const add=(g)=>{assembly.push(g);return g;};
        add(M.box({w:.14,h:.17,d:1.65,color:C.steel,offset:{x:0,y:1.14,z:.9}}));
        add(M.box({w:.76,h:.085,d:1.05,color:C.bone,offset:{x:0,y:1.25,z:1.03}}));
        const frame=M.box({w:1,h:1.3,d:.08,color:C.wood});const mesh=M.box({w:.84,h:1.1,d:.02,color:"#c4bba1",offset:{x:0,y:0,z:.05}});
        const mark=M.box({w:.17,h:.58,d:.018,color:C.orange,offset:{x:0,y:0,z:.07}});
        const bar=M.box({w:.45,h:.16,d:.018,color:C.orange,offset:{x:0,y:.08,z:.07}});
        const face=M.merge(frame,mesh,mark,bar);M.turnedX(face,-.8);M.moved(face,0,1.88,.86);assembly.push(face);
        add(M.box({w:.94,h:.07,d:.07,color:C.orange,offset:{x:0,y:1.95,z:1.05}}));
        for(const g of assembly){M.turnedY(g,a);parts.push(g);}
      }
    }else if(kind==="dryer"){
      for(const x of [-.65,.65])for(const z of [-.43,.43])b(C.steel,x,1.34,z,.09,2.6,.09);
      for(let i=0;i<13;i++){const y=.21+i*.2;b("#aeb1a6",0,y,0,1.4,.035,.96);if(i%3!==0)b(C.bone,0,y+.026,.04,1.12,.015,.7);}
      for(const x of [-.58,.58])for(const z of [-.39,.39])b(C.ink,x,.1,z,.14,.16,.14);
    }else if(kind==="tools"){
      b("#786349",0,0,0,2.8,1.65,.07);
      for(let i=0;i<10;i++){const x=-1.18+i*.26;b(C.steel,x,.07,.07,.055,.7-(i%3)*.12,.045);b(i%2?C.orange:C.bone,x,.43,.085,.12,.26,.06);}
      for(const y of [-.64,.64])for(let x=-1.25;x<1.3;x+=.25)b(C.ink,x,y,.044,.025,.025,.015);
    }else if(kind==="printbin"){
      for(const x of [-.64,.64])b(C.steel,x,.45,0,.1,.9,.74);b(C.wood,0,.3,0,1.4,.1,.8);b(C.wood,0,.7,.32,1.4,.25,.09);
      for(let i=0;i<7;i++){const g=b(i%2?C.bone:"#c5b28e",0,.83,-.27+i*.08,1.16,1.02,.025);M.turnedX(g,-.1);}
    }else if(kind==="chair"){
      for(const x of [-.5,.5])for(const z of [-.33,.33])b(C.steel,x,.22,z,.09,.44,.09);
      b("#695649",0,.49,0,1.2,.21,.92);b("#806956",0,.88,.38,1.2,.68,.2);
      for(const x of [-.66,.66])b(C.wood,x,.65,0,.12,.38,1);
    }else if(kind==="planter"){
      b("#696762",0,.27,0,.6,.54,.6);b("#939080",0,.57,0,.67,.08,.67);b("#303528",0,.62,0,.5,.025,.5);
      for(let i=0;i<12;i++){const a=i*2.4,g=M.box({w:.15,h:.6+(i%3)*.22,d:.085,color:i%2?"#78835b":"#485a3d"});M.turnedZ(g,.48);M.turnedY(g,a);M.moved(g,Math.cos(a)*.24,1.02,Math.sin(a)*.24);parts.push(g);}
    }else if(kind==="lamp"){
      b(C.ink,0,.04,0,.27,.08,.27);b("#ffcb7b",0,.23,0,.19,.3,.19,.9);b(C.ink,0,.42,0,.3,.08,.3);
      for(const x of [-.12,.12])for(const z of [-.12,.12])b(C.steel,x,.23,z,.025,.36,.025);
    }
    const geometry=M.merge(...parts);cache.set(key,geometry);return geometry;
  };
})();
