// Bounded PODCONF homepage snapshot, checked 2026-10-04. See docs/big-bitcoin.md.
// Site titles/links are factual; the headquarters and its decorative screens are in-world satire.
(() => {
  "use strict";
  const home="https://podconf.xyz/";
  const cards=[
    {id:"launch",section:"overview",title:"PODCONF Announces the Launch of Big Bitcoin®",summary:"The BIG BITCOIN launch announcement linked from PODCONF's homepage.",url:home+"podconf-announces-the-launch-of-big-bitcoin/",type:"Announcement"},
    {id:"mission",section:"overview",title:"Mission and manifesto",summary:"PODCONF's public mission page. Read the site's own presentation at the official destination.",url:home+"podconf-mission-2-0-founding-the-new-american-empire/",type:"Official site"},
    {id:"news",section:"news",title:"Latest news",summary:"Browse the current PODCONF news index. This terminal does not poll for updates.",url:home+"news/",type:"News index"},
    {id:"domain",section:"news",title:"BIG BITCOIN® Announces Initiative to Secure Control of .bitcoin",summary:"An announcement listed in the homepage's Latest News area. Open the original for its complete claims and context.",url:home+"big-bitcoin-announces-initiative-to-secure-control-of-bitcoin/",type:"Announcement"},
    {id:"calculator",section:"news",title:"Request for Proposal – Bitcoin Retirement Calculator with COMPLIANCE TOKEN Access",summary:"A public request for proposal listed on PODCONF's homepage.",url:home+"request-for-proposal-bitcoin-retirement-calculator-with-compliance-token-access/",type:"Public post"},
    {id:"research",section:"research",title:"Research",summary:"PODCONF's public research section, linked in the site's main navigation.",url:home+"research/",type:"Research index"},
    {id:"gear",section:"research",title:"Ultimate Guide To Podcasting Gear",summary:"The podcasting equipment guide featured in the homepage's news list.",url:home+"ultimate-guide-to-podcasting-gear/",type:"Public guide"},
    {id:"shop",section:"merch",title:"Official PODCONF shop",summary:"The official site lists apparel and accessories. Product designs, prices, sizes and availability must be checked there.",url:home+"shop/",type:"Official shop"},
    {id:"shirt",section:"merch",title:"BIG BTC® Classic T-Shirt",summary:"A real product featured under Shop new arrivals. The room's block garments are display props, not exact product previews.",url:home+"product/big-btc-classic-t-shirt/",type:"Official product"},
    {id:"cap",section:"merch",title:"Red Team Flat Bill Cap",summary:"A real cap listed in the official homepage's new-arrivals selection.",url:home+"product/red-team-flat-bill-cap/",type:"Official product"},
    {id:"contact",section:"links",title:"Contact PODCONF",summary:"Contact the organization directly on its official site. No form or private information passes through this terminal.",url:home+"contact-us/",type:"External contact"},
    {id:"home",section:"links",title:"PODCONF homepage",summary:"Visit the current source for media, public programs, social links and announcements.",url:home,type:"Official site"}
  ];
  const allowed=new Set(cards.map(c=>c.url));
  const official=url=>allowed.has(url)?url:null;
  BL.bigBitcoinData={home,checked:"2026-10-04",cards,official,sections:[["overview","BIG BITCOIN"],["news","News"],["research","Research"],["merch","Merch"],["links","Official links"]]};
})();
