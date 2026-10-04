// Browse-only, visit-local catalog: one panel, no network, forms, storage or customer state.
(() => {
  "use strict";
  const BL=window.BL,D=BL.proofOfInkData;
  const sections=[["featured","Featured"],["apparel","Apparel"],["objects","Art & Objects"],["collections","Collections"],["studio","Studio & Stories"],["search","Search"]];
  const create=({onOpen:notify=()=>{}}={})=>{
    const onOpen=on=>{BL.dsbMenuShell.present(root,on);notify(on);};
    const root=document.getElementById("ink-catalog"),one=s=>root.querySelector(s),nav=one("nav"),results=one(".ink-results"),heading=one(".ink-heading"),search=one("input"),filters=one(".ink-filters"),status=one(".ink-status"),back=one('[data-ink="back"]');
    let active=false,opened=false,disposed=false,section="featured",tag="",selected=null,previous=null;
    const el=(type,text,cls)=>{const n=document.createElement(type);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
    const button=(title,action,value)=>{const n=el("button",title);n.type="button";n.dataset.ink=action;if(value)n.dataset.value=value;return n;};
    const link=(title,url)=>{const safe=D.official(url);if(!safe)throw Error("Unapproved Proof of Ink destination");const a=el("a",title,"ink-official");a.href=safe;a.target="_blank";a.rel="noopener noreferrer";a.referrerPolicy="no-referrer";a.setAttribute("aria-label",title+" (opens official site in a new tab)");return a;};
    const picture=p=>{const n=el("img");n.src=p.image;n.alt=p.title;n.loading="lazy";n.decoding="async";n.width=n.height=320;return n;};
    const price=p=>(p.priceVaries?"From ":"")+"$"+p.price.toFixed(2)+" "+p.currency;
    const contentCard=c=>{
      const card=el("article",null,"ink-card ink-story"),preview=D.products.find(p=>p.id===c.preview);
      if(preview)card.appendChild(picture(preview));else card.appendChild(el("div","PRINT / CREATE / SHARE","ink-process"));
      card.appendChild(el("p",c.kind==="service"?"THE STUDIO":c.kind==="editorial"?"READ & DISCOVER":"COLLECTION","ink-eyebrow"));card.appendChild(el("h3",c.title));card.appendChild(el("p",c.summary));
      if(c.kind!=="service")card.appendChild(button("Browse selection","filter",c.id));
      card.appendChild(link(c.kind==="service"?"Contact / services on official site ↗":c.kind==="editorial"?"Read on Official Site ↗":"View on Proof of Ink ↗",c.url));return card;
    };
    const render=()=>{
      results.replaceChildren();filters.replaceChildren();back.hidden=!selected&&!tag;
      for(const b of nav.children)b.setAttribute("aria-pressed",String(b.dataset.value===section));
      if(selected){
        const p=D.products.find(p=>p.id===selected);if(!p){selected=null;return render();}
        heading.textContent="Catalog preview";const card=el("article",null,"ink-detail"),body=el("div");card.appendChild(picture(p));body.appendChild(el("p",D.categories.find(c=>c.id===p.category).title,"ink-eyebrow"));body.appendChild(el("h3",p.title));body.appendChild(el("p",price(p),"ink-price"));body.appendChild(el("p",p.summary));body.appendChild(el("p","Snapshot checked "+D.checked+". Confirm current price, variants, stock and delivery on the official product page."));body.appendChild(link("Buy on Official Site ↗",p.url));card.appendChild(body);results.appendChild(card);status.textContent="Browse here. Purchase on ProofOfInk.com. No customer data stored in OogaBoogaLand.";return;
      }
      const chosen=[...D.categories,...D.collections].find(c=>c.id===tag);
      heading.textContent=chosen?.title||sections.find(s=>s[0]===section)[1];
      if(section==="apparel"||section==="objects")for(const c of [{id:"",title:"All"},...D.categories.filter(c=>c.group===section)]){const b=button(c.title,"filter",c.id);b.setAttribute("aria-pressed",String(tag===c.id));filters.appendChild(b);}
      const query=search.value.trim().toLowerCase();
      if(!tag&&["featured","collections","studio","search"].includes(section)){
        for(const c of D.collections.filter(c=>(section!=="studio"||c.kind!=="collection")&&(!query||(c.title+" "+c.summary).toLowerCase().includes(query))))results.appendChild(contentCard(c));
        if(section==="studio"){const about=el("article",null,"ink-about");about.appendChild(el("h3","Art, production and community"));about.appendChild(el("p","Proof of Ink works with Bitcoin artists and businesses to produce prints and merchandise. The official site handles collaboration and production inquiries."));about.appendChild(link("Contact Proof of Ink ↗",D.collections.find(c=>c.id==="proof-of-work").url));about.appendChild(link("Wholesale on Official Site ↗",D.wholesale));results.appendChild(about);}
      }
      if(chosen?.kind==="service"||chosen?.kind==="editorial")results.appendChild(contentCard(chosen));
      if(chosen?.kind!=="service"&&(tag||!["collections","studio"].includes(section))){
        let found=D.filter(section,query,tag);if(section==="featured"&&!query&&!tag)found=found.slice(0,6);
        for(const p of found){const card=el("article",null,"ink-card");card.appendChild(picture(p));card.appendChild(el("p",D.categories.find(c=>c.id===p.category).title,"ink-eyebrow"));card.appendChild(el("h3",p.title));card.appendChild(el("p",price(p),"ink-price"));card.appendChild(button("View details","product",p.id));results.appendChild(card);}
        if(!found.length)results.appendChild(el("p",tag==="tanks"?"Tanks appears in the official navigation, but no tank products were verified in this snapshot. Browse the official store for its current selection.":"No matching items in this curated selection. Try another term or browse the full official catalog.","ink-empty"));
      }
      if(chosen)results.appendChild(link("Browse full selection on official site ↗",chosen.url));
      status.textContent=D.products.length+" curated product previews · checked "+D.checked+" · confirm current prices and availability on the official site.";
    };
    const choose=(next="featured",value="")=>{if(!sections.some(s=>s[0]===next)||value&&![...D.categories,...D.collections].some(c=>c.id===value))return;section=next;tag=value;selected=null;search.value="";render();if(section==="search")search.focus();};
    const open=(route="featured")=>{if(!active||disposed)return false;if(opened)return true;previous=document.activeElement;opened=true;root.hidden=false;if(!nav.children.length)for(const [id,title] of sections)nav.appendChild(button(title,"section",id));const c=D.collections.find(c=>c.id===route),category=D.categories.find(c=>c.id===route);choose(c?"collections":category?category.group:sections.some(s=>s[0]===route)?route:"featured",c?.id||category?.id||"");onOpen(true);one('[data-ink="close"]').focus();return true;};
    const close=()=>{if(!opened)return;root.hidden=true;opened=false;onOpen(false);if(previous?.isConnected)previous.focus();previous=null;};
    const leave=()=>{active=false;close();section="featured";tag="";selected=null;search.value="";results.replaceChildren();filters.replaceChildren();nav.replaceChildren();status.textContent="";previous=null;};
    const click=e=>{const b=e.target.closest("button");if(!b||!root.contains(b))return;const a=b.dataset.ink,v=b.dataset.value||"";
      if(a==="close")close();else if(a==="section")choose(v);else if(a==="filter")choose(D.collections.some(c=>c.id===v)?"collections":section,v);else if(a==="product"&&D.products.some(p=>p.id===v)){selected=v;render();back.focus();}else if(a==="back"){if(selected){selected=null;render();}else choose(section);}
    };
    const filter=()=>{selected=null;render();};
    const keys=e=>{e.stopPropagation();if(e.type!=="keydown")return;if(e.key==="Escape"){e.preventDefault();close();}else if(e.key==="Tab"){const items=Array.from(root.querySelectorAll("button, input, a[href]")).filter(n=>!n.hidden&&!n.closest("[hidden]")),i=items.indexOf(document.activeElement);if(e.shiftKey&&i<=0){e.preventDefault();items[items.length-1]?.focus();}else if(!e.shiftKey&&i===items.length-1){e.preventDefault();items[0]?.focus();}}};
    const outside=e=>{if(opened&&!root.contains(e.target)&&!e.target.closest(".ink-tools"))close();};
    root.addEventListener("click",click);root.addEventListener("keydown",keys);root.addEventListener("keyup",keys);search.addEventListener("input",filter);document.addEventListener("pointerdown",outside);
    return {enter:()=>{if(!disposed)active=true;},open,close,leave,choose,get isOpen(){return opened;},get stats(){return {active,opened,disposed,section,tag,panels:1};},dispose:()=>{if(disposed)return;leave();disposed=true;root.removeEventListener("click",click);root.removeEventListener("keydown",keys);root.removeEventListener("keyup",keys);search.removeEventListener("input",filter);document.removeEventListener("pointerdown",outside);}};
  };
  BL.proofOfInkMenu={create};
})();
