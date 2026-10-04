// Local, bounded catalog. No fetch, customer storage, account, cart, analytics or checkout.
(() => {
  "use strict";
  const BL=window.BL,D=BL.withoutRulersData;
  const create=({onOpen=()=>{}}={})=>{
    const root=document.getElementById("rulers-catalog"),one=s=>root.querySelector(s),nav=one("nav"),results=one(".rulers-results"),heading=one(".rulers-heading"),search=one("input"),searchWrap=one(".rulers-search"),status=one(".rulers-status"),back=one('[data-wr="back"]');
    let active=false,opened=false,disposed=false,section="home",collection="",selected=null,previous=null;
    const el=(tag,text,className)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(className)n.className=className;return n;};
    const button=(text,action,value)=>{const b=el("button",text);b.type="button";b.dataset.wr=action;if(value)b.dataset.value=value;return b;};
    const link=(text,url)=>{const a=el("a",text,"rulers-official"),safe=D.official(url);if(!safe)throw new Error("Unapproved Without Rulers destination");a.href=safe;a.target="_blank";a.rel="noopener noreferrer";a.referrerPolicy="no-referrer";a.setAttribute("aria-label",text+" (opens official site in a new tab)");return a;};
    const picture=p=>{const img=el("img");img.src=p.image;img.alt=p.title;img.loading="lazy";img.decoding="async";img.width=320;img.height=320;return img;};
    const price=p=>(p.priceVaries?"From ":"")+"$"+p.price.toFixed(2)+" USD";
    const render=()=>{
      results.replaceChildren();back.hidden=!selected&&!collection;searchWrap.hidden=section==="about"||(section==="collections"&&!collection);search.placeholder=collection?"Filter this collection":"Search this curated catalog";
      for(const b of nav.children)b.setAttribute("aria-pressed",String(b.dataset.value===section));
      if(selected){
        const p=D.products.find(p=>p.id===selected),c=D.collections.find(c=>c.id===p.collection),detail=el("article",null,"rulers-detail");heading.textContent="Product preview";
        detail.appendChild(picture(p));const body=el("div");body.appendChild(el("h3",p.title));body.appendChild(el("p",price(p),"rulers-price"));body.appendChild(el("p",c.title+" · "+D.categories.find(c=>c.id===p.category).label));body.appendChild(el("p","Official catalog preview. Sizes, variants, stock and current pricing are available on the official product page."));body.appendChild(link("Buy on Official Site ↗",p.url));detail.appendChild(body);results.appendChild(detail);status.textContent="Preview only. No purchase or customer information is collected here.";return;
      }
      if(section==="about"){
        heading.textContent="Art · Apparel · Ideas";const about=el("article",null,"rulers-about");about.appendChild(el("h3","Without Rulers"));about.appendChild(el("p","A showroom for Bitcoin, privacy and sovereignty themes. Explore a curated selection from the public Without Rulers catalog, then visit the official store for current products and purchases."));about.appendChild(el("p","Contact: info@without-rulers.com"));about.appendChild(link("Open on without-rulers.com ↗",D.home));results.appendChild(about);status.textContent="This room has no account, cart, payment or address fields.";return;
      }
      if(section==="collections"&&!collection){
        heading.textContent="Featured collections";
        for(const c of D.collections){const card=el("article",null,"rulers-collection");const p=D.products.find(p=>p.collection===c.id);card.appendChild(picture(p));card.appendChild(el("h3",c.title));card.appendChild(el("p",c.summary));card.appendChild(button("Browse collection","collection",c.id));card.appendChild(link("Official collection ↗",c.url));results.appendChild(card);}
        status.textContent="Five themes · collection names and links verified against the official store.";return;
      }
      const category=D.categories.find(c=>c.id===section),c=D.collections.find(c=>c.id===collection);
      heading.textContent=c?c.title:category?category.label:section==="search"?"Search the catalog":"Featured apparel & art";
      if(section==="home"&&!search.value){const intro=el("div",null,"rulers-themes");for(const c of D.collections)intro.appendChild(button(c.title,"collection",c.id));results.appendChild(intro);}
      const found=D.filter(section,search.value,collection);
      for(const p of found){const card=el("article",null,"rulers-card");card.appendChild(picture(p));card.appendChild(el("h3",p.title));card.appendChild(el("p",price(p),"rulers-price"));card.appendChild(button("View details","product",p.id));results.appendChild(card);}
      if(!found.length)results.appendChild(el("p","No matching items in this curated selection. Try another term, or browse the full official catalog."));
      if(category||c)results.appendChild(link("Browse full official collection ↗",(c||category).url));
      status.textContent=found.length+" curated items · prices checked "+D.checked+". Confirm current price and availability on the official site.";
    };
    const choose=(next="home",id="")=>{if(!["home","collections","search","about",...D.categories.map(c=>c.id)].includes(next))return;section=next;collection=id;selected=null;search.value="";render();if(section==="search")search.focus();};
    const open=()=>{
      if(!active||disposed)return false;if(opened)return true;
      previous=document.activeElement;root.hidden=false;opened=true;
      if(!nav.children.length)for(const [id,title] of [["home","Home / Featured"],...D.categories.map(c=>[c.id,c.label]),["collections","Collections"],["search","Search"],["about","About / Contact"]])nav.appendChild(button(title,"section",id));
      render();onOpen(true);one('[data-wr="close"]').focus();return true;
    };
    const close=()=>{if(!opened)return;root.hidden=true;opened=false;onOpen(false);if(previous?.isConnected)previous.focus();previous=null;};
    const leave=()=>{active=false;close();section="home";collection="";selected=null;search.value="";results.replaceChildren();nav.replaceChildren();status.textContent="";previous=null;};
    const click=e=>{const b=e.target.closest("button");if(!b||!root.contains(b))return;const action=b.dataset.wr,value=b.dataset.value;
      if(action==="close")close();else if(action==="section")choose(value);else if(action==="collection")choose("collections",value);else if(action==="product"){selected=value;render();back.focus();}else if(action==="back"){if(selected){selected=null;render();}else choose("collections");}if(action!=="product"&&value!=="search")b.blur();
    };
    const filter=()=>{selected=null;render();};
    const keys=e=>{e.stopPropagation();if(e.type!=="keydown")return;if(e.key==="Escape"){e.preventDefault();close();}else if(e.key==="Tab"){
      const items=Array.from(root.querySelectorAll("button, input, a[href]")).filter(n=>!n.hidden&&!n.closest("[hidden]")),i=items.indexOf(document.activeElement);
      if(e.shiftKey&&i<=0){e.preventDefault();items[items.length-1]?.focus();}else if(!e.shiftKey&&i===items.length-1){e.preventDefault();items[0]?.focus();}
    }};
    const outside=e=>{if(opened&&!root.contains(e.target)&&!e.target.closest(".rulers-tools"))close();};
    root.addEventListener("click",click);root.addEventListener("keydown",keys);root.addEventListener("keyup",keys);search.addEventListener("input",filter);document.addEventListener("pointerdown",outside);
    return {enter:()=>{if(!disposed)active=true;},open,close,leave,choose,
      get isOpen(){return opened;},get stats(){return {active,opened,disposed,products:D.products.length,panels:1};},
      dispose:()=>{if(disposed)return;leave();disposed=true;root.removeEventListener("click",click);root.removeEventListener("keydown",keys);root.removeEventListener("keyup",keys);search.removeEventListener("input",filter);document.removeEventListener("pointerdown",outside);}
    };
  };
  BL.withoutRulersMenu={create};
})();
