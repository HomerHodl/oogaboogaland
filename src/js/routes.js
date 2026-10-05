// Every address the site answers. The router reads it in the page; scripts/site.mjs reads it in Node to
// write each route its own page (title, description, canonical address, preview card cards/<image>.jpg),
// since search engines and link crawlers judge a page by the HTML at its address. `scene` is a scene id;
// `place` is a spot inside it (one of the hub's `navigate` views), reached as `ctx.place` on arrival. A
// route without an `image` shows home's card until it has one.
// The first entry is home, the bare address.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  BL.routes = {
    site: "https://oogabooga.land",
    name: "Ooga Booga Land",
    // The tab, search and card title: a route leads with its own name, home with the site's.
    title(entry) {
      return entry.path ? `${entry.title} · ${this.name}` : `${this.name} · ${entry.title}`;
    },
    list: [
      { path: "", scene: "hub", image: "home", title: "an island of caves where bananas feed EntropyLab contributors",
        description: "A floating island of caves where donated bananas feed the voxel cavemen of OogaBoogaX. Race, skydive, mine and fly, under weather from the live Bitcoin mempool." },
      { path: "oogarally", scene: "race", image: "oogarally", title: "Ooga Rally",
        description: "Kart racing round a floating island. Three tracks, three laps: podium on all of them and take the Cup." },
      { path: "oogadrop", scene: "drop", image: "oogadrop", title: "Ooga Drop",
        description: "Jump from the plane, fall through every hoop and land on the banana pile." },
      { path: "oogaorbit", scene: "orbit", image: "oogaorbit", title: "Ooga Orbit",
        description: "Lash a rocket together, reach the Sky Top, touch the space rock and fall home shield first." },
      { path: "oogamine", scene: "mine", image: "oogamine", title: "Ooga Mine",
        description: "A mining tycoon about margin: power, heat and the halving. Mine 21 coin in an hour without going broke." },
      { path: "mempool", scene: "hub", place: "mempool", image: "mempool", title: "Mempool chamber",
        description: "The live Bitcoin mempool as a rainforest lake: the backlog fills it, new blocks fall from it, and the chamber under it reads the chain out in paint." },
      { path: "dsb", scene: "dsb", title: "DSB Land",
        description: "Walk through ₿IFRÖST to DSB Land: a river boat, the Bitcoin coaster riding the live price, the Meme Shop and NodeRunner TV." },
      { path: "entropylab", scene: "hub", place: "lab", image: "entropylab", title: "EntropyLab",
        description: "The EntropyLab cave, where donated bananas feed the voxel cavemen who stand for its contributors." },
      { path: "lightning", scene: "factory", image: "lightning", title: "Lightning Factory",
        description: "A Lightning node at work as a factory in a tiered cavern, run by gorillas in hard hats: forwards ride the conduits through the glowing core." },
      { path: "oogaarcade", scene: "arcade", title: "Ooga Arcade",
        description: "A torchlit cave of arcade cabinets, one for every Ooga game: walk up to Ooga Rally, Drop, Orbit or Mine and play." },
      { path: "sphere", scene: "hub", place: "timechain", image: "sphere", title: "Timechain Sphere",
        description: "Sani's walk-in sphere, its six inner walls lit with live Timechain Index data: BTC distribution, balances, UTXO sizes, ETF and exchange holdings." }
    ]
  };
})();
