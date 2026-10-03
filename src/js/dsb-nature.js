// One deterministic surface-placement pass per visit; fixed instanced fields use the existing renderer.
(() => {
  "use strict";
  const BL=window.BL,S=BL.scene,{mulberry32,fnv1a}=BL.math;
  const SEED=51037;
  const TYPES={
    olive:{cap:110,r:2.5,foot:.3,relief:.2,maxY:22,sway:.0017,keep:[1,.85,.7]},
    cypress:{cap:28,r:1,foot:.22,relief:.18,maxY:19,sway:.001,keep:[1,.9,.8]},
    shrub:{cap:410,r:.85,foot:.45,relief:.24,maxY:32,sway:.055,keep:[1,.65,.38]},
    cover:{cap:280,r:.65,foot:.4,relief:.16,maxY:25,sway:.035,keep:[1,.5,.2]},
    grass:{cap:1600,r:.5,foot:.38,relief:.15,maxY:34,sway:.12,keep:[1,.45,.12]},
    flowers:{cap:200,r:.5,foot:.38,relief:.13,maxY:12,sway:.09,keep:[1,.6,.25]},
    rock:{cap:150,r:1.3,foot:1.1,relief:.42,maxY:36,sway:0,keep:[1,.75,.55]},
    bougainvillea:{cap:28,r:.55,foot:.14,relief:.16,maxY:20,sway:.0025,keep:[1,.85,.7]},
    planter:{cap:28,r:.5,foot:.46,relief:.1,maxY:20,sway:0,keep:[1,.85,.7]}
  };
  const distance=(line,x,z)=>{
    let best=Infinity;
    for(let i=1;i<line.length;i++) {
      const a=line[i-1],b=line[i],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz)));
      best=Math.min(best,Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t));
    }
    return best;
  };
  const create=({root,land,renderer,camera,weather})=>{
    const group=S.createNode({sightHidden:true}), placements=[], fields=[], occupied=[];
    S.addChild(root,group);
    const coast=[...land.coast,land.coast[0]], contacts={};
    for(const kind of Object.keys(TYPES)) {
      const v=BL.dressing.mediterranean(kind).verts,points=[];
      for(let i=0;i<v.length;i+=3)if(Math.abs(v[i+1])<.001)points.push([v[i],v[i+2]]);
      contacts[kind]=points;
    }
    // Canopy/rock bounds, not only trunk centres, stay clear of every walking corridor.
    const allowed=(kind,x,z,scale=1)=>{
      const spec=TYPES[kind],r=spec.r*scale,y=land.heightAt(x,z);
      if(y<.85||y>spec.maxY||!land.clearAt(x,z,kind==="bougainvillea"?.18:r+.5))return false;
      if(distance(land.trail,x,z)<2.9+r||distance(land.waterfront,x,z)<3.8+r)return false;
      for(const lane of land.lanes)if(distance(lane,x,z)<2+r)return false;
      if(Math.hypot(x-land.marks.summit.x,z-land.marks.summit.z)<18+r)return false;
      if(Math.hypot(x-land.marks.choraSign.x,z-land.marks.choraSign.z)<4+r)return false;
      if(Math.hypot(x+13,z-5)<5+r||distance([[-13,5],[0,23]],x,z)<2.3+r)return false;
      // Reserved harbor apron, piers and future outdoor Noderunner approach.
      if(x>-75-r&&x<-24+r&&z>30-r&&z<61+r)return false;
      const edge=distance(coast,x,z);
      if(edge<2+r)return false;
      // Olympus' rear stays rock-to-sea: no coastal plant/stone strip there.
      if(x<0&&z<-28&&edge<12)return false;
      const tree=kind==="olive"||kind==="cypress";
      if(tree&&(edge<8||x>0&&z>-25&&x<70&&z<62))return false;
      if(kind==="flowers"&&(x<-35||z<-8))return false;
      if((kind==="bougainvillea"||kind==="planter")&&x<0)return false;
      return true;
    };
    const add=(kind,x,z,scale,yaw,architectural=false)=>{
      if(!allowed(kind,x,z,scale))return false;
      const spec=TYPES[kind],r=spec.r*scale,foot=spec.foot*scale;
      if(!architectural)for(const p of occupied)if(Math.hypot(x-p.x,z-p.z)<r+p.r)return false;
      // Nine support samples seat the entire contact footprint; reject ledges and steep ground.
      const centreY=land.heightAt(x,z), conform=!architectural&&kind!=="olive"&&kind!=="cypress";
      const gx=conform?(land.heightAt(x+foot,z)-land.heightAt(x-foot,z))/(2*foot):0;
      const gz=conform?(land.heightAt(x,z+foot)-land.heightAt(x,z-foot))/(2*foot):0;
      if(Math.hypot(gx,gz)>(kind==="rock"?1.15:.85))return false;
      let low=centreY,high=low,minResidual=0,maxResidual=0;
      for(let i=0;i<8;i++) {
        const a=i*Math.PI/4,y=land.heightAt(x+Math.cos(a)*foot,z+Math.sin(a)*foot);
        low=Math.min(low,y);high=Math.max(high,y);
        const residual=y-centreY-gx*Math.cos(a)*foot-gz*Math.sin(a)*foot;
        minResidual=Math.min(minResidual,residual);maxResidual=Math.max(maxResidual,residual);
      }
      // Include every authored ground-contact vertex, not just a circular approximation.
      const c=Math.cos(yaw),sn=Math.sin(yaw);
      for(const point of contacts[kind]) {
        const dx=(c*point[0]+sn*point[1])*scale,dz=(-sn*point[0]+c*point[1])*scale;
        const y=land.heightAt(x+dx,z+dz),residual=y-centreY-gx*dx-gz*dz;
        low=Math.min(low,y);high=Math.max(high,y);
        minResidual=Math.min(minResidual,residual);maxResidual=Math.max(maxResidual,residual);
      }
      if(maxResidual-minResidual>spec.relief*scale||low<.8)return false;
      const p={kind,x,y:centreY+minResidual-.025*scale,z,scale,yaw,foot,low,high,gx,gz,architectural};
      placements.push(p);
      if(kind==="olive"||kind==="cypress"||kind==="rock")occupied.push({x,z,r:kind==="rock"?r:.8*scale});
      return true;
    };
    // Shared cluster centres give groves and bare gaps; rejection applies the master geography masks.
    const rand=mulberry32(SEED),clusters=[];
    for(let i=0;i<90;i++)clusters.push([-86+rand()*164,-74+rand()*144]);
    // Architectural plants occupy side/rear edges, never the front door or a storefront's face.
    for(const b of land.buildings) {
      if(b.x<0)continue;
      const c=Math.cos(b.yaw),s=Math.sin(b.yaw);
      for(const side of [-1,1]) {
        const lx=side*(b.w/2+.42),lz=-b.d*.22,x=b.x+c*lx+s*lz,z=b.z-s*lx+c*lz;
        if(add("bougainvillea",x,z,.9,b.yaw,true))break;
      }
      const lx=-b.w/2-1.2,lz=-b.d/2-1.2;
      add("planter",b.x+c*lx+s*lz,b.z-s*lx+c*lz,1,b.yaw,true);
    }
    for(const kind of ["olive","cypress","rock","shrub","cover","grass","flowers"]) {
      const spec=TYPES[kind],rng=mulberry32(SEED^fnv1a(kind));let count=0;
      for(let attempt=0;attempt<spec.cap*60&&count<spec.cap;attempt++) {
        const centre=clusters[Math.floor(rng()*clusters.length)],angle=rng()*Math.PI*2,spread=Math.sqrt(rng())*(kind==="olive"?13:9);
        const x=centre[0]+Math.cos(angle)*spread,z=centre[1]+Math.sin(angle)*spread,scale=.75+rng()*.55,yaw=rng()*Math.PI*2;
        // Upper Olympus stays sparse; its visual identity is exposed rock.
        const y=land.heightAt(x,z);
        if(y>18&&rng()<(kind==="rock"?.2:.7))continue;
        if(kind==="rock"&&distance(coast,x,z)>13&&rng()<.65)continue;
        if(add(kind,x,z,scale,yaw))count++;
      }
    }
    for(const [kind,spec] of Object.entries(TYPES)) {
      const list=placements.filter(p=>p.kind===kind),source=new Float32Array(list.length*20);
      for(let i=0;i<list.length;i++) {
        const p=list[i],o=i*20,c=Math.cos(p.yaw)*p.scale,s=Math.sin(p.yaw)*p.scale;
        source[o]=c;source[o+1]=p.gx*c-p.gz*s;source[o+2]=-s;source[o+5]=p.scale;source[o+8]=s;source[o+9]=p.gx*s+p.gz*c;source[o+10]=c;
        source[o+12]=p.x;source[o+13]=p.y;source[o+14]=p.z;source[o+15]=1;
      }
      // A visit-local wrapper owns sway. Shared immutable vertices/faces survive scene re-entry.
      const geometry={...BL.dressing.mediterranean(kind),sway:0};
      const node=S.createNode({geometry,instanceData:new Float32Array(source.length),instanceCount:0,instanceVersion:0,fixedInstanceCapacity:true,sightHidden:true,cullSphere:new Float32Array([0,20,0,140])});
      S.addChild(group,node);fields.push({kind,spec,list,source,node});
    }
    const flock=BL.dressing.flock({count:5,cx:-41,cz:79,radius:[12,23],height:[15,22],seed:SEED,scale:1.15});
    S.addChild(group,flock.node);
    const stats={seed:SEED,tier:"",total:placements.length,visible:0,batches:fields.length+1,gulls:0,sway:0};
    let lastX=Infinity,lastY=Infinity,lastZ=Infinity,disposed=false;
    const update=(dt,time)=>{
      if(disposed)return;
      const tier=renderer.kind==="canvas2d"?"low":renderer.quality,k=tier==="high"?0:tier==="medium"?1:2;
      const wind=weather.state.wind.strength,animated=k<2&&renderer.kind==="webgl2";
      stats.sway=animated?.3+wind*1.7:0;
      for(const f of fields)f.node.geometry.sway=f.spec.sway*stats.sway;
      const p=camera.position;
      if(stats.tier!==tier||Math.hypot(p.x-lastX,p.y-lastY,p.z-lastZ)>4) {
        stats.tier=tier;lastX=p.x;lastY=p.y;lastZ=p.z;stats.visible=0;
        for(const f of fields) {
          const count=Math.ceil(f.list.length*f.spec.keep[k]),detail=f.kind==="grass"||f.kind==="cover"||f.kind==="flowers";
          const range=p.y>75?300:detail?(k===0?110:k===1?80:50):300,data=f.node.instanceData;let n=0;
          for(let i=0;i<count;i++) {
            const o=i*20,source=f.source;
            if(Math.hypot(source[o+12]-p.x,source[o+14]-p.z)>range)continue;
            for(let j=0;j<20;j++)data[n*20+j]=source[o+j];
            n++;
          }
          f.node.instanceCount=n;f.node.instanceVersion++;stats.visible+=n;
        }
      }
      stats.gulls=animated?(k===0?5:3):0;
      flock.node.visible=stats.gulls>0;flock.node.instanceCount=stats.gulls;
      if(stats.gulls)flock.update(time);
    };
    const dispose=()=>{if(disposed)return;disposed=true;S.removeChild(root,group);while(group.children.length)S.removeChild(group,group.children[group.children.length-1]);placements.length=fields.length=occupied.length=0;stats.total=stats.visible=stats.gulls=0;};
    return {group,placements,fields,stats,allowed,update,dispose};
  };
  BL.dsbNature={create,SEED};
})();
