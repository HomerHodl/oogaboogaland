// Public WordPress page IDs are linked by hodlerhiq.net; content.rendered holds its audio playlist.
// Nothing from that HTML enters the live DOM. One media element and a visit-local, bounded cache.
(() => {
  "use strict";
  const BL=window.BL;
  const YEARS=[[2679,"Year five"],[1537,"Year four"],[1261,"Year three"],[1233,"Year two"],[2,"Year one"]];
  const parse=html=>{
    const page=new DOMParser().parseFromString(html,"text/html"),items=[],seen=new Set();
    for(const entry of page.querySelectorAll("[data-mediafile]")){
      const name=entry.querySelector(".player_song_name");let url;
      try{url=new URL(entry.getAttribute("data-mediafile"),"https://hodlerhiq.net/");}catch{continue;}
      if(url.origin!=="https://hodlerhiq.net"||!url.pathname.startsWith("/wp-content/uploads/")||!url.pathname.toLowerCase().endsWith(".mp3")||seen.has(url.href)||!name)continue;
      const title=name.textContent.trim().slice(0,240),date=name.getAttribute("data-albumname")||"";
      if(!title)continue;seen.add(url.href);items.push({title,date:/^\d{4}-\d{2}-\d{2}$/.test(date)?date:"",url:url.href});
      if(items.length===1000)break;
    }
    return items.sort((a,b)=>b.date.localeCompare(a.date)).slice(0,150);
  };
  const create=({onOpen:notify,onPlaying})=>{
    const onOpen=on=>{BL.dsbMenuShell.present(dialog,on);notify(on);};
    const dialog=document.createElement("dialog");dialog.className="dsb-spaces";dialog.setAttribute("aria-label","DSB Spaces archive");
    dialog.innerHTML='<header><div><small><a href="https://hodlerhiq.net/" target="_blank" rel="noopener noreferrer">HODLERHIQ ARCHIVE ↗</a></small><h2>DSB SPACES</h2></div><button type="button" data-close aria-label="Close archive">Close</button></header><div class="spaces-filters"><label>Archive <select aria-label="Archive year"></select></label><label>Search <input type="search" maxlength="100" placeholder="Find a Space"></label></div><p data-status role="status">Choose an archive.</p><div class="spaces-list" role="group" aria-label="Available Spaces"></div><section class="spaces-playing"><strong data-title>Nothing playing</strong><p data-date></p><p data-state aria-live="polite">Stopped</p><div class="spaces-controls"><button type="button" data-prev>Previous</button><button type="button" data-play>Play</button><button type="button" data-next>Next</button><button type="button" data-stop>Stop</button></div><label class="spaces-progress">Progress <input aria-label="Playback position" type="range" min="0" max="1000" value="0" disabled></label><output>0:00 / —</output></section>';
    document.body.appendChild(dialog);
    const q=s=>dialog.querySelector(s),select=q("select"),search=q('input[type="search"]'),list=q(".spaces-list"),status=q("[data-status]"),title=q("[data-title]"),date=q("[data-date]"),state=q("[data-state]"),play=q("[data-play]"),progress=q('input[type="range"]'),output=q("output");
    for(const [id,label] of YEARS){const option=document.createElement("option");option.value=id;option.textContent=label;select.appendChild(option);}
    let gain=0,muted=false,stopped=true,media=null,mediaEvents=null,active=false,disposed=false,controller=null,timer=0,epoch=0,items=[],queue=[],index=-1,current=null,returnFocus=null;
    const cache=new Map(),events=new AbortController();
    const time=n=>Number.isFinite(n)?`${Math.floor(n/60)}:${String(Math.floor(n%60)).padStart(2,"0")}`:"—";
    const sync=()=>{
      const playing=!!media&&!media.paused&&!media.ended;
      play.textContent=playing?"Pause":"Play";state.textContent=media?.error?"Audio unavailable. Try another Space or open the archive source.":playing?(media.readyState<3?"Buffering…":"Playing"):media?.ended?"Finished":current&&!stopped?"Paused":"Stopped";
      title.textContent=current?.title||"Nothing playing";date.textContent=current?.date||"";
      const duration=media?.duration;progress.disabled=!Number.isFinite(duration)||!duration;
      if(!progress.disabled)progress.value=String(Math.round(media.currentTime/duration*1000));else progress.value="0";
      output.textContent=`${time(media?.currentTime||0)} / ${time(duration)}`;onPlaying(playing);
    };
    const ensureMedia=()=>{
      if(media)return media;
      media=document.createElement("audio");media.preload="none";media.volume=gain;media.muted=muted||gain===0;mediaEvents=new AbortController();
      for(const type of ["play","pause","ended","error","loadedmetadata","timeupdate","durationchange","waiting","playing","canplay"])media.addEventListener(type,sync,{signal:mediaEvents.signal});
      return media;
    };
    const start=async()=>{
      if(!active||!current)return;stopped=false;const token=epoch;
      try{await ensureMedia().play();if(!active||token!==epoch)return;sync();}catch{if(active&&token===epoch)state.textContent="Playback could not start. Press Play to retry.";}
    };
    const choose=i=>{
      if(!active||i<0||i>=queue.length)return;
      epoch++;index=i;current=queue[i];const audio=ensureMedia();audio.pause();audio.src=current.url;sync();void start();
    };
    const render=()=>{
      list.replaceChildren();const filter=search.value.trim().toLowerCase(),filtered=items.filter(item=>(item.title+" "+item.date).toLowerCase().includes(filter));
      for(const item of filtered){const button=document.createElement("button");button.type="button";button.className="spaces-item";button.textContent=item.title+(item.date?` · ${item.date}`:"");button.dataset.index=String(items.indexOf(item));list.appendChild(button);}
      status.textContent=`${filtered.length} Spaces${items.length===150?" · showing up to 150 per archive":""}`;
    };
    const load=async()=>{
      controller?.abort();clearTimeout(timer);const id=Number(select.value);
      items=[];list.replaceChildren();status.textContent="Loading public archive…";
      if(cache.has(id)){items=cache.get(id);render();return;}
      const request=controller=new AbortController();timer=setTimeout(()=>request.abort(),15000);
      try{
        const response=await fetch(`https://hodlerhiq.net/index.php?rest_route=/wp/v2/pages/${id}&_fields=content`,{signal:request.signal,credentials:"omit"});
        if(!response.ok)throw new Error("Archive unavailable");
        const body=await response.text();if(body.length>3000000)throw new Error("Archive too large");
        const data=JSON.parse(body),found=parse(data.content?.rendered||"");if(!found.length)throw new Error("No public audio found");
        if(!active||request!==controller)return;cache.set(id,found);items=found;render();
      }catch{if(active&&request===controller)status.textContent="Archive could not load. Select an archive to retry, or use the source link below.";}
      finally{if(request===controller){clearTimeout(timer);controller=null;}}
    };
    const close=()=>{if(!dialog.open)return;dialog.close();onOpen(false);returnFocus?.focus();};
    const listen=(el,type,fn)=>el.addEventListener(type,fn,{signal:events.signal});
    listen(q("[data-close]"),"click",close);listen(dialog,"cancel",e=>{e.preventDefault();close();});
    listen(select,"change",()=>void load());listen(search,"input",render);
    listen(list,"click",e=>{const button=e.target.closest("[data-index]");if(!button)return;queue=items;choose(Number(button.dataset.index));});
    listen(play,"click",()=>{if(!current&&items.length){queue=items;choose(0);}else if(media&&!media.paused)media.pause();else void start();});
    listen(q("[data-prev]"),"click",()=>choose((index-1+queue.length)%queue.length));
    listen(q("[data-next]"),"click",()=>choose((index+1)%queue.length));
    listen(q("[data-stop]"),"click",()=>{stopped=true;epoch++;if(media){media.pause();media.currentTime=0;}sync();state.textContent="Stopped";});
    listen(progress,"change",()=>{if(media&&Number.isFinite(media.duration))media.currentTime=media.duration*Number(progress.value)/1000;});
    const leave=()=>{
      active=false;gain=0;stopped=true;epoch++;controller?.abort();controller=null;clearTimeout(timer);close();
      mediaEvents?.abort();mediaEvents=null;
      if(media){media.pause();media.removeAttribute("src");media.load();media=null;}
      cache.clear();items=[];queue=[];index=-1;current=null;list.replaceChildren();search.value="";onPlaying(false);
    };
    return {enter:()=>{if(!disposed)active=true;},leave,close,
      open:()=>{if(!active||disposed)return;returnFocus=document.activeElement;if(!dialog.open)dialog.showModal();onOpen(true);sync();if(!items.length&&!controller)void load();},
      get isOpen(){return dialog.open;},get playing(){return !!media&&!media.paused&&!media.ended;},
      setMuted:on=>{muted=!!on;if(media)media.muted=muted||gain===0;},
      setGain:value=>{gain=Math.max(0,Math.min(1,value));if(media){if(Math.abs(media.volume-gain)>.001)media.volume=gain;media.muted=muted||gain===0;}},
      get stats(){return {active,gain,muted:muted||gain===0,position:media?.currentTime||0,open:dialog.open,cached:cache.size,items:items.length,media:media?1:0,playing:!!media&&!media.paused,loading:!!controller,title:current?.title||""};},
      dispose:()=>{leave();disposed=true;events.abort();dialog.remove();}
    };
  };
  window.BL.dsbSpaces={create,parse,years:YEARS};
})();
