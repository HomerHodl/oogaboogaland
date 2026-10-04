// One visitor, one active source, one disposable provider document. No multiplayer, storage or API secrets.
(() => {
  "use strict";
  const BL=window.BL,data=BL.maxisMediaData;
  const script=document.currentScript?.src;
  const create=({onOpen:notify=()=>{},onSource=()=>{}}={})=>{
    const playerUrl=new URL(script?"../maxis-player/index.html":"src/maxis-player/index.html",script||location.href).href;
    const onOpen=on=>{BL.dsbMenuShell.present(root,on);notify(on);};
    const root=document.createElement("section");root.className="maxis-media";root.hidden=true;root.setAttribute("aria-label","Maxis Media");
    // Static markup only; all supplied titles, URLs and provider messages are assigned through textContent.
    root.innerHTML='<header><h2>MAXIS MEDIA</h2><button type="button" data-do="menu">Sources</button><button type="button" data-do="close">Return to club</button></header><div class="maxis-browser"><nav aria-label="Media sources"></nav><div class="maxis-source"><p class="maxis-help"></p><form><label>Media URL<input type="url" required placeholder="https://…" autocomplete="off"></label><button type="submit">Load media</button></form><label class="maxis-search">Search Maxis Picks<input type="search" placeholder="Title, topic or source"></label><div class="maxis-picks"></div><button type="button" data-do="live" hidden>LIVE FROM YELLOW</button></div></div><div class="maxis-playback"><div class="maxis-player-slot"></div><p class="maxis-status" role="status">Choose a source. Playback is local to your browser.</p><footer><button type="button" data-do="fullscreen">FULLSCREEN</button><button type="button" data-do="stop">Stop</button><label>Volume<input class="maxis-volume" type="range" min="0" max="1" step="0.05" value="0.8"></label><a target="_blank" rel="noopener noreferrer" hidden>Open original</a></footer></div>';
    document.body.appendChild(root);
    const one=s=>root.querySelector(s),browser=one(".maxis-browser"),nav=one("nav"),help=one(".maxis-help"),form=one("form"),url=form.querySelector("input"),searchWrap=one(".maxis-search"),search=searchWrap.querySelector("input"),picks=one(".maxis-picks"),liveButton=one('[data-do="live"]'),slot=one(".maxis-player-slot"),status=one(".maxis-status"),original=one("a"),volume=one(".maxis-volume");
    let active=false,disposed=false,isOpen=false,frame=null,source=null,category="home",gain=.8,muted=false,lastVolume=-1,timeout=0,filling=false,epoch=0;
    const sections=[["home","MEDIA HOME"],["picks","MAXIS PICKS"],["youtube","YOUTUBE"],["twitch","TWITCH"],["x","X / TWITTER"],["direct","DIRECT URL"],["live","LIVE"],["search","SEARCH"]];
    for(const [key,label] of sections){const b=document.createElement("button");b.type="button";b.dataset.category=key;b.textContent=label;nav.appendChild(b);}
    const command=(action,extra={})=>frame?.contentWindow?.postMessage({kind:"maxis-command",action,...extra},location.origin);
    const applyVolume=()=>{
      const next=muted||document.hidden?0:Math.round(Number(volume.value)*gain*100)/100;
      // X and clips expose no volume API. Disposing is the only supported way to guarantee silence.
      if(next===0&&(source?.provider==="x"||source?.clip)){stop("Post / clip stopped to keep the club muted. Unmute, then reload it to watch.");return;}
      if(next===lastVolume)return;lastVolume=next;command("volume",{value:next});
    };
    const fullOff=()=>{const wasFull=filling;filling=false;if(wasFull)onOpen(isOpen);root.classList.remove("maxis-fullscreen");if(document.fullscreenElement===root)document.exitFullscreen().catch(()=>{});};
    const stop=(message="Playback stopped.")=>{
      epoch++;clearTimeout(timeout);timeout=0;command("pause");frame?.remove();frame=null;source=null;slot.replaceChildren();lastVolume=-1;original.hidden=true;onSource(null);status.textContent=message;
    };
    const list=()=>{
      picks.replaceChildren();
      const found=data.search(search.value);
      for(const item of found){const b=document.createElement("button");b.type="button";b.dataset.pick=item.id;b.textContent=item.title+" · "+item.description;picks.appendChild(b);}
      if(!found.length)picks.textContent="No matching configured sources.";
    };
    const choose=key=>{
      key=sections.some(s=>s[0]===key)?key:"home";category=key;form.hidden=["home","picks","search","live"].includes(key);searchWrap.hidden=!["picks","search"].includes(key);picks.hidden=key!=="home"&&searchWrap.hidden;liveButton.hidden=key!=="live";
      for(const b of nav.children)b.setAttribute("aria-pressed",String(b.dataset.category===key));
      help.textContent=key==="home"?"Choose Maxis Picks or a media source. Load a link to begin your screening.":key==="live"?"Yellow’s broadcast will appear here when a public playback endpoint is configured.":key==="x"?"Public post embeds only. X controls availability and playback. Returning to the club closes the post.":key==="twitch"?"Channels, VODs and clips. Twitch needs at least 400 × 300 pixels; use landscape or fullscreen on a narrow phone.":key==="youtube"?"Paste a video or playlist URL. Playback uses YouTube’s own controls.":key==="direct"?"HTTPS MP4, WebM or browser-playable audio. HLS requires native browser support.":"Filter the owner-configured picks below. Provider-wide search is not connected.";
      list();
    };
    const open=(route="home")=>{if(!active||disposed)return;if(!isOpen){search.value="";choose(route);}root.hidden=false;browser.hidden=false;isOpen=true;root.classList.remove("maxis-docked");onOpen(true);};
    const close=()=>{
      fullOff();if(source?.provider==="x"||source?.clip)stop("Post / clip closed. Reopen its source to watch again.");
      isOpen=false;browser.hidden=true;root.hidden=!frame;root.classList.add("maxis-docked");onOpen(false);document.activeElement?.blur();
    };
    const load=(provider,value)=>{
      if(!active||disposed)return false;
      let next;try{next=data.parse(provider,value);}catch(e){status.textContent=e.message;return false;}
      stop();open();
      if(next.offline){status.textContent=next.title;return true;}
      if((next.provider==="x"||next.clip)&&(muted||document.hidden||Number(volume.value)*gain===0)){status.textContent="Unmute before loading an X post / Twitch clip. This provider has no remote volume control.";return false;}
      source=next;frame=document.createElement("iframe");frame.title="Maxis active media player";frame.allow="autoplay; fullscreen; encrypted-media";frame.allowFullscreen=true;frame.referrerPolicy="strict-origin-when-cross-origin";
      frame.src=playerUrl;slot.appendChild(frame);original.href=next.url;original.hidden=false;onSource(next);
      status.textContent="Loading "+next.provider.toUpperCase()+"…";
      const ticket=epoch;timeout=setTimeout(()=>{timeout=0;if(ticket===epoch&&frame)status.textContent="Still waiting for the provider. Check the original link or try another source.";},15000);
      return true;
    };
    const fullscreen=()=>{
      if(!frame){status.textContent="Load media first.";return;}
      if(filling||document.fullscreenElement===root){fullOff();return;}
      filling=true;root.classList.add("maxis-fullscreen");onOpen(true);
      // Keep this same iframe and playback position. CSS is the fallback where the Fullscreen API is unavailable.
      if(root.requestFullscreen)root.requestFullscreen().catch(()=>{if(active)status.textContent="Device-filling view. Press FULLSCREEN again to return.";});
    };
    const click=e=>{
      const b=e.target.closest("button");if(!b)return;
      if(b.dataset.category)choose(b.dataset.category);
      if(b.dataset.pick){const item=data.picks.find(i=>i.id===b.dataset.pick);if(item)load(item.provider,item.url);}
      const action=b.dataset.do;
      if(action==="close")close();if(action==="menu")open();if(action==="live")load("live","");if(action==="stop"){stop();if(!isOpen)root.hidden=true;}if(action==="fullscreen")fullscreen();b.blur();
    };
    const submit=e=>{e.preventDefault();load(category,url.value);};
    const receive=e=>{
      if(!active||e.source!==frame?.contentWindow||e.origin!==location.origin||e.data?.kind!=="maxis-player")return;
      if(e.data.state==="bridge-ready"){command("load",{source});lastVolume=-1;applyVolume();return;}
      if(e.data.state!=="loading"){clearTimeout(timeout);timeout=0;}
      if(typeof e.data.message==="string")status.textContent=e.data.message.slice(0,350)||source.provider.toUpperCase()+" · "+e.data.state;
    };
    const visible=()=>{if(document.hidden&&(source?.provider==="x"||source?.clip))stop("Post / clip stopped while this page was hidden.");applyVolume();};
    const fullChange=()=>{if(!document.fullscreenElement){const wasFull=filling;filling=false;root.classList.remove("maxis-fullscreen");if(wasFull)onOpen(isOpen);}};
    const keys=e=>{e.stopPropagation();if(e.type==="keydown"&&e.key==="Escape"){e.preventDefault();if(filling)fullOff();else close();}};
    root.addEventListener("click",click);root.addEventListener("keydown",keys);root.addEventListener("keyup",keys);form.addEventListener("submit",submit);search.addEventListener("input",list);volume.addEventListener("input",applyVolume);
    window.addEventListener("message",receive);document.addEventListener("visibilitychange",visible);document.addEventListener("fullscreenchange",fullChange);
    choose("home");
    const leave=()=>{active=false;stop();close();choose("home");search.value="";url.value="";root.hidden=true;};
    return {open,close,load,stop,fullscreen,enter:()=>{active=true;},leave,
      get isOpen(){return isOpen||filling;},get active(){return !!source;},
      setGain:(value,mute=false)=>{gain=Math.max(0,Math.min(1,value));muted=!!mute;applyVolume();},
      get stats(){return {active,provider:source?.provider||null,players:frame?1:0,open:isOpen,pending:timeout?1:0,disposed,category,gain,lastVolume};},
      dispose:()=>{if(disposed)return;leave();disposed=true;window.removeEventListener("message",receive);document.removeEventListener("visibilitychange",visible);document.removeEventListener("fullscreenchange",fullChange);root.removeEventListener("click",click);root.removeEventListener("keydown",keys);root.removeEventListener("keyup",keys);form.removeEventListener("submit",submit);search.removeEventListener("input",list);volume.removeEventListener("input",applyVolume);root.remove();}
    };
  };
  BL.maxisMedia={create};
})();
