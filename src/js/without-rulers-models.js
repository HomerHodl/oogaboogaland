// Cached retail pieces extend the shared dressing kit; no textures or remote assets in the room.
(() => {
  "use strict";
  const BL=window.BL,M=BL.models,cache=new Map();
  const C={ink:"#17191a",bone:"#e2d7bf",orange:"#ef8829",wood:"#886344",metal:"#383b3b"};
  BL.dressing.withoutRulers=(kind,tone="ink")=>{
    const key=kind+":"+tone;if(cache.has(key))return cache.get(key);
    const parts=[],color=C[tone]||C.ink;
    const b=(c,x,y,z,w,h,d,e=0)=>{const g=M.box({w,h,d,color:c,emissive:e,offset:{x,y,z}});parts.push(g);return g;};
    const pixel=(rows,colors,cell,x=0,y=0,z=.035)=>{for(let r=0;r<rows.length;r++)for(let c=0;c<rows[r].length;c++)if(colors[rows[r][c]])b(colors[rows[r][c]],x+(c-(rows[r].length-1)/2)*cell,y+(rows.length-1-r)*cell,z,cell,cell,.025);};
    const skull=(x,y,z,cell=.03)=>pixel([" bbbbb ","bbbbbbb","bb b bb","bbbbbbb"," bbbbb "," b b b "],{b:C.bone},cell,x,y,z);
    const bitcoin=(x,y,z,cell=.025)=>pixel([" oo  ","oooo "," o oo"," ooo "," o oo","oooo "," oo  "],{o:C.orange},cell,x,y,z);
    if(kind==="shirt"||kind==="hoodie"){
      b(color,0,.39,0,.58,.75,.13);
      for(const s of [-1,1]){const sleeve=b(color,s*.39,kind==="hoodie"?.42:.64,0,.24,kind==="hoodie"?.72:.28,.18);M.turnedZ(sleeve,s*.14);}
      b(C.metal,0,.78,.01,.25,.08,.14);b(C.wood,0,.87,-.05,.72,.055,.045);b(C.metal,0,.94,-.05,.04,.13,.04);
      b(tone==="bone"?"#a69783":"#4a4b47",0,.05,.072,.55,.045,.025);
      if(kind==="hoodie"){b(color,0,.84,-.07,.34,.26,.24);b(C.ink,0,.83,.061,.21,.16,.025);b(color,0,.24,.087,.35,.18,.04);for(const x of [-.13,.13])b(C.bone,x,.62,.08,.018,.23,.015);}
      if(tone==="orange")skull(0,.36,.086,.042);else bitcoin(0,.37,.093,.038);
      for(const y of [.67,.62])b(tone==="bone"?C.ink:C.bone,0,y,.092,.28,.016,.015);
    }else if(kind==="folded"){
      for(let i=0;i<4;i++){b(color,0,.05+i*.095,0,.68,.085,.47);b(tone==="bone"?"#b8ad98":"#434444",0,.045+i*.095,.239,.62,.018,.012);}
      b(tone==="bone"?C.ink:C.bone,0,.435,0,.16,.014,.1);b(C.orange,.26,.3,.252,.065,.1,.023);
    }else if(kind==="cap"){
      b(color,0,.15,0,.43,.24,.37);b(color,0,.275,.025,.32,.05,.28);b(color,0,.075,.2,.47,.045,.3);b(C.orange,0,.16,.191,.11,.095,.014);b(C.metal,0,.31,.03,.05,.025,.05);
      for(const x of [-.15,.15])b(tone==="bone"?"#998b78":"#51514c",x,.17,.185,.012,.15,.015);
    }else if(kind==="mannequin"){
      b(C.metal,0,.055,0,.75,.11,.65);
      for(const x of [-.16,.16]){b(C.bone,x,.43,0,.23,.66,.23);b(C.ink,x,.14,.05,.27,.14,.39);}
      b(color,0,1.02,0,.68,.67,.31);for(const x of [-.44,.44])b(color,x,.93,0,.18,.78,.23);
      b(C.bone,0,1.44,0,.18,.2,.18);b(C.bone,0,1.68,.01,.36,.36,.32);
      b(C.ink,0,1.88,.01,.44,.12,.37);b(C.ink,0,1.845,.2,.46,.055,.25);bitcoin(0,.85,.174,.042);
    }else if(kind==="chair"){
      b(C.wood,0,.2,0,1.2,.4,.9);parts.push(M.bevelBox({w:1.3,h:.2,d:1,color:"#565554",bevel:.06,offset:{x:0,y:.51,z:0}}));
      parts.push(M.bevelBox({w:1.3,h:.69,d:.22,color:"#66615b",bevel:.06,offset:{x:0,y:.94,z:.43}}));
      for(const x of [-.68,.68])b(C.ink,x,.68,0,.12,.45,1.02);
      for(const x of [-.37,0,.37])b(C.metal,x,.94,.307,.023,.035,.02);
    }else if(kind==="planter"){
      b("#5d5951",0,.28,0,.62,.56,.62);b("#837968",0,.56,0,.69,.1,.69);b("#29291e",0,.618,0,.53,.015,.53);
      for(let i=0;i<10;i++){const a=i*2.4,h=.4+(i%3)*.15;const g=M.box({w:.15,h:h+.3,d:.09,color:i%2?"#637044":"#3d5035"});M.turnedZ(g,.48);M.turnedY(g,a);M.moved(g,Math.cos(a)*.2,.77+h*.5,Math.sin(a)*.2);parts.push(g);}
    }else if(kind==="lantern"){
      b(C.metal,0,.04,0,.28,.08,.28);b("#ffd18a",0,.24,0,.18,.3,.18,.85);b(C.metal,0,.44,0,.31,.08,.31);
      for(const x of [-.12,.12])for(const z of [-.12,.12])b(C.metal,x,.24,z,.03,.36,.03);
      b(C.wood,0,.52,0,.045,.12,.045);
    }else if(kind==="books"){
      for(let i=0;i<4;i++){b(i%2?C.bone:C.ink,0,.045+i*.09,0,.62-i*.025,.08,.43);b(C.orange,-.21,.045+i*.09,.221,.03,.06,.016);}
    }else if(kind==="art-bip85"){
      for(let i=0;i<7;i++){const x=(i-3)*.2,y=.1+Math.abs(i-3)*.12;b(i%2?C.wood:C.orange,x,y,0,.17,.3,.05);b(C.bone,x,y+.2,.02,.07,.07,.04);}
      bitcoin(0,.75,.03,.06);
    }else if(kind==="art-samourai"){
      pixel(["   bbbb   ","  bbbbbbb ","   kkkk   ","   kkkk   ","  kkkkkk  "," kkkkkkkk ","k kkkkkk k","k kkkkkk k","  kkkkkk  ","  kk  kk  ","  kk  kk  "," bbb  bbb "],{b:C.bone,k:C.ink},.095,0,-.4,.02);
      const sword=b(C.orange,.59,.39,.06,.045,1.6,.035);M.turnedZ(sword,-.35);
    }else if(kind==="art-slavery"){
      skull(0,.15,.03,.16);bitcoin(0,-.47,.06,.055);
      for(const s of [-1,1])for(let i=0;i<4;i++)b(C.metal,s*(.47+i*.08),-.35+i*.23,.015,.13,.15,.04);
    }else if(kind==="art-cartel"){
      b(C.bone,0,.74,0,1.4,.12,.05);b(C.bone,0,.94,0,.92,.13,.05);b(C.bone,0,1.08,0,.43,.12,.05);
      for(const x of [-.5,0,.5])b(C.bone,x,.36,0,.14,.65,.05);
      for(let i=0;i<7;i++){const a=(i-3)*.33;for(let j=0;j<4;j++)b(C.bone,Math.sin(a)*(j+1)*.23,-.05-j*.16,0,.1,.17,.05);}
    }else if(kind==="art-2140"){
      for(let i=0;i<9;i++){const h=.2+(i*7%5)*.16;b(i%2?C.metal:"#777265",(i-4)*.16,h/2-.48,0,.13,h,.05);}
      bitcoin(0,.61,.04,.07);for(let i=0;i<5;i++)b(C.orange,0,.35-i*.13,.02,.03,.075,.025);
    }else if(kind==="skull")skull(0,-.25,0,.11);
    const geometry=M.merge(...parts);cache.set(key,geometry);return geometry;
  };
})();
