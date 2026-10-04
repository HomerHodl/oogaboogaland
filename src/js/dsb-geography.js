// Milestone 1: one sampled land surface owns rendering, paths and character support.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {}, S = BL.scene, M = BL.models;
  const STEP = 1.5, MIN = -99, N = 133, C = BL.dsbCoast;
  const coast = [[-89,-70],[-72,-80],[-54,-88],[-31,-83],[-15,-73],[1,-69],[14,-55],[32,-53],[39,-40],[55,-45],[69,-30],[65,-12],[82,-5],[87,14],[77,25],[78,39],[69,49],[57,70],[42,74],[31,70],[20,76],[3,70],[-2,63],[-20,60],[-30,43],[-47,43],[-56,61],[-68,59],[-77,46],[-73,31],[-86,18],[-82,1],[-94,-19],[-88,-39]];
  // Start five metres in front of Portara; descend the inhabited face, then
  // round only its eastern shoulder. The trail stops at the side clearing.
  // Entries are [x, z, grading height]; walking reads the resulting mesh surface.
  const trail = [[-45,-43,39],[-42,-39,39],[-18,-31,34],[-49,-19,27],[-18,-6,20],[-39,6,12],[-30,12,9],[-22,12,7],[-16,9,5.8],[-13,5,5]];
  const waterfront = [[-68,48],[-57,37],[-38,34],[-19,42],[0,56],[20,65],[44,62],[62,49],[72,31]];
  const lanes = [[[8,48],[22,41],[43,40],[62,32]],[[19,61],[22,41],[18,23]],[[43,60],[43,40],[50,22]],[[0,56],[0,38],[-8,23]],[[18,23],[25,11],[45,9],[62,18]],[[50,22],[45,9],[48,-7]],[[25,11],[17,-5],[31,-16]]];
  const properties = [
    ["Meme Factory House",12,53,7,7,5.8,true], ["DSB Studio Stage",30,54,10,6,4.4,true],
    ["Maxis Club Theater",53,48,9,8,6,true], ["Without Rulers Shop",10,34,6,6,4.6,false],
    ["Big Bitcoin",31,33,7,7,6.5,false], ["Stackchain Magazine",53,27,7,6,5,false],
    ["Proof Of Ink",62,39,5,5,4.5,false], ["VACANT 1",31,45,5,5,4,false],
    ["VACANT 2",10,23,6,5,4.6,false], ["VACANT 3",36,23,6,5,4.8,false],
    ["VACANT 4",56,40,3,3,4.4,false], ["VACANT 5",4,44,4,5,4,false],
    ["VACANT 6",8,13,6,6,5,false], ["VACANT 7",17,14,5,5,4.5,false],
    ["VACANT 8",32,16,6,5,5.5,false], ["VACANT 9",39,17,5,5,4.5,false],
    ["VACANT 10",60,9,6,5,5,false], ["VACANT 11",64,25,5,5,4.5,false],
    ["VACANT 12",25,2,6,6,5,false], ["VACANT 13",36,2,7,6,5.5,false],
    ["VACANT 14",54,1,5,6,4.5,false], ["VACANT 15",9,-2,5,6,4,false],
    ["VACANT 16",19,-16,6,5,5,false], ["VACANT 17",39,-9,6,5,4.5,false],
    ["VACANT 18",32,-21,5,5,4,false], ["VACANT 19",57,57,4,4,4,true],
    ["VACANT 20",26,60,4,4,4.5,true], ["VACANT 21",5,51,4,4,4,true]
  ];
  const closest = (line,x,z) => {
    let d=Infinity, px=0,pz=0,y=0;
    for(let i=1;i<line.length;i++) { const a=line[i-1],b=line[i],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz))),qx=a[0]+dx*t,qz=a[1]+dz*t,dist=Math.hypot(x-qx,z-qz); if(dist<d){d=dist;px=qx;pz=qz;y=(a[2]||0)+((b[2]||0)-(a[2]||0))*t;} }
    return {d,x:px,z:pz,y};
  };
  const edge = [...coast,coast[0]];
  const inside = (x,z) => {let hit=false;for(let i=0,j=coast.length-1;i<coast.length;j=i++){const a=coast[i],b=coast[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;};
  // Hillside lots: Chora climbs the slope above the harbor and up the east flank. Additive: every approved lot,
  // lane and height stays where it is. Each row is [name, x, z, w, d, h, lane it fronts].
  const HILL_LANES=[[[-8,23],[-16,23.5],[-24,23.5],[-29.5,22.5]],[[17,-5],[9,-8.5],[1,-11.5],[-6,-15.5],[-12,-17]]];
  const hillside=[
    ["VACANT 22",-34,18,4.5,4.5,4,0],["VACANT 23",-27,19,5,4.5,4,0],["VACANT 24",-20.5,19.5,4.5,4.5,4,0],["VACANT 25",-14,19.5,5,4.5,4,0],
    ["VACANT 26",6.65,-14.4,5,4.5,4,1],["VACANT 27",-.2,-17.6,4.5,4.5,4,1],["VACANT 28",-7.9,-20.8,4.5,4.5,4,1],
    ["VACANT 29",2.5,-6,4.5,4.5,4,1],["VACANT 30",-4.8,-9.4,4.5,4.5,4,1],["VACANT 31",-10.1,-11.7,4.5,4,4,1],["VACANT 32",13,-12,4.5,4.5,4,1],["VACANT 33",5,-22,4.5,4.5,4,1]
  ];
  lanes.push(...HILL_LANES);
  // Every lot's centre and half-size, for the stone courts the terrain paints around them.
  const PLOTS=[...properties,...hillside].map(q=>[q[1],q[2],Math.max(q[3],q[4])/2]).concat([[-61,27,5.5],[-48,25,3.5],[-35,26,4],[-68,38,3]]);
  let cached;
  const build = () => {
    if(!cached) {
      const heights=new Float32Array(N*N), geo={verts:[],faces:[],lines:[]}, shore={};
      for(let j=0;j<N;j++)for(let i=0;i<N;i++) {
        const x=MIN+i*STEP,z=MIN+j*STEP, distance=closest(edge,x,z).d;
        let h=-5;
        if(inside(x,z)) {
          const radius=Math.hypot((x+47)/70,(z+45)/82);
          const mountain=Math.max(0,1-radius), shoulder=mountain*mountain*(3-2*mountain);
          const raw=4+35*shoulder;
          // Broad continuous shoulders with shallow rock strata, not tall slab terraces.
          h=raw+0.22*Math.sin(raw*Math.PI/2)*mountain;
          if(!mountain)h=4+0.45*Math.sin(x*.055)*Math.sin(z*.06);
          const t=closest(trail,x,z), k=Math.max(0,Math.min(1,(12-t.d)/8.8)), blend=k*k*(3-2*k);
          h=h*(1-blend)+t.y*blend;
          const summit=Math.hypot(x+45,z+48), cap=Math.max(0,Math.min(1,(15-summit)/7));
          h=h*(1-cap)+39*cap;
          // Only inhabited shores soften into sand; Olympus ends as a rock cliff.
          // Let the mountain rise inland: the beach ramp must not clip a graded
          // switchback when it crosses the front/rear coastal treatment boundary.
          if(!(x<0&&z<-28)) h=Math.min(h,0.4+distance*.46+Math.max(0,distance-12)**2*.12);
        }
        // Extend only offshore vertices of the existing furnished beach. Dry land is byte-identical.
        if(h===-5&&!inside(x,z)){
          C.nearest(coast,x,z,shore);
          const sand=Math.min(shore.beach,C.beach(x,z));
          if(sand>0&&shore.distance<26)h=Math.max(-5,h+(Math.max(-5,C.shelfHeight(shore.distance))-h)*sand);
        }
        heights[j*N+i]=h;geo.verts.push(x,h,z);
      }
      // Round the grading joins at switchbacks in the same land mesh. This
      // smooths tight turns without adding treads or separate support geometry.
      const scratch=new Float32Array(heights.length);
      for(let pass=0;pass<3;pass++) {
        scratch.set(heights);
        for(let j=1;j<N-1;j++)for(let i=1;i<N-1;i++) {
          const x=MIN+i*STEP,z=MIN+j*STEP;
          if(closest(trail,x,z).d>4.5||z<trail[0][1])continue;
          const at=j*N+i;let sum=0;
          for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)sum+=scratch[at+dz*N+dx];
          heights[at]=sum/9;
        }
      }
      // PROTOTYPE visual pass. Heights, heightAt and every walk query are untouched: each approved triangle is
      // split into four coplanar ones (0.75 m), shaded smooth and painted by height, slope, noise and route.
      const hash=(x,z)=>{const q=Math.sin(x*127.1+z*311.7)*43758.5453;return q-Math.floor(q);};
      const vn=(x,z)=>{const xi=Math.floor(x),zi=Math.floor(z),fx=x-xi,fz=z-zi,u=fx*fx*(3-2*fx),v=fz*fz*(3-2*fz);return (hash(xi,zi)*(1-u)+hash(xi+1,zi)*u)*(1-v)+(hash(xi,zi+1)*(1-u)+hash(xi+1,zi+1)*u)*v;};
      const fbm=(x,z)=>vn(x,z)*.58+vn(x*2.1+7.3,z*2.1+3.1)*.3+vn(x*4.3+1.7,z*4.3+9.2)*.12;
      const mix=(p,q,t)=>{t=Math.max(0,Math.min(1,t));return [p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t,p[2]+(q[2]-p[2])*t];};
      const F=2*N-1,fine=new Float32Array(F*F);
      for(let j=0;j<F;j++)for(let i=0;i<F;i++){
        const i0=i>>1,j0=j>>1,at=j0*N+i0;
        // Odd/odd points sit on the shared diagonal of the approved quad, so the fine mesh is the same surface.
        fine[j*F+i]=i&1&&j&1?(heights[at+1]+heights[at+N])/2:i&1?(heights[at]+heights[at+1])/2:j&1?(heights[at]+heights[at+N])/2:heights[at];
      }
      geo.verts.length=0;geo.smooth=true;
      for(let j=0;j<F;j++)for(let i=0;i<F;i++)geo.verts.push(MIN+i*STEP/2,fine[j*F+i],MIN+j*STEP/2);
      const SAND=[232,208,160],WET=[196,172,126],BED=[160,152,122],STRAW=[188,174,120],MEADOW=[148,152,100],GREEN=[112,132,84],GARRIGUE=[160,150,110];
      const ROCK=[[176,158,134],[154,138,118],[192,176,150],[164,144,122]],OCHRE=[184,146,112],EARTH=[204,178,134],FLAG=[212,196,166],PROM=[220,204,172],MARBLE=[214,204,182];
      const paint=(p,q,r,o)=>{
        const x=(geo.verts[p*3]+geo.verts[o*3])/2,z=(geo.verts[p*3+2]+geo.verts[o*3+2])/2,h=(geo.verts[p*3+1]+geo.verts[o*3+1])/2;
        const ux=geo.verts[q*3]-geo.verts[p*3],uy=geo.verts[q*3+1]-geo.verts[p*3+1],uz=geo.verts[q*3+2]-geo.verts[p*3+2],vx=geo.verts[r*3]-geo.verts[p*3],vy=geo.verts[r*3+1]-geo.verts[p*3+1],vz=geo.verts[r*3+2]-geo.verts[p*3+2];
        const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,steep=1-Math.abs(ny)/(Math.hypot(nx,ny,nz)||1);
        const n1=fbm(x/11,z/11),n2=fbm(x/3.1+40,z/3.1+17),speck=hash(Math.floor(x/.75),Math.floor(z/.75))-.5,rear=x<0&&z<-28;
        let c,soil=false;
        if(h<-.3)c=mix(WET,BED,(-.3-h)/2.5);
        else if(steep>.115+n2*.07&&h>1.2||h>23+n1*5){
          // Limestone in tilted strata, with ochre seams: reads as rock at a glance and breaks the big facets.
          const band=Math.floor(h/1.5+n1*2.4);c=ROCK[((band%4)+4)%4];
          if(n2>.64)c=mix(c,OCHRE,.5);
          c=mix(c,[150,138,116],Math.max(0,steep-.45)*1.4);
        }else{
          const beach=!rear&&h<1.5+n2*2.2+Math.max(0,3-closest(edge,x,z).d*.35);
          if(beach)c=mix(WET,SAND,(h+.1)/.9);
          else{
            soil=true;
            c=mix(MEADOW,STRAW,n1*1.5-.25);
            if(n2>.6)c=mix(c,GREEN,(n2-.6)*3);
            c=mix(c,GARRIGUE,(h-7)/9);
            c=mix(c,ROCK[0],(h-17)/8);
            // Scrub greens the ledges of Olympus below the summit.
            if(h>9&&h<31&&n2>.48)c=mix(c,[124,138,92],(n2-.48)*1.7);
          }
        }
        const summit=Math.hypot(x+45,z+48);
        if(summit<11+n2*2)c=mix(c,MARBLE,.85);
        if(h>.7&&steep<.34){
          // Stone-paved courts round every lot, in place of lawn.
          let near=Infinity;for(const q of PLOTS)near=Math.min(near,Math.hypot(x-q[0],z-q[1])-q[2]);
          // A greener belt where the town's water runs off, then the courts themselves.
          if(near<15&&soil)c=mix(c,GREEN,(1-near/15)*.55+.05);
          if(near<4.6+(n2-.5)*3.2){const tile=hash(Math.floor(x/1.5)*7.1+3,Math.floor(z/1.5)*3.3+1);c=mix(c,tile>.55?[208,197,178]:tile>.2?[194,183,164]:[181,170,152],near<3.2?.92:.55);}
        }
        if(h>0){
          const t=closest(trail,x,z).d+(n2-.5)*1.3;
          if(t<2.5)c=mix(c,EARTH,t<1.9?.92:.5);
          let lane=Infinity;for(const l of lanes)lane=Math.min(lane,closest(l,x,z).d);
          if(lane+(n2-.5)*.7<1.75)c=mix(c,FLAG,lane<1.25?.95:.55);
          const front=closest(waterfront,x,z).d+(n2-.5)*.9;
          if(front<3.3)c=mix(c,PROM,front<2.7?.95:.55);
        }
        const k=1+speck*.055;
        geo.faces.push({i:[p,q,r],color:[Math.round(Math.min(255,c[0]*k)),Math.round(Math.min(255,c[1]*k)),Math.round(Math.min(255,c[2]*k))]});
      };
      for(let j=0;j<N-1;j++)for(let i=0;i<N-1;i++){
        const o=(2*j)*F+2*i,A=o,AB=o+1,B=o+2,AC=o+F,CE=o+F+1,BD=o+F+2,C=o+2*F,CD=o+2*F+1,D=o+2*F+2;
        // The fourth index is the square's opposite corner: both halves sample the same centre.
        paint(A,AC,AB,CE);paint(AB,AC,CE,AC);paint(AB,CE,B,BD);paint(B,CE,BD,CE);paint(AC,C,CE,CD);paint(CE,C,CD,C);paint(CE,CD,BD,D);paint(BD,CD,D,CD);
      }
      // The query interpolates the exact rendered triangles, including trail grading.
      const heightAt=(x,z)=>{
        const u=(x-MIN)/STEP,v=(z-MIN)/STEP,i=Math.floor(u),j=Math.floor(v);
        if(i<0||j<0||i>=N-1||j>=N-1)return -5;
        const a=j*N+i,fx=u-i,fz=v-j;
        return fx+fz<=1?heights[a]+fx*(heights[a+1]-heights[a])+fz*(heights[a+N]-heights[a]):heights[a+N+1]+(1-fx)*(heights[a+N]-heights[a+N+1])+(1-fz)*(heights[a+1]-heights[a+N+1]);
      };
      cached={geo,heightAt};
    }
    const {geo,heightAt}=cached, root=S.createNode(), buildings=[];
    S.addChild(root,S.createNode({geometry:geo}));
    const put=(color,x,y,z,w,h,d,ry=0)=>{const n=S.createNode({geometry:M.box({color}),position:{x,y,z},scale:{x:w,y:h,z:d},rotation:{x:0,y:ry,z:0}});S.addChild(root,n);return n;};
    const sea=put("#347f99",0,-.45,0,650,.3,650);
    // PROTOTYPE shells: same footprint, height, door and registry as the approved block masses; only the look
    // changes. Chamfered plaster, a dressed-stone base on the voxel grid, and a roof form per lot.
    const WHITE="#fdfbf4",DOME="#2c6cb4",rgb=BL.math.hexToRgb,shells=new Map();
    const STYLE={32:"vault",34:"dome",35:"upper",36:"vault",37:"upper",38:"dome",40:"vault",41:"upper",43:"dome",8:"dome",12:"dome",19:"dome",23:"dome",3:"vault",7:"vault",11:"vault",14:"vault",16:"vault",22:"vault",24:"vault",26:"vault",27:"vault",2:"upper",6:"upper",18:"upper",29:"upper",31:"upper"};
    const shell=(w,h,d,style)=>{
      const key=`${w}|${h}|${d}|${style}`;if(shells.has(key))return shells.get(key);
      const flat=[M.bevelBox({w,h,d,color:WHITE,bevel:.16,offset:{x:0,y:h/2,z:0}})],round=[];
      if(style==="dome"){
        const r=Math.min(w,d)*.3,x=w*.1,z=-d*.06,drum=.55,profile=[];
        for(let k=0;k<=7;k++){const a=k/7*Math.PI/2;profile.push([Math.cos(a)*r,drum+Math.sin(a)*r*.94]);}
        round.push(M.moved(M.lathe({profile:[[r+.14,0],[r+.14,drum],[r,drum]],segments:20,color:WHITE}),x,h,z));
        round.push(M.moved(M.lathe({profile,segments:20,color:DOME}),x,h,z));
        flat.push(M.box({w:.12,h:.62,d:.12,color:WHITE,offset:{x,y:h+drum+r*.94+.3,z}}),M.box({w:.4,h:.1,d:.1,color:WHITE,offset:{x,y:h+drum+r*.94+.42,z}}));
      }else if(style==="vault"){
        const rw=w/2-.36,rv=Math.min(1.45,rw*.55),z0=-d/2+.36,z1=d/2-.36,n=10,arc={verts:[],faces:[],lines:[]},caps={verts:[],faces:[],lines:[]},c=rgb(WHITE);
        for(let k=0;k<=n;k++){const a=k/n*Math.PI,x=Math.cos(a)*rw,y=h+Math.sin(a)*rv;arc.verts.push(x,y,z0,x,y,z1);caps.verts.push(x,y,z0,x,y,z1);}
        for(let k=0;k<n;k++){const q=k*2;arc.faces.push({i:[q,q+2,q+3,q+1],color:c,emissive:0});}
        caps.faces.push({i:Array.from({length:n+1},(_,k)=>k*2+1),color:c,emissive:0},{i:Array.from({length:n+1},(_,k)=>(n-k)*2),color:c,emissive:0});
        round.push(arc);flat.push(caps);
      }else if(style==="upper"){
        const uw=Math.max(2.5,w*.52),ud=Math.max(2.5,d*.56),uh=2.5,ux=w/2-uw/2,uz=-d/2+ud/2;
        flat.push(M.bevelBox({w:uw,h:uh,d:ud,color:WHITE,bevel:.14,offset:{x:ux,y:h+uh/2,z:uz}}));
        flat.push(M.box({w:.7,h:.95,d:.08,color:"#27445a",offset:{x:ux,y:h+1.35,z:uz+ud/2+.02}}),M.box({w:.95,h:.12,d:.16,color:DOME,offset:{x:ux,y:h+.82,z:uz+ud/2+.05}}));
        for(const side of [-1,1])flat.push(M.box({w:.3,h:.95,d:.06,color:DOME,offset:{x:ux+side*.52,y:h+1.35,z:uz+ud/2+.04}}));
      }
      if(style==="flat"||style==="vault"&&w>=6){
        flat.push(M.box({w:.5,h:.85,d:.5,color:WHITE,offset:{x:w*.34,y:h+.42,z:-d*.32}}));
        round.push(M.moved(M.lathe({profile:[[.13,0],[.18,.26],[.1,.36],[0,.36]],segments:8,color:"#b9714a"}),w*.34,h+.85,-d*.32));
      }
      // Terraces take a warm lime-wash so roofs separate from walls under the high sun.
      for(const part of flat)for(const f of part.faces){const v=part.verts,a=f.i[0]*3,b=f.i[1]*3,c=f.i[2]*3;
        const ny=(v[b+2]-v[a+2])*(v[c]-v[a])-(v[b]-v[a])*(v[c+2]-v[a+2]);
        if(ny>0&&Math.abs(v[a+1]-v[b+1])<1e-4&&Math.abs(v[a+1]-v[c+1])<1e-4&&f.color[0]>240)f.color=[233,224,206];}
      const g=round.length?M.shaded(round,flat):M.merge(...flat);shells.set(key,g);return g;
    };
    const base=(w,h,d)=>{const g=M.box({w,h,d,color:"#cfc0a2",offset:{x:0,y:-h/2,z:0}});g.voxel=new Float32Array([.25,-w/2,-h,-d/2]);return g;};
    const place=(row,roads)=>{
      const [name,x,z,w,d,h]=row;let front=closest(roads[0],x,z);
      for(const road of roads.slice(1)){const q=closest(road,x,z);if(q.d<front.d)front=q;}
      const yaw=Math.atan2(front.x-x,front.z-z),c=Math.cos(yaw),s=Math.sin(yaw);
      let floor=-Infinity;
      for(const dx of [-w/2,w/2])for(const dz of [-d/2,d/2])floor=Math.max(floor,heightAt(x+c*dx+s*dz,z-s*dx+c*dz));
      const low=heightAt(x,z)-2,style=name==="Noderunner waterfront"?"flat":STYLE[buildings.length]||"flat";
      S.addChild(root,S.createNode({geometry:base(w+.5,Math.ceil((floor-low)/.25)*.25,d+.5),position:{x,y:floor,z},rotation:{x:0,y:yaw,z:0}}));
      S.addChild(root,S.createNode({geometry:shell(w,h,d,style),position:{x,y:floor,z},rotation:{x:0,y:yaw,z:0}}));
      put("#2f6aa0",x+s*(d/2+.035),floor+1.1,z+c*(d/2+.035),1.1,2.2,.08,yaw);
      buildings.push({name,x,z,w,d,yaw,floor,front:{x:front.x,z:front.z},h});
    };
    // PROTOTYPE shore apron: a smooth visual beach profile along the authored coast polygon. It only covers the
    // grid-stepped sand wall; heights and walk queries never read it. Olympus' rear stays a cliff.
    {
      const pts=[];
      for(let i=0;i<coast.length;i++){const a=coast[i],b=coast[(i+1)%coast.length],len=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.ceil(len/1.5);for(let k=0;k<n;k++)pts.push([a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n]);}
      // Two rounds of neighbour averaging soften the polygon's corners into a drawn shoreline.
      for(let pass=0;pass<2;pass++){const copy=pts.map(p=>p.slice());for(let i=0;i<pts.length;i++){const a=copy[(i+pts.length-1)%pts.length],b=copy[(i+1)%pts.length];pts[i][0]=(a[0]+2*copy[i][0]+b[0])/4;pts[i][1]=(a[1]+2*copy[i][1]+b[1])/4;}}
      const apron={verts:[],faces:[],lines:[],smooth:true,castShadow:false},PROFILE=[[-2.4,null],[-.2,.5],[1.75,-.268],[2.2,-.286],[5.5,-2.2]],INK=[[232,208,160],[205,182,136],[238,244,238],[150,150,126]];
      const M4=pts.length;
      for(let i=0;i<M4;i++){
        const a=pts[(i+M4-1)%M4],b=pts[(i+1)%M4];let nx=b[1]-a[1],nz=-(b[0]-a[0]);const l=Math.hypot(nx,nz)||1;nx/=l;nz/=l;
        if(inside(pts[i][0]+nx*1.2,pts[i][1]+nz*1.2)&&!inside(pts[i][0]-nx*1.2,pts[i][1]-nz*1.2)){nx=-nx;nz=-nz;}
        for(const [d,y] of PROFILE){const x=pts[i][0]+nx*d,z=pts[i][1]+nz*d;apron.verts.push(x,y===null?Math.max(.5,heightAt(x,z))+.035:y,z);}
      }
      const W=PROFILE.length;
      for(let i=0;i<M4;i++){
        const j=(i+1)%M4,x=pts[i][0],z=pts[i][1];
        if(x<3&&z<-26||C.beach(x,z)>0||heightAt(apron.verts[i*W*3],apron.verts[i*W*3+2])>3.2)continue;
        for(let k=0;k<W-1;k++){
          const q=[i*W+k,j*W+k,j*W+k+1,i*W+k+1],v=apron.verts,a=q[0]*3,b=q[1]*3,c=q[2]*3;
          if((v[b+2]-v[a+2])*(v[c]-v[a])-(v[b]-v[a])*(v[c+2]-v[a+2])<0)q.reverse();
          apron.faces.push({i:q,color:INK[k]});
        }
      }
      S.addChild(root,S.createNode({geometry:apron,sightHidden:true}));
    }
    for(const row of properties)place(row,row[6]?[waterfront]:lanes);
    place(["Noderunner waterfront",-61,27,11,8,5],[waterfront]);
    place(["Harbor store",-48,25,7,6,4],[waterfront]);
    place(["Harbor workshop",-35,26,8,6,4.5],[waterfront]);
    place(["Harbor office",-68,38,6,6,4],[waterfront]);
    for(const row of hillside)place(row,[HILL_LANES[row[6]]]);
    // A waterfront apron ties the district together; no extra town spills into the basin.
    put("#b7a98d",-39,1,41.5,22,.7,3);
    // Piers are deliberately marine structures; their shore end seats in the terrain.
    for(const x of [-43,-34])put("#b7a98d",x,1,49,2.4,.7,19);
    const marks={summit:{x:-45,z:-48},clearing:{x:-13,z:5},chora:{x:32,z:40},harbor:{x:-39,z:51},berth:{x:-38,z:54},choraSign:{x:-10,z:7}};
    for(const p of Object.values(marks))p.y=heightAt(p.x,p.z);
    const clearAt=(x,z,r=.4)=>heightAt(x,z)>.2&&!buildings.some(b=>{const dx=x-b.x,dz=z-b.z,c=Math.cos(b.yaw),s=Math.sin(b.yaw);return Math.abs(c*dx-s*dz)<b.w/2+r&&Math.abs(s*dx+c*dz)<b.d/2+r;});
    const walkable=(ax,az,bx,bz,y,height,actor)=>{
      const n=Math.max(1,Math.ceil(Math.hypot(bx-ax,bz-az)/.3)),r=actor?.bodyRadius||.4;let last=heightAt(ax,az);
      for(let i=1;i<=n;i++){
        const x=ax+(bx-ax)*i/n,z=az+(bz-az)*i/n,h=heightAt(x,z);
        if(h>.2){if(!clearAt(x,z,r))return false;}
        else {
          // A body-wide depth gate follows the steepening shelf, not a wall at the waterline.
          // If an external relocation left a walker too deep, shallower ground is always an escape.
          const escape=h>last+.00001;
          for(let k=0;k<5;k++){
            const px=x+(k===1?r:k===2?-r:0),pz=z+(k===3?r:k===4?-r:0);
            const limit=C.beach(px,pz)>.98?C.maxDepth(actor):px<-23&&pz>29&&pz<62?0:.22;
            if(C.LEVEL-heightAt(px,pz)>limit&&!escape)return false;
          }
        }
        if(Math.abs(h-last)>.55)return false;last=h;
      }return true;
    };
    return {root,sea,heightAt,supportAt:heightAt,groundAt:heightAt,clearAt,walkable,buildings,marks,trail,waterfront,lanes,coast};
  };
  BL.dsbGeography={build};
})();
