// This document owns exactly one provider. Removing its parent iframe destroys SDK timers/listeners too.
(() => {
  "use strict";
  const mount=document.getElementById("player"),status=document.getElementById("status"),origin=location.origin;
  let started=false,dead=false,player=null,volume=.8,provider="",ready=false;
  const send=(state,message="")=>{status.textContent=message;if(!dead)parent.postMessage({kind:"maxis-player",state,message},origin);};
  const script=(src,loaded)=>{const s=document.createElement("script");s.src=src;s.onload=loaded;s.onerror=()=>send("error","Provider unavailable. Try again or open the original link.");document.head.appendChild(s);};
  const gain=()=>{
    if(!ready||!player)return;
    if(provider==="youtube")player.setVolume(Math.round(volume*100));
    if(provider==="twitch")player.setVolume(volume);
    if(provider==="direct"){player.volume=volume;player.muted=volume===0;}
  };
  const start=raw=>{
    if(started||dead)return;started=true;
    let source;
    try{source=window.BL.maxisMediaData.parse(raw.provider,raw.url);}catch(e){send("error",e.message);return;}
    provider=source.provider;mount.dataset.provider=provider;
    send("loading","Loading "+provider.toUpperCase()+". Press the provider's Play control when it appears.");
    if(provider==="youtube"){
      window.onYouTubeIframeAPIReady=()=>{
        if(dead)return;
        const slot=document.createElement("div");mount.appendChild(slot);
        const vars={playsinline:1,autoplay:0,origin,rel:0};if(source.list){vars.listType="playlist";vars.list=source.list;}
        player=new window.YT.Player(slot,{width:"100%",height:"100%",videoId:source.video||undefined,playerVars:vars,events:{
          onReady:()=>{ready=true;gain();send("ready","YouTube · use the player controls to play / pause.");},
          onStateChange:e=>{if(e.data===1)send("playing");else if(e.data===2)send("paused");},
          onError:e=>send("error",e.data===153?"YouTube needs the deployed HTTPS page and a permitted referrer (error 153).":"YouTube cannot embed this item ("+e.data+"). It may be private, restricted or unavailable.")
        }});
      };
      script("https://www.youtube.com/iframe_api",()=>{});
    }else if(provider==="twitch"&&source.clip){
      const f=document.createElement("iframe");f.title="Twitch clip";f.allow="autoplay; fullscreen";f.allowFullscreen=true;
      f.src="https://clips.twitch.tv/embed?clip="+encodeURIComponent(source.clip)+"&parent="+encodeURIComponent(location.hostname)+"&autoplay=false";mount.appendChild(f);
      send("ready","Twitch clip · provider controls only. Clip audio cannot be distance-adjusted; returning to the club stops it.");
    }else if(provider==="twitch"){
      script("https://player.twitch.tv/js/embed/v1.js",()=>{
        if(dead)return;
        const slot=document.createElement("div");slot.id="twitch-slot";mount.appendChild(slot);
        player=new window.Twitch.Player(slot.id,{width:"100%",height:"100%",parent:[location.hostname],autoplay:false,...source.channel?{channel:source.channel}:{video:source.video}});
        player.addEventListener(window.Twitch.Player.READY,()=>{ready=true;gain();send("ready","Twitch · press Play in the player.");});
        player.addEventListener(window.Twitch.Player.PLAYING,()=>send("playing"));
        player.addEventListener(window.Twitch.Player.PAUSE,()=>send("paused"));
        player.addEventListener(window.Twitch.Player.OFFLINE,()=>send("offline","This Twitch channel is offline."));
        player.addEventListener(window.Twitch.Player.PLAYBACK_BLOCKED,()=>send("ready","Your browser needs a tap on the Twitch Play control."));
      });
    }else if(provider==="x"){
      script("https://platform.twitter.com/widgets.js",()=>{
        if(dead)return;
        window.twttr.ready(()=>{if(dead)return;window.twttr.widgets.createTweet(source.id,mount,{theme:"dark",dnt:true,conversation:"none",align:"center"}).then(node=>{
          if(dead)return;send(node?"ready":"error",node?"X post · playback depends on X. Returning to the club closes this post; X exposes no volume / pause API.":"X could not embed this post. It may be private, removed, restricted or blocked by the provider.");
        }).catch(()=>send("error","X embedding is unavailable. Use the original post link."));});
      });
    }else if(provider==="direct"){
      player=document.createElement("video");player.controls=true;player.playsInline=true;player.preload="metadata";player.disablePictureInPicture=true;player.disableRemotePlayback=true;
      if(source.hls&&!player.canPlayType("application/vnd.apple.mpegurl")){send("error","This browser does not support native HLS. Use MP4 / WebM or a supported provider.");player=null;return;}
      player.addEventListener("error",()=>send("error","The media server, codec or URL is not supported by this browser."));
      player.addEventListener("playing",()=>send("playing"));player.addEventListener("pause",()=>send("paused"));
      player.addEventListener("loadedmetadata",()=>send("ready","Direct media · press Play. Fullscreen uses this same player."));
      ready=true;gain();player.src=source.url;mount.appendChild(player);
    }
  };
  const receive=e=>{
    if(e.source!==parent||e.origin!==origin||e.data?.kind!=="maxis-command")return;
    if(e.data.action==="load")start(e.data.source);
    if(e.data.action==="volume"&&Number.isFinite(e.data.value)){volume=Math.max(0,Math.min(1,e.data.value));gain();}
    if(e.data.action==="pause"&&ready){if(provider==="youtube")player.pauseVideo();else player?.pause();}
  };
  window.addEventListener("message",receive);
  window.addEventListener("pagehide",()=>{dead=true;window.removeEventListener("message",receive);if(provider==="direct"&&player){player.pause();player.removeAttribute("src");player.load();}else if(provider==="youtube")player?.destroy();else if(provider==="twitch")player?.pause();},{once:true});
  send("bridge-ready");
})();
