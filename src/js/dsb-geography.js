// Milestone 1: one sampled land surface owns rendering, paths and character support.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {}, S = BL.scene, M = BL.models;
  const STEP = 1.5, MIN = -99, N = 133;
  const coast = [[-86,-72],[-54,-88],[-15,-76],[14,-57],[52,-48],[76,-23],[86,14],[74,46],[57,70],[20,76],[-2,68],[-20,60],[-30,43],[-47,43],[-56,61],[-74,48],[-83,18],[-92,-25]];
  const trail = [[-45,-48,39],[-15,-37,33],[-51,-22,26],[-12,-8,19],[-44,7,12],[-8,23,4]];
  const waterfront = [[-68,48],[-57,37],[-38,34],[-19,42],[0,56],[20,65],[44,62],[62,49],[72,31]];
  const lanes = [[[8,48],[22,41],[43,40],[62,32]],[[19,61],[22,41],[18,23]],[[43,60],[43,40],[50,22]],[[0,56],[0,38],[-8,23]]];
  const properties = [
    ["Meme Factory House",12,53,7,7,5.8,true], ["DSB Studio Stage",30,54,10,6,4.4,true],
    ["Maxis Club Theater",53,48,9,8,6,true], ["Without Rulers Shop",10,34,6,6,4.6,false],
    ["Big Bitcoin",31,33,7,7,6.5,false], ["Stackchain Magazine",53,27,7,6,5,false],
    ["Proof Of Ink",62,39,5,5,4.5,false], ["VACANT 1",31,45,5,5,4,false],
    ["VACANT 2",10,23,6,5,4.6,false], ["VACANT 3",36,23,6,5,4.8,false],
    ["VACANT 4",51,37,5,5,4.4,false], ["VACANT 5",4,44,4,5,4,false]
  ];
  const closest = (line,x,z) => {
    let d=Infinity, px=0,pz=0,y=0;
    for(let i=1;i<line.length;i++) { const a=line[i-1],b=line[i],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz))),qx=a[0]+dx*t,qz=a[1]+dz*t,dist=Math.hypot(x-qx,z-qz); if(dist<d){d=dist;px=qx;pz=qz;y=(a[2]||0)+((b[2]||0)-(a[2]||0))*t;} }
    return {d,x:px,z:pz,y};
  };
  const edge = [...coast,coast[0]];
  const inside = (x,z) => {let hit=false;for(let i=0,j=coast.length-1;i<coast.length;j=i++){const a=coast[i],b=coast[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;};
  let cached;
  const build = () => {
    if(!cached) {
      const heights=new Float32Array(N*N), geo={verts:[],faces:[],lines:[]};
      for(let j=0;j<N;j++)for(let i=0;i<N;i++) {
        const x=MIN+i*STEP,z=MIN+j*STEP, distance=closest(edge,x,z).d;
        let h=-5;
        if(inside(x,z)) {
          const mountain=Math.max(0,1-Math.hypot((x+47)/53,(z+45)/63));
          const raw=4+36*mountain, terrace=Math.floor(raw/3)*3;
          h=mountain>0?raw*.68+terrace*.32:4+0.45*Math.sin(x*.055)*Math.sin(z*.06);
          const t=closest(trail,x,z), blend=Math.max(0,Math.min(1,(6-t.d)/2.8));
          h=h*(1-blend)+t.y*blend;
          if(Math.hypot(x+45,z+48)<8)h=39;
          // Only inhabited shores soften into sand; Olympus ends as a rock cliff.
          if(!(x<0&&z<-28)) h=Math.min(h,0.4+distance*.46);
        }
        heights[j*N+i]=h;geo.verts.push(x,h,z);
      }
      for(let j=0;j<N-1;j++)for(let i=0;i<N-1;i++) {
        const a=j*N+i,b=a+1,c=a+N,d=c+1,x=MIN+(i+.5)*STEP,z=MIN+(j+.5)*STEP;
        const h=(heights[a]+heights[b]+heights[c]+heights[d])/4;
        const path=closest(trail,x,z).d<2.3||closest(waterfront,x,z).d<2.2||lanes.some(l=>closest(l,x,z).d<1.4);
        const color=path&&h>0?[189,164,121]:h>10?[139,137,120]:h>2?[160,160,108]:[215,196,143];
        geo.faces.push({i:[a,c,b],color},{i:[b,c,d],color});
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
    put("#347f99",0,-.45,0,650,.3,650);
    const place=(row,roads)=>{
      const [name,x,z,w,d,h]=row;let front=closest(roads[0],x,z);
      for(const road of roads.slice(1)){const q=closest(road,x,z);if(q.d<front.d)front=q;}
      const yaw=Math.atan2(front.x-x,front.z-z),c=Math.cos(yaw),s=Math.sin(yaw);
      let floor=-Infinity;
      for(const dx of [-w/2,w/2])for(const dz of [-d/2,d/2])floor=Math.max(floor,heightAt(x+c*dx+s*dz,z-s*dx+c*dz));
      const base=heightAt(x,z)-2;
      put("#b4ac92",x,(base+floor)/2,z,w,floor-base,d,yaw);
      put("#f1ead6",x,floor+h/2,z,w,h,d,yaw);
      put("#39718b",x+s*(d/2+.035),floor+1.1,z+c*(d/2+.035),1.1,2.2,.08,yaw);
      buildings.push({name,x,z,w,d,yaw,floor,front:{x:front.x,z:front.z}});
    };
    for(const row of properties)place(row,row[6]?[waterfront]:lanes);
    place(["Noderunner waterfront",-61,30,9,7,5],[waterfront]);
    // Piers are deliberately marine structures; their shore end seats in the terrain.
    for(const x of [-43,-34])put("#b7a98d",x,1,49,2.4,.7,19);
    const marks={summit:{x:-45,z:-48},clearing:{x:-8,z:23},chora:{x:32,z:40},harbor:{x:-39,z:51},berth:{x:-38,z:54},choraSign:{x:-5,z:25}};
    for(const p of Object.values(marks))p.y=heightAt(p.x,p.z);
    const clearAt=(x,z,r=.4)=>heightAt(x,z)>.2&&!buildings.some(b=>{const dx=x-b.x,dz=z-b.z,c=Math.cos(b.yaw),s=Math.sin(b.yaw);return Math.abs(c*dx-s*dz)<b.w/2+r&&Math.abs(s*dx+c*dz)<b.d/2+r;});
    const walkable=(ax,az,bx,bz,y,height,actor)=>{
      const n=Math.max(1,Math.ceil(Math.hypot(bx-ax,bz-az)/.3)),r=actor?.bodyRadius||.4;let last=heightAt(ax,az);
      for(let i=1;i<=n;i++){const x=ax+(bx-ax)*i/n,z=az+(bz-az)*i/n,h=heightAt(x,z);if(!clearAt(x,z,r)||Math.abs(h-last)>.55)return false;last=h;}return true;
    };
    return {root,heightAt,supportAt:heightAt,groundAt:heightAt,clearAt,walkable,buildings,marks,trail,waterfront,lanes,coast};
  };
  BL.dsbGeography={build};
})();
