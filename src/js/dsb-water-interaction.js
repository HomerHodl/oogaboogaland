// DSB-local, fixed-budget surface disturbances. No listeners, fetches, render targets or live geometry rebuilds.
// Tidewater-inspired uprush/backwash and localized wakes; independently implemented for the Ooga renderer.
(() => {
  "use strict";
  const BL=window.BL,S=BL.scene,M=BL.models,C=BL.dsbCoast,TAU=Math.PI*2;
  const BUDGETS={high:{ripples:24,swash:56,contacts:40,streaks:30,drops:3},medium:{ripples:16,swash:36,contacts:24,streaks:20,drops:1},low:{ripples:10,swash:20,contacts:12,streaks:10,drops:0}};
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),ease=x=>x*x*(3-2*x);
  const ribbon=M.cached(()=>{
    const g=M.geometry();
    for(let i=0;i<7;i++){
      const x=-.5+i/7,w=.7+(i%3)*.13;
      M.face(g,[M.pushVert(g,x,0,-.5*w),M.pushVert(g,x,0,.5*w),M.pushVert(g,x+.105,0,.5*w),M.pushVert(g,x+.105,0,-.5*w)],[198,226,217]);
    }
    g.castShadow=false;g.glassOpacity=.72;return g;
  });
  const ring=M.cached(()=>{
    const g=M.geometry();
    for(let i=0;i<28;i++){
      if(i%7===3)continue;
      const a=i/28*TAU,b=(i+.83)/28*TAU,r=.94+(i%3)*.008;
      M.face(g,[M.pushVert(g,Math.cos(a)*r,0,Math.sin(a)*r),M.pushVert(g,Math.cos(b)*r,0,Math.sin(b)*r),M.pushVert(g,Math.cos(b),0,Math.sin(b)),M.pushVert(g,Math.cos(a),0,Math.sin(a))],[176,214,208]);
    }
    g.castShadow=false;g.glassOpacity=.65;return g;
  });
  const create=({root,land,water,olympus,enrichment,renderer,camera,fx})=>{
    const group=S.createNode({sightHidden:true});S.addChild(root,group);
    const add=geometry=>{const n=S.createNode({geometry,sightHidden:true});n.visible=false;S.addChild(group,n);return n;};
    const impulses=Array.from({length:24},()=>({node:add(ring()),age:-1,life:0,radius:0,strength:0,kind:0,dx:0,dz:0,gx:0,gz:0,limit:3}));
    const swash=[],contacts=[],streaks=[],impactFoam=[],surface={y:C.LEVEL,gx:0,gz:0,width:100};
    const splashGeometry=M.particleGeometry("#92c6ca",.055,0);
    const oldFoam=enrichment.fields.find(f=>f.kind==="foam");if(oldFoam)oldFoam.node.visible=false;
    // Extract each strand from the REAL mean-water contour. The band follows the curved authored beach.
    for(let i=0;i<land.coast.length;i++){
      const a=land.coast[i],b=land.coast[(i+1)%land.coast.length],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz),nx=dz/len,nz=-dx/len;
      for(let d=.6;d<len;d+=1.2){
        const x=a[0]+dx*d/len,z=a[1]+dz*d/len;if(C.beach(x,z)<.98||swash.length>=56)continue;
        let lo=-2,hi=9;
        for(let k=0;k<20;k++){const mid=(lo+hi)/2;if(land.heightAt(x+nx*mid,z+nz*mid)>C.LEVEL)lo=mid;else hi=mid;}
        const at=(lo+hi)/2;
        swash.push({node:add(ribbon()),x:x+nx*at,z:z+nz*at,nx,nz,phase:(x*.024+z*.011)%1});
      }
    }
    // Keep only meaningful existing shoreline/outcrop contacts, then add calmer engineered pier contacts.
    if(oldFoam)for(let i=0;i<oldFoam.list.length&&contacts.length<24;i+=7){
      const p=oldFoam.list[i];if(C.beach(p.x,p.z)>0||p.x>-76&&p.x<-23&&p.z>29&&p.z<62)continue;
      contacts.push({node:add(ribbon()),x:p.x,z:p.z,yaw:p.yaw,length:Math.max(.5,p.sx),harbor:false});
    }
    for(const x of [-44.3,-41.7,-35.3,-32.7])for(const z of [44,49,54,58])contacts.push({node:add(ring()),x,z,yaw:0,length:.32,harbor:true});
    for(const impact of olympus.impacts){impact.foamNode.visible=false;impactFoam.push({node:add(ribbon()),impact});}
    // A few moving highlights also make downward flow legible in the Canvas fallback.
    for(const sheet of olympus.sheets)for(let j=0;j<6;j++)streaks.push({node:add(ribbon()),sheet,phase:j/6,side:(j%3-1)*.62});
    const stats={capacity:24,active:0,player:0,impacts:0,emitted:0,splashes:0,wakes:0,depth:0,immersion:0,speed:1,velocity:0,tier:"high",swash:0,contacts:0,streaks:0};
    let budget=BUDGETS.high,cursor=5,disposed=false,lastX=NaN,lastZ=0,lastFeet=0,lastWaterY=C.LEVEL,wasWet=false,wasAir=false,timer=0,splashTimer=0;
    const sample=(x,z,out)=>{
      out.y=C.LEVEL;out.gx=out.gz=0;out.width=100;
      return olympus.waterAt(x,z,out)||land.heightAt(x,z)<C.LEVEL;
    };
    const emit=(x,y,z,radius,strength,life,dx=0,dz=0,kind=0,slot=-1,gx=0,gz=0,limit=3)=>{
      if(disposed)return;
      const index=slot>=0?slot:cursor++;if(cursor>=budget.ripples)cursor=5;
      const p=impulses[index];p.age=0;p.life=life;p.radius=radius;p.strength=strength;p.kind=kind;p.dx=dx;p.dz=dz;p.gx=gx;p.gz=gz;p.limit=limit;
      p.node.position.x=x;p.node.position.y=y+.022;p.node.position.z=z;p.node.visible=true;stats.emitted++;if(kind===1)stats.wakes++;
    };
    const resetPlayer=()=>{lastX=NaN;wasWet=wasAir=false;timer=splashTimer=0;stats.depth=stats.immersion=stats.velocity=0;stats.speed=1;};
    const clear=()=>{for(const p of impulses){p.age=-1;p.node.visible=false;}cursor=5;stats.active=stats.player=stats.impacts=0;resetPlayer();};
    const speedAt=actor=>{
      const p=actor.root.position;
      if(!sample(p.x,p.z,surface))return 1;
      return C.speed(clamp((surface.y-p.y+actor.baseY)/actor.bodyHeight,0,1));
    };
    const splash=(x,y,z,strength)=>{
      if(splashTimer>0)return;splashTimer=.45;stats.splashes++;
      for(let i=0;i<budget.drops;i++){const a=stats.splashes*2.4+i*TAU/3;fx.spawnParticle(splashGeometry,x,y+.03,z,Math.cos(a)*strength,.8+strength*.5,Math.sin(a)*strength,.32,.65,4,y);}
    };
    const update=(dt,time,actor,enabled=true)=>{
      if(disposed)return;
      const tier=renderer.kind==="canvas2d"?"low":renderer.quality;budget=BUDGETS[tier]||BUDGETS.low;stats.tier=tier;
      group.visible=enabled;if(!enabled){clear();return;}
      const energy=water.environment[0],rough=water.environment[1];
      splashTimer=Math.max(0,splashTimer-dt);timer+=dt;
      if(actor){
        const p=actor.root.position,feet=p.y-actor.baseY,wet=sample(p.x,p.z,surface)&&surface.y-feet>.025,depth=wet?surface.y-feet:0;
        const moved=Number.isFinite(lastX)?Math.hypot(p.x-lastX,p.z-lastZ):0,teleport=moved>3,velocity=dt>0&&!teleport?moved/dt:0;
        const air=actor.hop>.04;
        stats.depth=depth;stats.immersion=clamp(depth/actor.bodyHeight,0,1);stats.speed=C.speed(stats.immersion);stats.velocity=velocity;
        if(teleport){wasWet=false;timer=0;}
        const dx=moved>1e-6?(p.x-lastX)/moved:0,dz=moved>1e-6?(p.z-lastZ)/moved:0;
        if(wet){
          lastWaterY=surface.y;
          const entry=!wasWet,landing=wasAir&&!air,fast=velocity>2.6&&depth<actor.bodyHeight*.5;
          if((entry&&depth>.09)||landing||fast)splash(p.x,surface.y,p.z,landing?.8:entry?.42:.28);
          const period=velocity>.1?clamp(.65/(velocity+.4),.18,.7):3.5;
          if(entry||landing||timer>period){
            const strength=(velocity>.1?.22+Math.min(velocity,4)*.07:.075)*(1-rough*.45),wake=velocity>.45&&depth>actor.bodyHeight*.22;
            emit(p.x-dx*(wake?.3:0),surface.y,p.z-dz*(wake?.3:0),Math.max(.18,actor.bodyRadius*.6),strength,velocity>.1?2:1.25,dx,dz,wake?1:0,-1,surface.gx,surface.gz,surface.width<10?.65:2.8);
            timer=0;
          }
        }else if(wasWet&&!teleport){emit(lastX,lastWaterY,lastZ,actor.bodyRadius*.6,.18,1.1);timer=0;}
        wasWet=wet;wasAir=air;lastX=p.x;lastZ=p.z;lastFeet=feet;
      }else resetPlayer();
      // Each fall owns a reserved slot; walking can never erase the five ongoing impact disturbances.
      for(let i=0;i<olympus.impacts.length;i++){
        const f=olympus.impacts[i],p=impulses[i];
        if(p.age<0&&Math.hypot(camera.position.x-f.x,camera.position.z-f.z)<100){
          sample(f.x,f.z,surface);emit(f.x,surface.y,f.z,.18,.4,1.4+i*.12,f.dx,f.dz,2,i,surface.gx,surface.gz,.75);
          if(tier==="high"&&i===0&&splashTimer===0)splash(f.x,surface.y,f.z,.25);
        }
      }
      for(let i=0;i<impactFoam.length;i++){
        const p=impactFoam[i],n=p.node,f=p.impact;sample(f.x,f.z,surface);
        n.position.x=f.x;n.position.y=surface.y+.028;n.position.z=f.z;
        n.rotation.x=-Math.atan(surface.gz);n.rotation.z=Math.atan(surface.gx);n.scale.x=1.3;n.scale.z=.65;
        n.smokeOpacity=.48+.09*Math.sin(time*2.5+i);n.visible=true;
      }
      stats.active=stats.player=stats.impacts=0;
      for(let i=0;i<impulses.length;i++){
        const p=impulses[i],n=p.node;
        if(i>=budget.ripples||p.age<0){p.age=-1;n.visible=false;continue;}
        p.age+=dt;const k=p.age/p.life;
        if(k>=1){p.age=-1;n.visible=false;continue;}
        const radius=Math.min(p.limit,p.radius+p.age*(p.kind===2?.5:.85)),stretch=p.kind===1?1.45:1;
        n.scale.x=radius;n.scale.z=radius*stretch;n.scale.y=1;
        n.rotation.x=-Math.atan(p.gz);n.rotation.z=Math.atan(p.gx);n.rotation.y=p.kind===1?Math.atan2(p.dx,p.dz):0;
        n.smokeOpacity=p.strength*(1-k)*(1-k)*Math.min(1,k*14);n.visible=true;
        stats.active++;if(i<5)stats.impacts++;else stats.player++;
      }
      stats.swash=0;
      for(let i=0;i<swash.length;i++){
        const s=swash[i],n=s.node;n.visible=i%Math.ceil(swash.length/budget.swash)===0;if(!n.visible)continue;
        const phase=(time/(6.8-energy*.5)+s.phase)%1,advance=phase<.42,amount=advance?ease(phase/.42):1-ease((phase-.42)/.58);
        const travel=2.2-amount*(3.1+rough*.4),x=s.x+s.nx*travel,z=s.z+s.nz*travel;
        n.position.x=x;n.position.z=z;n.position.y=Math.max(C.LEVEL+.014,land.heightAt(x,z)+.023);
        n.rotation.y=Math.atan2(s.nx,s.nz);n.scale.x=1.35;n.scale.z=(.09+.16*amount)*(advance?1:.65)*Math.min(1.5,energy);
        n.smokeOpacity=(advance?.75:.4)*(Math.sin(phase*Math.PI)**.7);stats.swash++;
      }
      stats.contacts=0;
      for(let i=0;i<contacts.length;i++){
        const p=contacts[i],n=p.node;n.visible=i%Math.ceil(contacts.length/budget.contacts)===0;if(!n.visible)continue;
        const pulse=.5+.5*Math.sin(time*(p.harbor?.9:1.6)+i*2.4),k=p.harbor?.6:Math.min(1.5,energy);
        n.position.x=p.x;n.position.y=C.LEVEL+.025;n.position.z=p.z;n.rotation.y=p.yaw;
        n.scale.x=p.length*(p.harbor?.8+pulse*.3:1);n.scale.z=p.harbor?n.scale.x:.04+pulse*.18*k;
        n.smokeOpacity=(.12+pulse*.48)*k;stats.contacts++;
      }
      stats.streaks=0;
      for(let i=0;i<streaks.length;i++){
        const p=streaks[i],n=p.node;n.visible=i%Math.ceil(streaks.length/budget.streaks)===0;if(!n.visible)continue;
        const f=p.sheet,k=(time*.75+p.phase)%1,drop=Math.max(.08,f.top-f.bottom),span=Math.min(.6,drop*.23);
        n.position.x=f.x+f.dx*k+f.nx*p.side;n.position.y=f.top-k*(drop-span)-span/2;n.position.z=f.z+f.dz*k+f.nz*p.side;
        n.rotation.x=Math.PI/2;n.rotation.y=Math.atan2(f.nx,-f.nz);n.scale.x=.09;n.scale.z=span;
        n.smokeOpacity=.22+.16*Math.sin(k*Math.PI);stats.streaks++;
      }
    };
    const steering=(crew,enabled)=>{
      const adapter=Object.create(crew);
      adapter.steer=(x,z,view=0,forward=0,strafe=0,speed=1,peek=0)=>crew.steer(x,z,view,forward,strafe,speed*(enabled()&&crew.player?speedAt(crew.player):1),peek);
      return adapter;
    };
    const dispose=()=>{if(disposed)return;clear();disposed=true;S.removeChild(root,group);while(group.children.length)S.removeChild(group,group.children[group.children.length-1]);if(oldFoam)oldFoam.node.visible=true;for(const f of olympus.impacts)f.foamNode.visible=true;};
    return {group,stats,impulses,swash,contacts,streaks,impactFoam,sample,speedAt,steering,emit,update,clear,dispose,get budget(){return budget;},get lastFeet(){return lastFeet;}};
  };
  BL.dsbWaterInteraction={create,BUDGETS};
})();
