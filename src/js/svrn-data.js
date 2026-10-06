// Curated public navigation snapshot. No prices, inventory promises or runtime catalog requests.
(() => {
  "use strict";
  const origin="https://svrnsociety.com",page=(id,title,path)=>Object.freeze({id,title,url:origin+path});
  const pages=Object.freeze([
    page("home","Home","/"),page("new","New Arrivals","/"),
    page("apparel","Bitcoin Clothing","/collections/bitcoin-clothing"),page("shirts","Bitcoin Shirts","/collections/bitcoin-shirts"),
    page("hoodies","Hoodies & Crewnecks","/collections/bitcoin-hoodies"),page("women","Women","/collections/womens-bitcoin-clothing"),
    page("kids","Kids","/collections/bitcoin-kids-clothing"),page("swimwear","Swimwear","/collections/bitcoin-swimwear"),
    page("hats","Bitcoin Hats","/collections/bitcoin-hats"),page("merch","Bitcoin Merch","/collections/bitcoin-merch"),
    page("lookbook","Lookbook","/pages/bitcoin-fashion-lookbook"),page("collections","Collections","/pages/brand-collections"),
    page("svrn","SVRN Society Collection","/pages/brand-collections#SVRN-Society-Brand"),
    page("orange","The Orange Habit","/pages/brand-collections#The-Orange-Habit-Brand"),
    page("faith","Faith Apparel","/collections/christian-clothing"),page("about","About","/pages/about-us")
  ]);
  const collections=Object.freeze([
    page("1913","1913","/collections/1913-apparel"),page("1984","1984","/collections/1984-apparel"),
    page("captivated","Captivated","/collections/captivated-apparel"),page("faith","Faith Apparel","/collections/christian-clothing"),
    page("money","Fix The Money","/collections/fix-the-money"),page("tables","Flip The Tables","/collections/flip-the-tables"),
    page("moms","Moms Against Money Printing","/collections/moms-against-money-printing")
  ]);
  const products=Object.freeze([
    ["Embroidered 1913: Oversized Bitcoin T-Shirt","/products/oversized-bitcoin-shirt-1913","shirts"],
    ["Embroidered 1913: Oversized Bitcoin Hoodie","/products/1913-oversized-bitcoin-hoodie","hoodies"],
    ["1913: Slim Fit Racerback Tank","/products/1913-slim-fit-racerback-tank","women"],
    ["1913: Bitcoin Five Panel Cap","/products/1913-five-panel-cap","hats"],
    ["1913: Classic Rope Cap","/products/1913-classic-rope-cap","hats"],
    ["1984: 'Make Orwell Fiction Again' Dad Hat","/products/1984-distressed-dad-hat","hats"],
    ["Tax The Rich: Kids’ Bitcoin Tee","/products/fix-the-money-kids-t-shirt","kids"],
    ["Embroidered Satoshi Smiles: Kids' Bitcoin Hoodie","/products/satoshi-smiles-kids-bitcoin-hoodie","kids"]
  ].map(([title,path,category])=>Object.freeze({title,url:origin+path,category})));
  window.BL.svrnData=Object.freeze({origin,verified:"2026-10-05",pages,collections,products});
})();
