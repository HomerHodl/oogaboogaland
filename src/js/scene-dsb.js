// DSB master-layout checkpoint. Geography first; attractions return after layout approval.
(() => {
  "use strict";
  const BL=window.BL, S=BL.scene;
  const OVERVIEW={yaw:-0.08,pitch:1.22,dist:207,target:{x:-2,y:10,z:-1}};
  const renderOpts={clear:[.48,.69,.78],sky:[.55,.75,.85],ground:[.38,.36,.25],direct:[1,.94,.8],directStrength:.8,ambientFloor:.48,sun:{x:-.4,y:.85,z:.25},shadowCenter:{x:0,y:10,z:0},shadowExtent:110,fog:[.55,.75,.85],fogNear:250,fogFar:600,lights:new Float32Array(BL.glRenderer.POINT_LIGHT_CAPACITY*8),lightCount:0,bloomStrength:.15};
  const scene={id:"dsb",renderOpts};
  let root,camera,land,pilot,crew,avatar,hud,input,fx,gate,world,go,overlayCanvas,panel,context,oldSheet,leaving=false,overview=false;
  const drawExtra=()=>{};
  const before={x:0,y:0,z:0},after={x:0,y:0,z:0};
  const nearGate=()=>avatar&&Math.hypot(avatar.root.position.x+45,avatar.root.position.z+44)<10;
  const walk=()=>{overview=false;pilot.possess(avatar);pilot.navigate({position:{x:avatar.root.position.x,y:avatar.root.position.y-avatar.baseY,z:avatar.root.position.z},yaw:Math.PI,pitch:.22,dist:7});pilot.setActive(true);};
  const overviewView=()=>{overview=true;pilot.goPreset("overview");};
  const act=()=>{if(nearGate()&&!overview){gate.open();return true;}return false;};
  const action=name=>{if(name==="dsb-lookout")overviewView();else if(name==="reset-view")walk();else if(name==="dsb-context")act();else if(name==="leave")hud.toast("Return through the Portara at the summit.");};
  const enter=ctx=>{
    ({world,go}=ctx);leaving=false;overview=false;
    root=S.createNode();land=BL.dsbGeography.build();S.addChild(root,land.root);
    camera=S.createCamera({fov:55,near:.1,far:750});overlayCanvas=ctx.overlay;
    const asked=new URLSearchParams(location.search).get("character");
    const name=BL.contributors.roster.find(c=>c.name===(world.pilot||asked))?.name||"YellowBrokeIt";world.pilot=null;
    hud=BL.hud.create({roster:BL.contributors.roster,catalog:BL.models.SWAG,tierColors:BL.models.TIER_COLORS,renderIcon:BL.hud.renderIcon,lootEnabled:false});
    hud.setAreaLabel("DSB LAND · MASTER LAYOUT");oldSheet=hud.el.sheet.hidden;hud.el.sheet.hidden=true;
    const hooks={};input=BL.interact.create({canvas:ctx.canvas,renderer:ctx.renderer,camera,hooks});
    pilot=BL.pilot.create({renderer:ctx.renderer,canvas:ctx.canvas,camera,hud,presets:{overview:OVERVIEW},landing:"overview",pitch:[.1,1.45],dist:[3,270],follow:{y:1,min:3,max:9,pitch:[.1,.8]},fly:{speed:8,perDist:.1,climb:5,yMax:180},clampCamera:p=>{p.y=Math.max(p.y,land.heightAt(p.x,p.z)+1);},coarse:matchMedia("(pointer: coarse)").matches,onFreeAction:act,onPlayerAction:act,close:{eyeHeight:1.7,eyeRatio:.8,eyeForward:0,maxStep:.6,pitch:[-1.2,1.2],orbitDist:12,trailingDist:6,groundAt:land.heightAt}});
    fx=BL.fx.create({root,renderer:ctx.renderer,camera,overlay:ctx.overlay,hud,tickerAt:{x:-45,y:42,z:-44}});
    const shared={root,input,hud,game:ctx.game,world:{level:0,weapons:new Map(),magazine:{owned:false,count:0,ammo:0,carrier:null}},playerName:name,fx,viewYaw:Math.PI,groundAt:land.groundAt,walkable:land.walkable};
    crew=shared.crew=BL.crew.create(shared);pilot.bind(shared);avatar=crew.cavemen.get(name);
    Object.assign(avatar.root.position,{x:-45,y:land.heightAt(-45,-43)+avatar.baseY,z:-43});avatar.root.rotation.y=0;
    Object.assign(hooks,pilot.hooks);hud.onAction(action);hud.onPreset(()=>overviewView());
    // Keep the upstream elapsed-time/input/one-shot transport controller, but replace its ring visually.
    gate=BL.oogaPortal.create({radius:2.5,outerRadius:2.8,position:{x:-45,y:land.heightAt(-45,-48)+2.4,z:-48},rotation:{x:Math.PI/2,y:0,z:0},destinations:[{id:"bifrost",label:"OogaBoogaLand Bifrost",enabled:true}],menuHint:"Activate, then walk through the Portara to Bifrost.",onMenu:open=>{pilot.setActive(!open);pilot.controls.reset();input.reset();},onTraverse:()=>{if(leaving)return;world.pilot=avatar.traits.name;leaving=go("bifrost");}});
    gate.ring.visible=false;S.addChild(root,gate.root);
    const floor=land.heightAt(-45,-48);
    for(const x of [-48.2,-41.8])S.addChild(root,S.createNode({geometry:BL.models.box({w:1.25,h:7,d:1.5,color:"#d5c9aa"}),position:{x,y:floor+3.5,z:-48}}));
    S.addChild(root,S.createNode({geometry:BL.models.box({w:7.65,h:1.5,d:1.65,color:"#e4d8b9"}),position:{x:-45,y:floor+7.1,z:-48}}));
    Object.assign(gate.dialer.position,{x:-40,y:land.heightAt(-40,-43),z:-43});S.addChild(root,gate.dialer);
    panel=document.getElementById("dsb-panel");panel.hidden=true;
    context=document.getElementById("dsb-context");context.textContent="Dial Portara → Bifrost";
    document.body.classList.add("dsb-active");
    Object.assign(scene,{root,camera,input,debug:{camera,pilot,crew,controls:pilot.controls,hud,dsb:{land,gate,avatar,phase:"land",overview:OVERVIEW}}});
    walk();if(new URLSearchParams(location.search).get("overview")==="1")overviewView();
  };
  const update=(dt,time)=>{
    if(leaving)return;gate.update();
    Object.assign(before,avatar.root.position);before.y+=avatar.bodyHeight/2-avatar.baseY;
    if(!gate.isOpen){pilot.readInput(dt);if(!overview)crew.update(dt,time);pilot.update(dt);}
    Object.assign(after,avatar.root.position);after.y+=avatar.bodyHeight/2-avatar.baseY;
    if(!overview&&gate.traverse(before,after,avatar.bodyRadius,1))return;
    context.hidden=overview||!nearGate()||gate.isOpen;fx.update(dt);
  };
  const leave=()=>{
    if(avatar)world.pilot=avatar.traits.name;
    gate.dispose();pilot.dispose();crew.dispose();fx.dispose();const targets=input.targetCount;input.dispose();hud.el.sheet.hidden=oldSheet;hud.dispose();context.hidden=true;
    document.body.classList.remove("dsb-active");while(root.children.length)S.removeChild(root,root.children[root.children.length-1]);
    scene.debug=scene.input=null;land=avatar=crew=pilot=gate=fx=hud=input=null;return {targets};
  };
  Object.assign(scene,{enter,update,leave,onKey:e=>{if(e.key==="Escape"&&!gate.isOpen){overviewView();return true;}return false;},overlay:dt=>{const dpr=Math.min(devicePixelRatio||1,2),w=Math.round(overlayCanvas.clientWidth*dpr),h=Math.round(overlayCanvas.clientHeight*dpr);if(overlayCanvas.width!==w||overlayCanvas.height!==h){overlayCanvas.width=w;overlayCanvas.height=h;}overlayCanvas.getContext("2d").setTransform(dpr,0,0,dpr,0,0);fx.drawOverlay(dt,drawExtra);},stats:()=>({targets:input.targetCount,tweens:0}),liveGeometry:set=>{if(avatar)set.add(avatar.headOpen).add(avatar.headClosed);},onDonation:()=>{},onLootCleared:()=>{}});
  BL.scenes.dsb=scene;
})();
