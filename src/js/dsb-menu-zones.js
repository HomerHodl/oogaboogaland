// Semantic bounds follow existing fixtures. No geometry, services or invented catalog routes.
(() => {
  "use strict";
  const zone=(route,label,x,z,rx,rz,priority=2)=>({route,label,x,z,rx,rz,priority});
  const home=(route,label)=>({route,label,priority:0});
  const fallbacks={"svrn-society":home("home","Browse SVRN Society"),"meme-factory":home("home","Explore Meme Factory"),"without-rulers":home("home","Browse Without Rulers"),"proof-of-ink":home("featured","Browse Proof of Ink"),"big-bitcoin":home("overview","BIG BITCOIN Info"),"maxis-club":home("home","Open MAXIS MEDIA")};
  const zones={
    "without-rulers":[
      zone("shirts","Browse Shirts",-5.3,1.5,2.5,1.3),zone("hoodies","Browse Hoodies",5.3,1.5,2.5,1.3),
      zone("hats","Browse Hats",9.4,-.85,1.5,2.2),zone("art","View Art Prints",8.1,6,1.9,3.7),
      zone("bip85","Explore BIP-85",-9.5,-7.8,1.8,2,3),zone("samourai","Explore #FreeSamourai",-9.5,-2.5,1.8,2,3),
      zone("slavery","Bitcoin or Slavery",-7.25,-8.8,2.1,1.6,3),zone("cartel","Banking Cartel",7.25,-8.8,2.1,1.6,3),zone("2140","Explore 2140",9.4,-6.8,1.8,2,3)
    ],
    "proof-of-ink":[
      zone("apparel","Browse Apparel",-3.55,-1.2,2.3,6),zone("shirts","Browse Shirts",-11.1,-8,1.8,2.1),
      zone("hats","Browse Hats",2.75,3.6,1.8,1),zone("fine-arts","View Fine Arts",-10.6,1,2.7,5.5),
      zone("collabs","Explore Collabs",8,-10.1,2.8,1.4),zone("stackchain-magazine","Read Stackchain Magazine",-9,8.8,3.4,3.4,3),
      zone("proof-of-work","Explore Proof Of Work",9.5,-1,3.4,9)
    ],
    "big-bitcoin":[zone("news","Open News",14.2,-17,6.6,8.6),zone("research","Open Research",14.2,0,6.6,7.7),zone("merch","Browse Merch",-14.2,17,6.6,8.6)],
    // Neither the posters nor the bar are provider stations.
    "maxis-club":[zone("home","Open MAXIS MEDIA",7.4,-10.4,2,2),zone("home","Open MAXIS MEDIA",0,-10.7,7,2)]
  };
  const forRoom=room=>room.menuZones||zones[room.id]||[];
  const resolve=(room,p)=>{
    let best=fallbacks[room.id]||home("home","Open menu"),distance=Infinity;
    for(const z of room.menuZones||forRoom(room)){
      const dx=Math.abs(p.x-z.x),dz=Math.abs(p.z-z.z);if(dx>z.rx||dz>z.rz)continue;
      const d=dx*dx+dz*dz;if(z.priority>best.priority||z.priority===best.priority&&d<distance){best=z;distance=d;}
    }
    return best;
  };
  window.BL.dsbMenuZones={zone,forRoom,resolve,fallbacks};
})();
