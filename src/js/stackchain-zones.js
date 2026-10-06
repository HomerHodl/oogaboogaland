// Semantic destinations follow existing official pages, not decorative room names.
(() => {
  "use strict";
  const Z=window.BL.dsbMenuZones;
  Z.fallbacks["stackchain-magazine"]={route:"home",label:"Explore Stackchain",priority:0};
  window.BL.stackchainZones={create:()=>[
    Z.zone("home","Explore Stackchain",0,14,16,6,1),
    Z.zone("articles","Read Stackchain Articles",-12,-5,4,10),
    Z.zone("articles","Read Stackchain Articles",-10,8,5.5,5),
    Z.zone("articles","Read the Magazine Archive",10,-13,5.5,5),
    Z.zone("articles","Meet Stackchain Authors",0,-14,5.5,4),
    Z.zone("pleb-losophy","Explore Pleb-losophy",12,10,3.5,4),
    Z.zone("submissions","Submit to Stackchain",5,2,1.8,2.4,3),
    Z.zone("newsletter","Stackchain Newsletter",10,2,1.8,2.4,3),
    Z.zone("donations","Support Stackchain",-6,15,1.65,1.8,3),
    Z.zone("contact","Contact Stackchain",6,15,1.65,1.8,3),
    Z.zone("physical-copies","Browse Physical Copies",12,-4.5,3.5,3.5,3)
  ]};
})();
