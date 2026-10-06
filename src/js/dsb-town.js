// Chora's dressing between the lots, so the town reads as one village: yard walls on stone footings that step
// with the ground, a whitewashed stair up the back of each house, landings and flights where a door stands above
// the slope, gateways over the lanes, door stoops and planted pots. Additive: it reads the approved geography and
// the layers placed on it, moves nothing, and owns its own swept collision the way the Noderunner terrace does.
(() => {
  "use strict";
  const BL=window.BL,S=BL.scene,M=BL.models;
  const gap=(line,x,z)=>{let best=Infinity;for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz)));best=Math.min(best,Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t));}return best;};
  const CELL=4;
  const create=({root,land,nature,detail,enrichment})=>{
    const group=S.createNode({sightHidden:true});S.addChild(root,group);
    const kinds={white:{geometry:M.box({color:"#f8f4ea"}),list:[]},stone:{geometry:M.box({color:"#c8b898"}),list:[]},cap:{geometry:M.box({color:"#e6dcc6"}),list:[]},step:{geometry:M.box({color:"#efe9db"}),list:[]},
      pot:{geometry:BL.dressing.mediterranean("planter"),list:[]},vine:{geometry:BL.dressing.mediterranean("bougainvillea"),list:[]}};
    // Solids are oriented boxes: x, z, half width, half depth, cos, sin. A grid of cells indexes them.
    const solids=[],grid=new Map(),stats={walls:0,stairs:0,flights:0,gateways:0,pots:0,solids:0};
    const put=(kind,x,y,z,w,h,d,ry,solid)=>{
      kinds[kind].list.push(x,y,z,w,h,d,ry);
      if(!solid)return;
      const at=solids.length/6,reach=Math.hypot(w,d)/2+.6;solids.push(x,z,w/2,d/2,Math.cos(ry),Math.sin(ry));
      for(let i=Math.floor((x-reach)/CELL);i<=Math.floor((x+reach)/CELL);i++)for(let j=Math.floor((z-reach)/CELL);j<=Math.floor((z+reach)/CELL);j++){const key=i*4096+j;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(at);}
    };
    // Everything other layers already stand on the ground: trees and rocks, and furnished pockets.
    const taken=[];
    for(const p of nature.placements)if(p.kind==="olive"||p.kind==="cypress")taken.push(p.x,p.z,.75*p.scale);else if(p.kind==="rock")taken.push(p.x,p.z,.95*p.scale);
    for(const p of detail.placements)if(p.r&&p.kind!=="grass"&&p.kind!=="flowers")taken.push(p.x,p.z,Math.min(p.r,1.3));
    for(const p of enrichment.placements)if(p.r&&p.region!=="foam")taken.push(p.x,p.z,Math.min(p.r,1.3));
    const open=(x,z,r)=>{for(let i=0;i<taken.length;i+=3)if(Math.hypot(x-taken[i],z-taken[i+1])<r+taken[i+2])return false;return true;};
    const routes=(x,z)=>{let q=Math.min(gap(land.trail,x,z)-1.2,gap(land.waterfront,x,z)-1.9,gap(enrichment.beachRoute,x,z),gap(enrichment.ruinRoute,x,z));for(const l of land.lanes)q=Math.min(q,gap(l,x,z));return q;};
    // No wall, pier or pot may stand in the approach to any door.
    const doorway=(x,z,r,own)=>{for(const b of land.buildings){if(b===own)continue;const dx=x-b.x,dz=z-b.z,c=Math.cos(b.yaw),s=Math.sin(b.yaw),lx=c*dx-s*dz,lz=s*dx+c*dz;if(Math.abs(lx)<1.7+r&&lz>b.d/2&&lz<b.d/2+3.4+r)return true;}return false;};
    // Clear of buildings, every walking route, Portara, the clearing and its sightline, and the harbor reserve.
    const free=(x,z,r)=>land.heightAt(x,z)>.9&&land.clearAt(x,z,r)&&!doorway(x,z,r)&&routes(x,z)>1.75+r&&Math.hypot(x+45,z+48)>18&&Math.hypot(x+13,z-5)>6&&gap([[-13,5],[0,23]],x,z)>2.6&&!(x>-76&&x<-23&&z>29&&z<62)&&open(x,z,r);
    const wall=(ax,az,bx,bz)=>{
      const len=Math.hypot(bx-ax,bz-az),n=Math.max(1,Math.round(len/1.1)),ry=Math.atan2(bx-ax,bz-az);
      for(let i=0;i<n;i++){
        const t=(i+.5)/n,x=ax+(bx-ax)*t,z=az+(bz-az)*t;if(!free(x,z,.3))continue;
        const y=land.heightAt(x,z),l=len/n+.04;
        put("stone",x,y-.5,z,.6,1.7,l,ry,true);put("white",x,y+.72,z,.46,.75,l,ry);put("cap",x,y+1.14,z,.6,.1,l,ry);stats.walls++;
      }
    };
    const pot=(x,z,k)=>{if(land.heightAt(x,z)>.9&&land.clearAt(x,z,.2)&&routes(x,z)>1.9&&open(x,z,.35)){put("pot",x,land.heightAt(x,z)-.02,z,k,k,k,x*1.7+z);stats.pots++;}};
    land.buildings.forEach((b,i)=>{
      if(b.name==="Noderunner waterfront")return;
      const c=Math.cos(b.yaw),s=Math.sin(b.yaw),at=(lx,lz)=>[b.x+c*lx+s*lz,b.z-s*lx+c*lz],w=b.w/2,d=b.d/2;
      // A walled yard behind, and a wing wall reaching toward the neighbour.
      const yard=2.8+(i%3)*.5,A=at(-w,-d),B=at(-w,-d-yard),C=at(w,-d-yard),D=at(w,-d);
      wall(A[0],A[1],B[0],B[1]);wall(B[0],B[1],C[0],C[1]);wall(C[0],C[1],D[0],D[1]);
      const side=i%2?1:-1,E=at(side*w,d-.35),F=at(side*(w+2.6+(i%4)*.5),d-.35);wall(E[0],E[1],F[0],F[1]);
      // A whitewashed stair along the back wall to the roof, rising toward the wing's side.
      let clear=true;for(let t=-1;t<=1;t+=.5){const q=at(w*t,-d-.55);if(land.heightAt(q[0],q[1])<.9||!open(q[0],q[1],.45)||routes(q[0],q[1])<2.2||doorway(q[0],q[1],.5))clear=false;}
      if(clear){
        const n=Math.min(Math.floor(b.h/.3),Math.floor((b.w-.4)/.34));
        for(let j=0;j<n;j++){const q=at(-side*(w-.2-j*.34),-d-.5),up=(j+1)*.3;put(j%4===3?"cap":"white",q[0],b.floor+(up-3)/2,q[1],.36,up+3,1,b.yaw,true);}
        stats.stairs++;
      }
      // The door: a stoop on the flat, or a landing and a flight down the facade where the lot stands proud of
      // the slope. Venue doors are left exactly as their interiors expect them.
      const door=at(0,d+.6),drop=b.floor-land.heightAt(door[0],door[1]);
      if(drop<.45||!b.name.startsWith("VACANT")){
        const q=at(0,d+.42),r=at(0,d+.8);put("step",r[0],b.floor-.82,r[1],2.3,2,1.3,b.yaw);put("step",q[0],b.floor-.66,q[1],1.7,2,.6,b.yaw);
      }else{
        const run=side*-1,L=at(0,d+.47);put("step",L[0],b.floor-(drop+1)/2,L[1],2.1,drop+1,.94,b.yaw,true);
        for(let j=1;j<28;j++){
          const q=at(run*(1.05+j*.34-.17),d+.47),top=b.floor-j*.3,ground=land.heightAt(q[0],q[1]);
          if(top<ground+.12||!land.clearAt(q[0],q[1],.2)||routes(q[0],q[1])<1.7||doorway(q[0],q[1],.3,b))break;
          put(j%4===0?"cap":"step",q[0],(top+ground-1)/2,q[1],.36,top-ground+1,.94,b.yaw,true);
        }
        stats.flights++;
      }
      for(const lx of [-1.35,1.35]){const q=at(lx,d+.5);if(drop<.45)pot(q[0],q[1],1.1+(i%3)*.12);}
      const q=at(-side*(w+.6),d*.4);pot(q[0],q[1],1.35);
    });
    // Gateways over the lanes: two piers, a shouldered lintel, a vine up one side. The opening is 3.4 m wide.
    for(const lane of land.lanes)for(let i=1;i<lane.length;i++){
      const a=lane[i-1],b=lane[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);
      for(let t=7;t<len-4;t+=15){
        const x=a[0]+(b[0]-a[0])*t/len,z=a[1]+(b[1]-a[1])*t/len,nx=(b[1]-a[1])/len,nz=-(b[0]-a[0])/len,ry=Math.atan2(nx,nz);
        const p1=[x+nx*2.1,z+nz*2.1],p2=[x-nx*2.1,z-nz*2.1],h1=land.heightAt(p1[0],p1[1]),h2=land.heightAt(p2[0],p2[1]);
        if(h1<.9||h2<.9||Math.abs(h1-h2)>1.4||!land.clearAt(p1[0],p1[1],.5)||!land.clearAt(p2[0],p2[1],.5)||!open(p1[0],p1[1],.5)||!open(p2[0],p2[1],.5)||gap(land.trail,x,z)<5||gap(land.waterfront,x,z)<5||routes(p1[0],p1[1])<1.7||routes(p2[0],p2[1])<1.7||doorway(p1[0],p1[1],.5)||doorway(p2[0],p2[1],.5))continue;
        const y=Math.max(h1,h2);
        for(const [p,h] of [[p1,h1],[p2,h2]])put("white",p[0],(y+3.1+h-.4)/2,p[1],.75,y+3.1-h+.4,.75,ry,true);
        put("white",x,y+3.38,z,.75,.56,4.95,ry);put("cap",x,y+3.71,z,.9,.1,5.2,ry);
        for(const sgn of [-1,1])put("white",x+nx*sgn*1.5,y+2.9,z+nz*sgn*1.5,.75,.42,.6,ry);
        put("vine",p1[0]+nx*.45,h1,p1[1]+nz*.45,1.25,1.25,1.25,ry);stats.gateways++;
      }
    }
    // One fixed instanced batch a shape.
    for(const k of Object.values(kinds)){
      const n=k.list.length/7,data=new Float32Array(n*20);
      for(let i=0;i<n;i++){const o=i*20,p=i*7,c=Math.cos(k.list[p+6]),s=Math.sin(k.list[p+6]);data[o]=c*k.list[p+3];data[o+2]=-s*k.list[p+3];data[o+5]=k.list[p+4];data[o+8]=s*k.list[p+5];data[o+10]=c*k.list[p+5];data[o+12]=k.list[p];data[o+13]=k.list[p+1];data[o+14]=k.list[p+2];data[o+15]=1;}
      // Pots/vines share shape arrays with dressing, but this fixed instance pool owns its record.
      if(n)S.addChild(group,S.createNode({geometry:{...k.geometry},instanceData:data,instanceCount:n,instanceVersion:0,fixedInstanceCapacity:true,sightHidden:true,cullSphere:new Float32Array([0,20,0,150])}));
      k.list.length=0;
    }
    stats.solids=solids.length/6;
    const inside=(x,z,r)=>{
      const cell=grid.get(Math.floor(x/CELL)*4096+Math.floor(z/CELL));if(!cell)return false;
      for(let n=0;n<cell.length;n++){const o=cell[n]*6,dx=x-solids[o],dz=z-solids[o+1],lx=solids[o+4]*dx-solids[o+5]*dz,lz=solids[o+5]*dx+solids[o+4]*dz;if(Math.abs(lx)<solids[o+2]+r&&Math.abs(lz)<solids[o+3]+r)return true;}
      return false;
    };
    // Swept test for walkers. A body that already stands inside a solid may always walk out.
    const clearSegment=(ax,az,bx,bz,y,height,actor)=>{
      const r=(actor&&actor.bodyRadius||.4)*.8;if(inside(ax,az,r))return true;
      const n=Math.max(1,Math.ceil(Math.hypot(bx-ax,bz-az)/.25));
      for(let i=1;i<=n;i++)if(inside(ax+(bx-ax)*i/n,az+(bz-az)*i/n,r))return false;
      return true;
    };
    const dispose=()=>{S.removeChild(root,group);while(group.children.length)S.removeChild(group,group.children[group.children.length-1]);solids.length=taken.length=0;grid.clear();};
    return {group,stats,inside,clearSegment,dispose};
  };
  BL.dsbTown={create};
})();
