// Approved DSB exterior with reusable, separately lit building interiors.
(() => {
  "use strict";
  const BL=window.BL, S=BL.scene, daylight=BL.daylight;
  const params=new URLSearchParams(location.search), DEBUG=params.has("debug"), LATITUDE=37;
  const OVERVIEW={yaw:-0.08,pitch:1.22,dist:207,target:{x:-2,y:10,z:-1}};
  // Same mutable sampling surface as the hub; geography and camera stay fixed.
  const renderOpts={
    clear:new Float32Array(3),horizon:new Float32Array(3),zenith:new Float32Array(3),sky:new Float32Array(3),ground:new Float32Array(3),sun:new Float32Array(3),direct:new Float32Array(3),
    light:{x:0,y:1,z:0},sunDirection:{x:0,y:1,z:0},moon:{x:0,y:1,z:0},celestialPole:{x:0,y:1,z:0},starMatrix:new Float32Array(9),
    shadowCenter:{x:0,y:10,z:0},shadowExtent:110,fogNear:250,fogFar:600,lights:new Float32Array(BL.glRenderer.POINT_LIGHT_CAPACITY*8),lightCount:0,time:0
  };
  renderOpts.fog=renderOpts.horizon;
  // Four structural validation lamps, not street dressing. Keep within even the lowest light tier.
  const LAMP_SPOTS=[[-49,-45],[-57,37],[20,63],[64,49]], lamps=[];
  let clock,water,weather,nature,detail,enrichment,interiors,exterior,noderunner,tv,spaces,studioTools,maxisMedia,maxisButton,maxisReview=false,maxisPick=null,studioReview=false,shopMenu,shopTools,shopPick=null,shopReview=false,shopMenuReview=0;
  let inkMenu,inkTools,inkPick=null,inkReview=false,inkMenuReview=0,inkLayoutObserver,inkLayoutPending=false;
  let bigMenu,bigPick=null,bigReview=false,bigMenuReview=0;
  const requestInkLayout=()=>{inkLayoutPending=true;};
  // Measure only on layout changes; both Proof of Ink browse affordances share Jump's anchor.
  const layoutInkBrowse=()=>{
    if(!matchMedia("(pointer: coarse), (max-width: 720px)").matches)return;
    const jump=document.getElementById("act").getBoundingClientRect();
    if(!jump.width)return;
    const x=jump.left+jump.width/2;
    let half=Math.min(90,x-12,document.documentElement.clientWidth-x-12);
    for(const id of ["joy-move","joy-look"]){
      const r=document.getElementById(id).getBoundingClientRect();
      if(r.width)half=Math.min(half,x>r.right?x-r.right-8:r.left>x?r.left-x-8:half);
    }
    for(const el of [inkTools,context]){
      el.style.setProperty("--ink-action-x",`${x}px`);
      el.style.setProperty("--ink-action-y",`${jump.top-8}px`);
      el.style.setProperty("--ink-action-width",`${Math.max(44,half*2)}px`);
    }
  };
  const sampleDaylight=()=>{
    daylight.sample(clock.read(),renderOpts,clock.dayOfYear,LATITUDE,clock.continuousDay);
    BL.dsbAtmosphere.light(renderOpts);
    const k=renderOpts.lampFactor, lights=renderOpts.lights;
    let count=0;
    for(const lamp of lamps){
      lamp.glow=k;
      if(k<=.001||count>=BL.glRenderer.POINT_LIGHT_CAPACITY)continue;
      const p=lamp.position,o=count++*8;
      lights[o]=p.x;lights[o+1]=p.y;lights[o+2]=p.z;lights[o+3]=10;
      lights[o+4]=k;lights[o+5]=.65*k;lights[o+6]=.3*k;lights[o+7]=0;
    }
    renderOpts.lightCount=count;
    atmosphere?.lights(renderOpts);
  };
  const scene={id:"dsb",renderOpts};
  let atmosphere=null,town=null;
  let root,camera,land,pilot,crew,avatar,hud,input,fx,gate,world,go,overlayCanvas,panel,context,oldSheet,leaving=false,overview=false;
  const drawExtra=()=>{
    const overlay=overlayCanvas.getContext("2d");
    if(interiors?.fade){overlay.save();overlay.fillStyle=`rgba(0,0,0,${interiors.fade})`;overlay.fillRect(0,0,overlayCanvas.clientWidth,overlayCanvas.clientHeight);overlay.restore();}
    if(!DEBUG||!weather)return;
    const c=overlayCanvas.getContext("2d"),s=weather.state;
    c.save();c.font="12px monospace";c.fillStyle="rgba(5,20,30,.8)";c.fillRect(12,160,350,78);c.fillStyle="#e7f3fa";
    c.fillText(`Weather: ${s.mode} · ${s.quality}`,20,176);
    c.fillText(`Rain ${s.precipitation.toFixed(2)} · cloud ${s.cloud.toFixed(2)}`,20,193);
    c.fillText(`Wind ${s.wind.strength.toFixed(2)} · ${s.exterior?"exterior":"interior / hidden"}`,20,210);
    if(nature)c.fillText(`Nature: ${nature.stats.visible}/${nature.stats.total} · seed ${nature.stats.seed}`,20,227);c.restore();
  };
  const before={x:0,y:0,z:0},after={x:0,y:0,z:0};
  const nearGate=()=>avatar&&Math.hypot(avatar.root.position.x+45,avatar.root.position.z+44)<10;
  const walk=()=>{overview=false;pilot.possess(avatar);pilot.navigate({position:{x:avatar.root.position.x,y:avatar.root.position.y-avatar.baseY,z:avatar.root.position.z},yaw:Math.PI,pitch:.22,dist:7});pilot.setActive(true);};
  const overviewView=()=>{if(interiors?.active||interiors?.transitioning)return;overview=true;pilot.goPreset("overview");};
  const nearTv=()=>!overview&&!interiors?.active&&!interiors?.transitioning&&noderunner?.near(avatar.root.position);
  const studioRoom=()=>interiors?.active?.room.id==="dsb-studio"?interiors.active.room:null;
  const maxisRoom=()=>interiors?.active?.room.id==="maxis-club"?interiors.active.room:null;
  const shopRoom=()=>interiors?.active?.room.id==="without-rulers"?interiors.active.room:null;
  const inkRoom=()=>interiors?.active?.room.id==="proof-of-ink"?interiors.active.room:null;
  const bigRoom=()=>interiors?.active?.room.id==="big-bitcoin"?interiors.active.room:null;
  const nearBig=()=>{const q=bigRoom()?.mediaAt,p=avatar.root.position;return !!q&&Math.hypot(p.x-q.x,p.z-q.z)<2;};
  const nearInk=()=>{const q=inkRoom()?.mediaAt,p=avatar.root.position;return !!q&&Math.hypot(p.x-q.x,p.z-q.z)<2;};
  const seatRoom=()=>studioRoom()||maxisRoom()||shopRoom()||inkRoom()||bigRoom();
  const nearShop=()=>{const q=shopRoom()?.mediaAt,p=avatar.root.position;return !!q&&Math.hypot(p.x-q.x,p.z-q.z)<2;};
  const nearMaxis=()=>{const q=maxisRoom()?.mediaAt,p=avatar.root.position;return !!q&&Math.hypot(p.x-q.x,p.z-q.z)<2;};
  const seatNear=()=>{
    const room=seatRoom();if(!room||avatar.camp.seat)return null;
    const p=avatar.root.position;
    for(const seat of room.seats)if(!seat.sitter&&Math.hypot(p.x-seat.walkAt.x,p.z-seat.walkAt.z)<1.25&&Math.abs(p.y-avatar.baseY-seat.floor)<.45)return seat;
    return null;
  };
  const nearSpaces=()=>{const p=avatar.root.position,q=studioRoom()?.jukeboxAt;return !!q&&Math.hypot(p.x-q.x,p.z-q.z)<2&&Math.abs(p.y-avatar.baseY-q.y)<1;};
  const sit=seat=>{
    if(!seat)return false;
    if(pilot.player!==avatar)pilot.possess(avatar);
    input.reset();
    pilot.navigate({position:{x:seat.walkAt.x,y:seat.floor,z:seat.walkAt.z},yaw:seat.viewYaw??Math.atan2(seat.x,seat.z+13),pitch:.12,dist:3});
    const seated=crew.sitPlayer(seat);if(seated){pilot.enterClose();pilot.showAct();}return seated;
  };
  const studioAct=()=>{
    if(!seatRoom())return false;
    if(avatar.camp.seat){input.reset();const stood=crew.standPlayer();if(stood){pilot.exitClose();pilot.showAct();}return stood;}
    if(nearSpaces()){spaces.open();return true;}
    if(nearMaxis()){maxisMedia.open();return true;}
    if(nearShop()){shopMenu.open();return true;}
    if(nearInk()){inkMenu.open();return true;}
    if(nearBig()){bigMenu.open();return true;}
    const seat=seatNear();return seat?sit(seat):false;
  };
  const act=()=>{if(tv?.isOpen||spaces?.isOpen||maxisMedia?.isOpen||shopMenu?.isOpen||inkMenu?.isOpen||bigMenu?.isOpen)return true;if(!interiors?.transitioning&&studioAct())return true;if(nearTv()){tv.open();return true;}if(!overview&&interiors?.request(avatar.root.position))return true;if(interiors?.active)return false;if(nearGate()&&!overview){gate.open();return true;}return false;};
  const mute=()=>{const on=weather.toggleMuted(),button=document.getElementById("dsb-mute");interiors?.audio.update(on);button.textContent=on?"Unmute":"Mute";button.setAttribute("aria-pressed",String(on));};
  const action=name=>{if(seatRoom()&&(pilot.modeAction(name)||pilot.weaponAction(name)))return;if(name==="dsb-mute")mute();else if(interiors?.transitioning)return;else if(name==="dsb-lookout")overviewView();else if(name==="reset-view")walk();else if(name==="dsb-context")act();else if(name==="act")pilot.action();else if(name==="leave")hud.toast("Return through the Portara at the summit.");};
  const enter=ctx=>{
    ({world,go}=ctx);leaving=false;overview=false;
    root=S.createNode();exterior=S.createNode();S.addChild(root,exterior);land=BL.dsbGeography.build();S.addChild(exterior,land.root);
    water=BL.dsbWater.create(land);S.removeChild(land.root,land.sea);S.addChild(exterior,water.node);renderOpts.dsbWater=water;
    Object.assign(renderOpts,BL.dsbAtmosphere.OPTS);atmosphere=BL.dsbAtmosphere.create({root:exterior,land,renderer:ctx.renderer});
    clock=daylight.createClock({hour:DEBUG?parseFloat(params.get("hour")):NaN,daylen:DEBUG?parseFloat(params.get("daylen")):NaN,day:DEBUG?parseFloat(params.get("day")):NaN,time:DEBUG?params.get("time"):null,now:new Date()});
    const lampGeometry=BL.models.box({w:.24,h:.32,d:.24,color:"#ffcc80"});
    for(const [x,z] of LAMP_SPOTS){
      const y=land.heightAt(x,z);
      S.addChild(exterior,S.createNode({geometry:BL.models.box({w:.18,h:2,d:.18,color:"#8b8170"}),position:{x,y:y+1,z}}));
      const lamp=S.createNode({geometry:lampGeometry,position:{x,y:y+2.16,z}});
      lamps.push(lamp);S.addChild(exterior,lamp);
    }
    sampleDaylight();
    camera=S.createCamera({fov:55,near:.1,far:750});overlayCanvas=ctx.overlay;
    const asked=new URLSearchParams(location.search).get("character");
    const name=BL.contributors.roster.find(c=>c.name===(world.pilot||asked))?.name||"YellowBrokeIt";world.pilot=null;
    hud=BL.hud.create({roster:BL.contributors.roster,catalog:BL.models.SWAG,tierColors:BL.models.TIER_COLORS,renderIcon:BL.hud.renderIcon,lootEnabled:false});
    hud.setAreaLabel("DSB LAND · MASTER LAYOUT");oldSheet=hud.el.sheet.hidden;hud.el.sheet.hidden=true;
    const hooks={};input=BL.interact.create({canvas:ctx.canvas,renderer:ctx.renderer,camera,hooks});
    pilot=BL.pilot.create({renderer:ctx.renderer,canvas:ctx.canvas,camera,hud,presets:{...BL.dsbEnrichment.REVIEWS,overview:OVERVIEW,chora:{yaw:.62,pitch:.12,dist:18,target:{x:31,y:7,z:33}}},landing:"overview",pitch:[.1,1.45],dist:[3,270],follow:{y:1,min:3,max:9,pitch:[.1,.8]},fly:{speed:8,perDist:.1,climb:5,yMax:180},clampCamera:p=>interiors?interiors.clampCamera(p,avatar?.root.position):p.y=Math.max(p.y,land.heightAt(p.x,p.z)+1),coarse:matchMedia("(pointer: coarse)").matches,onFreeAction:act,onPlayerAction:act,close:{eyeHeight:1.7,eyeRatio:.8,eyeForward:0,maxStep:.6,pitch:[-1.2,1.2],orbitDist:12,trailingDist:6,groundAt:(x,z)=>interiors?interiors.groundAt(x,z):land.heightAt(x,z)}});
    fx=BL.fx.create({root,renderer:ctx.renderer,camera,overlay:ctx.overlay,hud,tickerAt:{x:-45,y:42,z:-44}});
    const splatGeometry=BL.models.particleGeometry("#e34d32",.12,0);
    const shared={
      tomatoContact:(x,y,z,p)=>seatRoom()?.tomatoContact(x,y,z,p,avatar.camp.seat),
      onTomatoImpact:p=>{if(!seatRoom())return;for(let i=0;i<7;i++){const a=i*Math.PI*2/7;fx.spawnParticle(splatGeometry,p.x,p.y,p.z,Math.cos(a)*1.8,.8+(i%3)*.3,Math.sin(a)*1.8,.4,3,5,interiors.groundAt(p.x,p.z)+.06);}},
      root,input,hud,game:ctx.game,world:{level:0,weapons:new Map(),magazine:{owned:false,count:0,ammo:0,carrier:null}},playerName:name,reloadPolicy:{near:()=>false,available:()=>false},fx,viewYaw:Math.PI,groundAt:(x,z)=>interiors?interiors.groundAt(x,z):land.groundAt(x,z),walkable:(ax,az,bx,bz,y,h,a)=>(interiors?interiors.walkable(ax,az,bx,bz,y,h,a):land.walkable(ax,az,bx,bz,y,h,a))&&(!noderunner||interiors?.active||noderunner.clearSegment(ax,az,bx,bz,y,h,a))&&(!town||interiors?.active||town.clearSegment(ax,az,bx,bz,y,h,a))};
    crew=shared.crew=BL.crew.create(shared);pilot.bind(shared);avatar=crew.cavemen.get(name);
    Object.assign(avatar.root.position,{x:-45,y:land.heightAt(-45,-43)+avatar.baseY,z:-43});avatar.root.rotation.y=0;
    Object.assign(hooks,pilot.hooks);hud.onAction(action);hud.onPreset(()=>overviewView());
    // Keep the upstream elapsed-time/input/one-shot transport controller, but replace its ring visually.
    gate=BL.oogaPortal.create({radius:2.5,outerRadius:2.8,position:{x:-45,y:land.heightAt(-45,-48)+2.4,z:-48},rotation:{x:Math.PI/2,y:0,z:0},destinations:[{id:"bifrost",label:"OogaBoogaLand Bifrost",enabled:true}],menuHint:"Activate, then walk through the Portara to Bifrost.",onMenu:open=>{pilot.setActive(!open);pilot.controls.reset();input.reset();},onTraverse:()=>{if(leaving)return;world.pilot=avatar.traits.name;leaving=go("bifrost");}});
    gate.ring.visible=false;S.addChild(exterior,gate.root);
    const floor=land.heightAt(-45,-48);
    S.addChild(exterior,S.createNode({geometry:BL.dsbAtmosphere.portara(),position:{x:-45,y:floor,z:-48}}));
    Object.assign(gate.dialer.position,{x:-40,y:land.heightAt(-40,-43),z:-43});S.addChild(exterior,gate.dialer);
    panel=document.getElementById("dsb-panel");panel.hidden=true;
    context=document.getElementById("dsb-context");context.textContent="Dial Portara → Bifrost";
    document.body.classList.add("dsb-active");
    noderunner=BL.dsbNoderunner.create({root:exterior,land});
    weather=BL.dsbWeather.create({root:exterior,renderer:ctx.renderer,camera,land,water,params,audioFactory:noderunner.createAudio});
    input.add(noderunner.screenFace,{kind:"dsb-tv"});
    const tap=hooks.onTap;hooks.onTap=(hit,p)=>{if(hit?.owner?.kind==="big-terminal"&&bigRoom()){bigMenu.open();return;}if(hit?.owner?.kind==="ink-kiosk"&&inkRoom()){inkMenu.open();return;}if(hit?.owner?.kind==="rulers-kiosk"&&shopRoom()){shopMenu.open();return;}if(hit?.owner?.kind==="maxis-media"&&maxisRoom()){maxisMedia.open();return;}if(hit?.owner?.kind==="dsb-tv"){if(nearTv())act();return;}tap?.(hit,p);};
    tv=BL.dsbTv.create(noderunner.screen,ctx.renderer,{play:()=>noderunner.audio?.play(),radioStatus:()=>noderunner.audio?.status||"Press Play radio to enable sound",onOpen:open=>{pilot.setActive(!open);pilot.controls.reset();input.reset();}});
    nature=BL.dsbNature.create({root:exterior,land,renderer:ctx.renderer,camera,weather});
    detail=BL.dsbExterior.create({root:exterior,land,nature});
    enrichment=BL.dsbEnrichment.create({root:exterior,land,nature,detail,renderer:ctx.renderer,camera});
    town=BL.dsbTown.create({root:exterior,land,nature,detail,enrichment});
    interiors=BL.dsbInteriors.create({root,exterior,land,weather,
      relocate:(position,yaw,dist)=>{overview=false;pilot.setActive(true);if(pilot.player!==avatar)pilot.possess(avatar);pilot.navigate({position,yaw,pitch:.22,dist});pilot.setActive(!interiors?.transitioning);},
      lock:on=>{pilot.setActive(!on);pilot.controls.reset();input.reset();},
      onChange:(lighting,label)=>{
        document.body.classList.toggle("dsb-studio-active",!!studioRoom());document.body.classList.toggle("maxis-club-active",!!maxisRoom());
        crew.clearProjectiles();crew.setWeaponTrigger(false);if(studioRoom())spaces?.enter();else spaces?.leave();
        if(maxisPick){maxisPick.setMedia(false);input.remove(maxisPick.screen);input.remove(maxisPick.console);maxisPick=null;}
        if(maxisRoom()){maxisMedia?.enter();maxisPick=maxisRoom();input.add(maxisPick.screen,{kind:"maxis-media"});input.add(maxisPick.console,{kind:"maxis-media"});}
        else maxisMedia?.leave();
        if(shopPick){input.remove(shopPick.screen);shopPick=null;}
        if(shopRoom()){shopMenu?.enter();shopPick=shopRoom();input.add(shopPick.screen,{kind:"rulers-kiosk"});}else shopMenu?.leave();
        if(inkPick){input.remove(inkPick.screen);inkPick=null;}
        requestInkLayout();
        if(inkRoom()){inkMenu?.enter();inkPick=inkRoom();input.add(inkPick.screen,{kind:"ink-kiosk"});}else inkMenu?.leave();
        if(bigPick){input.remove(bigPick.screen);bigPick=null;}
        if(bigRoom()){bigMenu?.enter();bigPick=bigRoom();input.add(bigPick.screen,{kind:"big-terminal"});}else bigMenu?.leave();
        scene.renderOpts=lighting||renderOpts;hud.setAreaLabel(label);
      }
    });
    spaces=BL.dsbSpaces.create({onOpen:on=>{pilot.setActive(!on&&!interiors.transitioning);pilot.controls.reset();input.reset();crew.setWeaponTrigger(false);},onPlaying:()=>{}});
    maxisMedia=BL.maxisMedia.create({onOpen:on=>{pilot.setActive(!on&&!interiors.transitioning);pilot.controls.reset();input.reset();crew.setWeaponTrigger(false);},onSource:source=>maxisRoom()?.setMedia(!!source)});
    shopMenu=BL.withoutRulersMenu.create({onOpen:on=>{pilot.setActive(!on&&!interiors.transitioning);pilot.controls.reset();input.reset();crew.setWeaponTrigger(false);}});
    shopTools=document.createElement("div");shopTools.className="rulers-tools";shopTools.hidden=true;
    const shopButton=document.createElement("button");shopButton.type="button";shopButton.textContent="Browse Without Rulers";shopButton.onclick=()=>shopMenu.open();shopTools.appendChild(shopButton);document.body.appendChild(shopTools);
    inkMenu=BL.proofOfInkMenu.create({onOpen:on=>{pilot.setActive(!on&&!interiors.transitioning);pilot.controls.reset();input.reset();crew.setWeaponTrigger(false);}});
    bigMenu=BL.bigBitcoinMenu.create({action:context,onOpen:on=>{pilot.setActive(!on&&!interiors.transitioning);pilot.controls.reset();input.reset();crew.setWeaponTrigger(false);}});
    inkTools=document.createElement("div");inkTools.className="ink-tools";inkTools.hidden=true;
    const inkButton=document.createElement("button");inkButton.type="button";inkButton.textContent="Browse Proof of Ink";inkButton.onclick=()=>inkMenu.open();inkTools.appendChild(inkButton);document.body.appendChild(inkTools);
    inkLayoutObserver=new ResizeObserver(requestInkLayout);
    for(const el of [document.getElementById("act"),document.querySelector(".bottom-hud"),document.documentElement])inkLayoutObserver.observe(el);
    window.addEventListener("resize",requestInkLayout);requestInkLayout();
    studioTools=document.createElement("div");studioTools.className="dsb-studio-tools";studioTools.hidden=true;
    const tomato=document.createElement("button");tomato.type="button";tomato.textContent="Throw tomato · T";tomato.onclick=()=>{if(seatRoom()&&!spaces.isOpen&&!maxisMedia.isOpen)crew.throwTomato();};studioTools.appendChild(tomato);
    maxisButton=document.createElement("button");maxisButton.type="button";maxisButton.textContent="MAXIS MEDIA";maxisButton.hidden=true;maxisButton.onclick=()=>maxisMedia.open();studioTools.appendChild(maxisButton);
    document.body.appendChild(studioTools);
    studioReview=false;maxisReview=false;shopReview=false;shopMenuReview=0;inkReview=false;inkMenuReview=0;
    bigReview=false;bigMenuReview=0;
    scene.renderOpts=renderOpts;
    Object.assign(scene,{root,camera,input,setInterior:weather.setInterior,debug:{weather:weather.shared,renderOpts,daylight:clock,camera,pilot,crew,controls:pilot.controls,hud,dsb:{land,water,weather,nature,detail,enrichment,get town(){return town;},get atmosphere(){return atmosphere;},noderunner,tv,spaces,maxisMedia,shopMenu,inkMenu,bigMenu,interiors,exterior,setInterior:weather.setInterior,gate,avatar,get phase(){return interiors?.active?"interior":"land";},overview:OVERVIEW}}});
    walk();
    if(DEBUG&&params.get("view")==="clearing") {
      const p=land.marks.clearing;
      pilot.navigate({position:{x:p.x,y:p.y,z:p.z},yaw:-2.4,pitch:.22,dist:7});
    }
    if(DEBUG&&params.get("view")==="noderunner")pilot.navigate({position:noderunner.review,yaw:noderunner.building.yaw,pitch:-.18,dist:9});
    if(DEBUG&&params.get("view")==="chora"){overview=true;pilot.goPreset("chora");}
    if(DEBUG&&BL.dsbEnrichment.REVIEWS[params.get("view")]){overview=true;pilot.goPreset(params.get("view"));}
    if(params.get("overview")==="1")overviewView();
    if(DEBUG&&(params.get("view")==="meme-factory"||params.get("interior")==="meme-factory"))interiors.review("meme-factory",params.get("interior")==="meme-factory");
    if(DEBUG&&(params.get("view")==="maxis-door"||params.get("interior")==="maxis-club"))interiors.review("maxis-club",params.get("interior")==="maxis-club");
    if(DEBUG&&(params.get("view")==="rulers-door"||params.get("interior")==="without-rulers"))interiors.review("without-rulers",params.get("interior")==="without-rulers");
    if(DEBUG&&(params.get("view")==="ink-door"||params.get("interior")==="proof-of-ink"))interiors.review("proof-of-ink",params.get("interior")==="proof-of-ink");
    if(DEBUG&&(params.get("view")==="big-door"||params.get("interior")==="big-bitcoin"))interiors.review("big-bitcoin",params.get("interior")==="big-bitcoin");
    if(DEBUG&&(params.get("view")==="studio-door"||params.get("interior")==="dsb-studio"))interiors.review("dsb-studio",params.get("interior")==="dsb-studio");
  };
  const update=(dt,time)=>{
    if(leaving)return;sampleDaylight();renderOpts.time=time;if(!interiors.active){water.update(time);gate.update();}interiors.update(dt);
    if(DEBUG&&!studioReview&&studioRoom()&&!interiors.transitioning){
      studioReview=true;const room=studioRoom(),view=params.get("view");
      if(view==="studio-seat")sit(room.seats[19]);
      if(view==="studio-host")sit(room.hostSeat);
      if(view==="studio-booth")pilot.navigate({position:{x:4,y:3,z:14.8},yaw:Math.PI/2,pitch:.12,dist:3});
      if(view==="studio-mic")pilot.navigate({position:{x:8,y:.6,z:-10.9},yaw:0,pitch:.12,dist:3});
      if(view==="studio-jukebox")pilot.navigate({position:room.jukeboxAt,yaw:Math.PI/2,pitch:.12,dist:3});
      if(view==="studio-reveal")pilot.navigate({position:{x:0,y:3,z:8.5},yaw:0,pitch:.24,dist:4});
      if(view==="studio-balcony")pilot.navigate({position:{x:13.5,y:3,z:7.5},yaw:.45,pitch:.12,dist:3});
      if(view==="studio-stage")pilot.navigate({position:{x:-1,y:0,z:-5.8},yaw:0,pitch:-.1,dist:5});
    }
    if(DEBUG&&!maxisReview&&maxisRoom()&&!interiors.transitioning){
      maxisReview=true;const room=maxisRoom(),view=params.get("view");
      if(view==="maxis-seat")sit(room.seats[34]);
      else if(room.reviews[view])pilot.navigate(room.reviews[view]);
    }
    if(DEBUG&&!shopReview&&shopRoom()&&!interiors.transitioning){
      shopReview=true;const room=shopRoom(),view=params.get("view");
      if(view==="rulers-seat")sit(room.seats[0]);else if(room.reviews[view])pilot.navigate(room.reviews[view]);
      if(view==="rulers-menu"){pilot.navigate(room.reviews["rulers-kiosk"]);shopMenuReview=1;}
    }
    if(DEBUG&&!inkReview&&inkRoom()&&!interiors.transitioning){
      inkReview=true;const room=inkRoom(),view=params.get("view");
      if(view==="ink-seat")sit(room.seats[1]);else if(room.reviews[view])pilot.navigate(room.reviews[view]);
      if(view==="ink-catalog"){pilot.navigate(room.reviews["ink-kiosk"]);inkMenuReview=1;}
    }
    if(DEBUG&&!bigReview&&bigRoom()&&!interiors.transitioning){
      bigReview=true;const room=bigRoom(),view=params.get("view");
      if(view==="big-seat")sit(room.seats[0]);else if(room.reviews[view])pilot.navigate(room.reviews[view]);
      if(view==="big-info"){pilot.navigate(room.reviews["big-terminal"]);bigMenuReview=1;}
    }
    bigMenu.layout();
    inkTools.hidden=!inkRoom()||interiors.transitioning||inkMenu.isOpen||nearInk();
    shopTools.hidden=!shopRoom()||interiors.transitioning||shopMenu.isOpen;
    studioTools.hidden=!(studioRoom()||maxisRoom())||interiors.transitioning||spaces.isOpen||maxisMedia.isOpen;maxisButton.hidden=!maxisRoom();
    if(maxisRoom())maxisMedia.setGain(maxisRoom().gainAt(avatar.root.position.x,avatar.root.position.z),weather.shared.state.muted);
    spaces.setMuted(weather.shared.state.muted);
    Object.assign(before,avatar.root.position);before.y+=avatar.bodyHeight/2-avatar.baseY;
    if(!gate.isOpen&&!tv.isOpen&&!spaces.isOpen&&!maxisMedia.isOpen&&!shopMenu.isOpen&&!bigMenu.isOpen&&!inkMenu.isOpen&&!interiors.transitioning){pilot.readInput(dt);if(!overview&&!interiors.transitioning)crew.update(dt,time);pilot.update(dt);}
    if(bigMenuReview>0){bigMenuReview=Math.max(0,bigMenuReview-dt);if(bigMenuReview===0&&bigRoom())bigMenu.open();}
    if(inkMenuReview>0){inkMenuReview=Math.max(0,inkMenuReview-dt);if(inkMenuReview===0&&inkRoom())inkMenu.open();}
    if(shopMenuReview>0){shopMenuReview=Math.max(0,shopMenuReview-dt);if(shopMenuReview===0&&shopRoom())shopMenu.open();}
    if(studioRoom()&&!interiors.transitioning){
      const p=avatar.root.position,q=studioRoom().jukeboxSource,d=Math.hypot(p.x-q.x,p.z-q.z);
      // Full volume beside the cabinet, steep falloff, hard silent boundary before the theater.
      const distance=Math.max(0,1-Math.max(0,d-1.3)/4),door=Math.max(0,Math.min(1,(p.z-9.2)/2));
      spaces.setGain(distance*distance*door);interiors.audio.setDucked(spaces.playing&&distance*door>.1);
    }
    Object.assign(after,avatar.root.position);after.y+=avatar.bodyHeight/2-avatar.baseY;
    if(!interiors.active&&!interiors.transitioning&&!overview&&gate.traverse(before,after,avatar.bodyRadius,1))return;
    detail.update(renderOpts.lampFactor);weather.update(dt,renderOpts);atmosphere.update(time,renderOpts,!interiors.active);noderunner.update(dt,avatar.root.position,weather.state,renderOpts.lampFactor);tv.update();if(!interiors.active){nature.update(dt,time);enrichment.update(time,renderOpts.lampFactor);}
    const door=interiors.target(avatar.root.position);
    const studioLabel=seatRoom()?(avatar.camp.seat?"Stand up":nearSpaces()?"Open DSB Spaces":nearMaxis()?"Open MAXIS MEDIA":nearShop()?"Browse Without Rulers":nearInk()?"Browse Proof of Ink":nearBig()?"BIG BITCOIN Info":seatNear()?(bigRoom()?"Sit":(shopRoom()||inkRoom())?"Sit · browse corner":maxisRoom()?"Sit · view screen":"Sit · view stage"):null):null;
    const label=studioLabel|| (nearTv()?"Open DSB TV":door?`${interiors.active?"Exit":"Enter"} ${door.building.name}`:"Dial Portara → Bifrost");
    if(context.textContent!==label)context.textContent=label;
    context.classList.toggle("ink-context-browse",!!inkRoom()&&studioLabel==="Browse Proof of Ink");
    if(inkLayoutPending&&inkRoom()){inkLayoutPending=false;layoutInkBrowse();}
    context.hidden=!!avatar.camp.seat||overview||interiors.transitioning||gate.isOpen||tv.isOpen||spaces.isOpen||maxisMedia.isOpen||shopMenu.isOpen||inkMenu.isOpen||bigMenu.isOpen||(!studioLabel&&!nearTv()&&!door&&(interiors.active||!nearGate()));fx.update(dt);
  };
  const leave=()=>{
    if(avatar)world.pilot=avatar.traits.name;
    inkLayoutObserver.disconnect();inkLayoutObserver=null;window.removeEventListener("resize",requestInkLayout);
    context.classList.remove("ink-context-browse");
    bigMenu.dispose();bigMenu=null;if(bigPick){input.remove(bigPick.screen);bigPick=null;}
    inkMenu.dispose();inkMenu=null;inkTools.remove();inkTools=null;if(inkPick){input.remove(inkPick.screen);inkPick=null;}
    shopMenu.dispose();shopMenu=null;shopTools.remove();shopTools=null;if(shopPick){input.remove(shopPick.screen);shopPick=null;}
    maxisMedia.dispose();maxisMedia=null;if(maxisPick){maxisPick.setMedia(false);input.remove(maxisPick.screen);input.remove(maxisPick.console);maxisPick=null;}
    spaces.dispose();spaces=null;studioTools.remove();studioTools=maxisButton=null;
    input.remove(noderunner.screenFace);tv.dispose();tv=null;interiors.dispose();interiors=null;exterior=null;scene.renderOpts=renderOpts;
    noderunner.dispose();noderunner=null;
    town.dispose();town=null;atmosphere.dispose();atmosphere=null;enrichment.dispose();enrichment=null;detail.dispose();detail=null;nature.dispose();nature=null;weather.dispose();weather=null;gate.dispose();pilot.dispose();crew.dispose();fx.dispose();const targets=input.targetCount;input.dispose();hud.el.sheet.hidden=oldSheet;hud.dispose();context.hidden=true;
    document.body.classList.remove("dsb-active","dsb-studio-active","maxis-club-active");while(root.children.length)S.removeChild(root,root.children[root.children.length-1]);
    lamps.length=0;renderOpts.lightCount=0;clock=null;water=renderOpts.dsbWater=null;
    scene.setInterior=scene.debug=scene.input=null;land=avatar=crew=pilot=gate=fx=hud=input=null;return {targets};
  };
  Object.assign(scene,{enter,update,leave,onKey:e=>{if(bigMenu?.isOpen){if(e.key==="Escape")bigMenu.close();return true;}if(inkMenu?.isOpen){if(e.key==="Escape")inkMenu.close();return true;}if(shopMenu?.isOpen){if(e.key==="Escape")shopMenu.close();return true;}if(maxisMedia?.isOpen){if(e.key==="Escape")maxisMedia.close();return true;}if(spaces?.isOpen){if(e.key==="Escape")spaces.close();return true;}if(seatRoom()&&(e.key==="1"||e.key==="2"))return pilot.weaponMode(Number(e.key));if(seatRoom()&&e.key.toLowerCase()==="v")return pilot.weaponAction("weapon-fire");if(e.key.toLowerCase()==="t"&&seatRoom()){crew.throwTomato();return true;}if(tv?.isOpen){if(e.key==="Escape")tv.close();return true;}if(e.key.toLowerCase()==="m"){mute();return true;}if(e.key==="Escape"&&!gate.isOpen){overviewView();return true;}return false;},overlay:dt=>{const dpr=Math.min(devicePixelRatio||1,2),w=Math.round(overlayCanvas.clientWidth*dpr),h=Math.round(overlayCanvas.clientHeight*dpr);if(overlayCanvas.width!==w||overlayCanvas.height!==h){overlayCanvas.width=w;overlayCanvas.height=h;}overlayCanvas.getContext("2d").setTransform(dpr,0,0,dpr,0,0);fx.drawOverlay(dt,drawExtra);},stats:()=>({targets:input.targetCount,tweens:0}),liveGeometry:set=>{if(avatar)set.add(avatar.headOpen).add(avatar.headClosed);},onDonation:()=>{},onLootCleared:()=>{}});
  BL.scenes.dsb=scene;
})();
