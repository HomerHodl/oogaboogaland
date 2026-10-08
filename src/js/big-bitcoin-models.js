// Cached institutional dressing. Repeated furniture/stock is instanced by the shared renderer.
(() => {
  "use strict";
  const BL=window.BL,M=BL.models,cache=new Map();
  const C={black:"#242326",stone:"#454044",red:"#9e2028",gold:"#b89a62",light:"#e3c88d",paper:"#cabfa5",wood:"#43312c"};
  BL.dressing.bigBitcoin=(kind,variant=0)=>{
    const key=kind+":"+variant;if(cache.has(key))return cache.get(key);
    const parts=[],b=(c,x,y,z,w,h,d,e=0)=>{const g=M.box({w,h,d,color:c,emissive:e,offset:{x,y,z}});parts.push(g);return g;};
    const glyph=(x,y,z,s,color=C.gold)=>{
      const rows=["  x x  "," xxxxx "," xx  xx"," xx  xx"," xxxxx "," xx  xx"," xx  xx"," xxxxx ","  x x  "];
      for(let r=0;r<9;r++)for(let c=0;c<7;c++)if(rows[r][c]==="x")b(color,x+(c-3)*s,y+(4-r)*s,z,s*.96,s*.96,s*.65,.18);
    };
    const chart=(x,y,z,w,h,style)=>{
      b("#111b23",x,y,z,w,h,.055,.18);
      for(let i=0;i<4;i++)b("#28323a",x,y-h*.35+i*h*.23,z+.033,w*.92,.009,.005,.4);
      for(let i=0;i<16;i++){
        const v=.12+((i*7+style*11)%17)/25,xx=x-w*.44+i*w*.058,yy=y-h*.4;
        b(i%3===0?"#d54239":"#ae8951",xx,yy+v*h*.38,z+.039,w*.024,v*h*.76,.008,.65);
        b("#e5b97b",xx,yy+v*h*.8,z+.046,w*.05,.012,.006,.7);
      }
    };
    if(kind==="coin"){
      for(const [r,d,col] of [[1,.11,C.gold],[.92,.12,"#806235"],[.86,.135,C.gold],[.77,.15,"#9d7c42"]]){
        const g=M.lathe({profile:[[0,-d],[r,-d],[r,d],[0,d]],segments:48,color:col});M.turnedX(g,Math.PI/2);parts.push(g);
      }
      for(let i=0;i<40;i++){const a=i*Math.PI/20,g=b(C.light,Math.cos(a)*.925,Math.sin(a)*.925,.14,.07,.019,.035);M.turnedZ(g,a);}
      glyph(0,0,.19,.14,C.light);
    }else if(kind==="statue"){
      // An anonymous fictional block executive, not a likeness or a historical claim.
      const bronze="#978363",shade="#423e38";
      for(const x of [-.39,.39]){b(shade,x,.8,0,.63,1.6,.7);b("#302e2a",x,.12,.22,.68,.24,1);}
      b(shade,0,2.18,0,1.55,1.45,.85);b(bronze,0,2.45,.445,.53,.87,.08);b("#302d2b",0,2.4,.51,.18,.95,.08);
      b(bronze,0,3.48,.03,1.06,1.04,.87);b("#4b453c",0,3.99,0,1.08,.14,.9);
      for(const x of [-.26,.26]){b("#252526",x,3.61,.487,.25,.14,.08);b(bronze,x,3.75,.46,.36,.09,.1);}
      b("#665a46",0,3.23,.48,.45,.1,.09);b(bronze,0,3.44,.54,.2,.25,.22);
      b(shade,.95,2.2,0,.43,1.48,.51);b(bronze,.95,1.43,.04,.43,.32,.46);
      b(shade,-.96,2.77,0,.45,.8,.5);b(shade,-1.25,3.13,.05,.42,.43,.5);b(bronze,-1.25,3.64,.08,.48,.7,.3);
      for(let i=0;i<4;i++)b(bronze,-1.45+i*.14,4.06+(i%2)*.06,.08,.11,.35,.25);
    }else if(kind==="tile"){
      b(variant?"#514b48":"#464143",0,-.09,0,1.98,.18,1.98);
      for(let i=0;i<8;i++){const g=b(i%2?"#786c5a":"#5e5750",-.9+i*.23,.006,Math.sin(i*1.9+variant)*.7,.42,.007,.018);M.turnedY(g,.5+i*.4);}
    }else if(kind==="panel"){
      b(C.stone,0,0,0,2.36,3.75,.13);
      for(let i=0;i<11;i++){const g=b(i%3?"#5d5350":"#746151",-.95+i*.18,(i%4)*.7-1.1,.076,.6,.018,.014);M.turnedZ(g,.8+i*.4);}
      for(const x of [-1.2,1.2])b(C.gold,x,0,.08,.025,3.8,.02);
    }else if(kind==="chair"||kind==="pressChair"){
      const executive=kind==="chair",width=executive?1.18:1.06;
      for(const x of [-.43,.43])for(const z of [-.34,.34])b(C.black,x,.22,z,.09,.44,.09);
      b(C.black,0,.46,0,width,.22,.92);b(C.red,0,.59,.04,width-.14,.07,.77);
      b(C.black,0,executive?1.06:.94,.4,width,executive?1.12:.87,.21);
      for(const y of executive?[.85,1.15,1.43]:[.88,1.15])b(C.red,0,y,.278,width-.2,.21,.04);
      for(const x of [-width/2,width/2]){b(C.gold,x,.68,0,.055,.35,.6);b(C.black,x,.87,0,.12,.09,.78);}
    }else if(kind==="desk"){
      b(C.wood,0,.54,0,2.6,1.08,1.18);b("#1c2025",0,1.12,0,2.8,.12,1.35);
      for(const x of [-1.14,1.14]){b(C.gold,x,.52,.605,.025,.95,.02);for(const y of [.27,.62,.9])b(C.gold,x*.7,y,.61,.24,.04,.025);}
    }else if(kind==="monitor"){
      b(C.black,0,.025,0,.52,.05,.36);b(C.gold,0,.26,-.04,.07,.5,.07);b(C.black,0,.64,0,1.22,.76,.13);chart(0,.64,.081,1.1,.62,variant);
      b("#383438",0,.065,.5,.72,.07,.3);for(let i=0;i<8;i++)b(C.gold,-.3+i*.086,.103,.5,.03,.008,.16);
    }else if(kind==="screen"){
      b(C.black,0,0,0,3.8,2.15,.18);chart(0,0,.11,3.6,1.96,variant);
    }else if(kind==="map"){
      b("#171d22",0,0,0,5.6,3.3,.12);
      const rows=["    xxx        xx     ","  xxxxxx   xx xxxx    "," xxxxx    xxxxxxxxxx ","  xxxx     xxxxxxxx  ","   xx       xxx  xx  ","    xxx     xxx      ","     xx      x    xxx","     x           xxx"];
      for(let r=0;r<rows.length;r++)for(let c=0;c<rows[r].length;c++)if(rows[r][c]==="x")b((c+r)%3?C.red:C.gold,(c-10)*.23,(3.5-r)*.3,.087,.21,.27,.023,.4);
      for(const y of [-1.4,0,1.4])b("#4b3937",0,y,.079,5.4,.012,.015);
    }else if(kind==="lamp"){
      b(C.black,0,.04,0,.36,.08,.36);b(C.gold,0,.36,0,.065,.63,.065);b(C.light,0,.65,0,.48,.3,.38,.85);b(C.gold,0,.82,0,.5,.035,.4);
    }else if(kind==="sconce"){
      b(C.gold,0,0,-.09,.18,.64,.12);b(C.light,0,0,.07,.19,.45,.22,.9);b(C.black,0,.29,.06,.33,.1,.3);b(C.black,0,-.29,.06,.33,.1,.3);
    }else if(kind==="documents"){
      for(let i=0;i<5;i++)b(i%2?C.paper:C.red,0,.025+i*.047,0,.52,.04,.7);
      b(C.gold,-.18,.263,.02,.05,.012,.55);for(let i=0;i<6;i++)b("#716758",.07,.264,-.2+i*.075,.19,.009,.014);
    }else if(kind==="bookcase"){
      b(C.wood,0,1.8,-.3,2.7,3.6,.15);
      for(const x of [-1.34,1.34])b(C.black,x,1.8,0,.12,3.6,.72);
      for(let row=0;row<5;row++){
        const y=.15+row*.72;b(C.gold,0,y,0,2.65,.07,.75);
        for(let i=0;i<11;i++){const h=.36+((i*3+row+variant)%4)*.07,c=[C.red,C.paper,"#303235",C.gold][(i+row+variant)%4];b(c,-1.14+i*.23,y+.06+h/2,.03,.18,h,.43);for(const yy of [-.12,.1])b(C.gold,-1.14+i*.23,y+.06+h/2+yy,.253,.12,.018,.012);}
      }
    }else if(kind==="cabinet"){
      b(C.black,0,1.18,0,1.25,2.36,.74);for(let i=0;i<6;i++){b("#484143",0,.23+i*.37,.4,1.12,.32,.05);b(C.paper,0,.25+i*.37,.437,.27,.07,.016);b(C.gold,0,.12+i*.37,.449,.23,.045,.05);}
    }else if(kind==="camera"){
      b(C.black,0,1.9,0,.52,.4,.72);b("#555057",0,1.9,-.48,.34,.3,.26);b("#403b38",0,1.47,0,.1,.6,.1);
      for(let i=0;i<3;i++){const g=M.box({w:.07,h:1.45,d:.07,color:C.gold});M.turnedZ(g,.36);M.turnedY(g,i*2.094);M.moved(g,Math.cos(i*2.094)*.23,.72,Math.sin(i*2.094)*.23);parts.push(g);}
      b(C.red,.29,1.95,.1,.025,.04,.04,.8);
    }else if(kind==="hardware"){
      b("#71685a",0,.29,0,.78,.57,.57);b(C.black,0,.31,.301,.61,.39,.04);b("#667d67",0,.31,.33,.49,.3,.024,.18);b(C.black,0,.04,.46,.84,.08,.36);
      for(let i=0;i<8;i++)b(C.paper,-.33+i*.094,.085,.47,.05,.018,.22);
    }else if(kind==="planter"){
      b(C.black,0,.37,0,.7,.74,.7);b(C.gold,0,.73,0,.77,.07,.77);
      for(let i=0;i<14;i++){const a=i*2.4,g=M.box({w:.14,h:.85+i%3*.22,d:.06,color:i%2?"#616c43":"#374d32"});M.turnedZ(g,.45);M.turnedY(g,a);M.moved(g,Math.cos(a)*.3,1.3,Math.sin(a)*.3);parts.push(g);}
    }else if(kind==="shirt"){
      b(variant?C.paper:C.black,0,.43,0,.6,.83,.16);for(const s of [-1,1])b(variant?C.paper:C.black,s*.4,.73,0,.23,.28,.18);
      b(C.gold,0,.93,-.04,.74,.035,.045);b(C.gold,0,1.03,-.04,.03,.2,.03);glyph(0,.48,.095,.037,C.red);
    }else if(kind==="cap"){
      b(C.red,0,.15,0,.43,.25,.36);b(C.red,0,.025,.2,.5,.05,.32);b(C.gold,0,.16,.19,.1,.1,.015);
    }else if(kind==="folded"){
      for(let i=0;i<4;i++){b(i%2?C.black:C.red,0,.045+i*.09,0,.65,.08,.48);b(C.gold,.17,.052+i*.09,.247,.11,.025,.01);}
    }
    const geometry=M.merge(...parts);cache.set(key,geometry);return geometry;
  };
})();
