// Owner-editable sources, deliberately separate from player/UI logic. No API keys or ingest credentials.
(() => {
  "use strict";
  const BL=window.BL=window.BL||{};
  const picks=[
    {id:"yellow-live",title:"Live from Yellow",provider:"live",url:"",tags:["live","yellow"],description:"The broadcast is not configured yet."}
  ];
  // mode: "offline" | "direct" | "youtube" | "twitch". A WHIP ingest URL is NOT a playback URL.
  const live={mode:"offline",url:"",label:"LIVE FROM YELLOW"};
  const safeUrl=value=>{
    if(typeof value!=="string"||value.length>2048||/[\u0000-\u0020\u007f]/.test(value.trim()))throw new Error("Paste a complete HTTPS media URL.");
    const u=new URL(value.trim());
    if(u.protocol!=="https:"||u.username||u.password||u.port&&u.port!=="443")throw new Error("Use an HTTPS URL without credentials or a custom port.");
    if(!u.hostname.includes(".")||u.hostname.endsWith(".local")||u.hostname.endsWith(".localhost")||/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)||u.hostname.startsWith("["))throw new Error("Use a public media hostname.");
    u.hash="";return u;
  };
  const parse=(provider,value,liveConfig=live)=>{
    if(provider==="live"){
      if(liveConfig.mode==="offline"||!liveConfig.url)return {provider:"live",offline:true,title:"Live from Yellow is offline / not configured."};
      if(!["direct","youtube","twitch"].includes(liveConfig.mode))throw new Error("Live playback mode is not supported. Configure a public viewer URL.");
      return {...parse(liveConfig.mode,liveConfig.url),live:true};
    }
    const u=safeUrl(value),host=u.hostname.toLowerCase(),path=u.pathname.split("/").filter(Boolean);
    if(provider==="youtube"){
      if(!["youtube.com","www.youtube.com","m.youtube.com","youtu.be"].includes(host))throw new Error("Use a YouTube video or playlist URL.");
      const video=host==="youtu.be"?path[0]:["shorts","live","embed"].includes(path[0])?path[1]:u.searchParams.get("v"),list=u.searchParams.get("list");
      if(video&&!/^[A-Za-z0-9_-]{11}$/.test(video)||list&&!/^[A-Za-z0-9_-]{10,100}$/.test(list)||!video&&!list)throw new Error("That YouTube URL has no valid video or playlist ID.");
      return {provider,video:video||"",list:list||"",url:u.href};
    }
    if(provider==="twitch"){
      if(!["twitch.tv","www.twitch.tv","m.twitch.tv","clips.twitch.tv"].includes(host))throw new Error("Use a Twitch channel, VOD or clip URL.");
      const clip=host==="clips.twitch.tv"?path[0]:path[1]==="clip"?path[2]:"";
      if(clip&&/^[A-Za-z0-9_-]{1,120}$/.test(clip))return {provider,clip,url:u.href};
      if(path[0]==="videos"&&/^\d+$/.test(path[1]||""))return {provider,video:"v"+path[1],url:u.href};
      if(path.length===1&&/^[A-Za-z0-9_]{1,25}$/.test(path[0])&&!["directory","downloads","settings","videos"].includes(path[0]))return {provider,channel:path[0].toLowerCase(),url:u.href};
      throw new Error("That Twitch URL is not a channel, VOD or clip.");
    }
    if(provider==="x"){
      if(!["x.com","www.x.com","twitter.com","www.twitter.com","mobile.twitter.com"].includes(host))throw new Error("Use an X / Twitter post URL.");
      const at=path.indexOf("status"),id=at>=0?path[at+1]:"";
      if(!/^\d{1,25}$/.test(id))throw new Error("Paste an individual public post URL. Timeline playback is not enabled.");
      return {provider,id,url:"https://x.com/i/status/"+id};
    }
    if(provider==="direct"){
      const extension=u.pathname.split(".").pop().toLowerCase();
      if(!["mp4","webm","ogv","mp3","m4a","aac","wav","ogg","opus","m3u8"].includes(extension))throw new Error("Use a direct MP4, WebM, audio file or browser-supported .m3u8 URL.");
      return {provider,url:u.href,hls:extension==="m3u8"};
    }
    throw new Error("Choose a supported media provider.");
  };
  const search=(value,entries=picks)=>{const q=String(value).trim().toLowerCase();return entries.filter(e=>[e.title,e.description,...e.tags||[]].join(" ").toLowerCase().includes(q));};
  BL.maxisMediaData={picks,live,parse,safeUrl,search};
})();
