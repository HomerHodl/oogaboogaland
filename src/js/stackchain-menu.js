// Browse-only publication menu; the shared shell owns viewport, focus and gameplay isolation.
(() => {
  "use strict";
  const BL=window.BL,D=BL.stackchainData;
  const create=({onOpen=()=>{}}={})=>{
    let root=null,body=null,nav=null,results=null,active=false,disposed=false,route="home",query="";
    const valid=new Set(D.pages.map(p=>p.id));
    const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
    const link=(title,url)=>{const n=el("a",title);n.href=url;n.target="_blank";n.rel="noopener noreferrer";n.referrerPolicy="no-referrer";return n;};
    const picture=(id,title)=>{const n=el("img");n.src=BL.stackchainArt[id].image;n.alt=title;n.width=240;n.height=180;n.loading="lazy";return n;};
    const button=(title,id)=>{const b=el("button",title);b.type="button";b.dataset.route=id;return b;};
    const articles=()=>{
      results.replaceChildren();const found=D.articles.filter(a=>[a.title,a.author,a.summary].join(" ").toLowerCase().includes(query.trim().toLowerCase()));
      results.append(el("p",found.length+" of "+D.articles.length+" selected articles","stackchain-count"));
      for(const a of found){const card=el("article",null,"stackchain-card");card.append(picture(a.art,a.title),el("h3",a.title),el("p",a.author+" · "+a.date,"stackchain-meta"),el("p",a.summary),link("Read on StackchainMagazine.net ↗",a.url));results.append(card);}
      if(!found.length)results.append(el("p","No matching articles. Try a different title, author or topic."));
    };
    const render=()=>{
      body.replaceChildren();body.scrollTop=0;results=null;
      for(const b of nav.children)b.setAttribute("aria-pressed",String(b.dataset.route===route));
      const page=D.pages.find(p=>p.id===route);body.append(el("h3",page.title),el("p",page.summary));
      if(route==="home"){
        body.append(el("p","BY PLEBS FOR PLEBS","stackchain-motto"));
        const grid=el("div",null,"stackchain-grid");
        for(const a of D.articles.slice(0,3)){const card=el("article",null,"stackchain-card");card.append(picture(a.art,a.title),el("h3",a.title),el("p",a.author+" · "+a.date,"stackchain-meta"),link("Read on StackchainMagazine.net ↗",a.url));grid.append(card);}
        body.append(grid,button("Explore articles","articles"),button("Browse physical copies","physical-copies"),link("Visit Stackchain Magazine ↗",page.url));
      }else if(route==="articles"){
        const label=el("label","Search titles, authors and topics"),search=el("input");search.type="search";search.placeholder="Search six selected articles";search.autocomplete="off";search.maxLength=120;search.value=query;search.dataset.search="";label.append(search);
        results=el("div",null,"stackchain-grid");body.append(label,results);articles();body.append(link("All articles on StackchainMagazine.net ↗",page.url));
      }else if(route==="physical-copies"){
        body.append(el("p","Prices and availability were displayed on "+D.verified+". Confirm current details on the official store. This selection contains only products listed in its Stackchain Magazine section.","stackchain-meta"));
        const grid=el("div",null,"stackchain-grid");
        for(const p of D.products){const card=el("article",null,"stackchain-card stackchain-product");card.append(picture(p.art,p.title),el("h3",p.title),el("p",p.price+" · "+p.status,"stackchain-price"),link(p.status==="Out of stock"?"View on Official Site ↗":"Buy on Official Site ↗",p.url));grid.append(card);}
        body.append(grid,link("Official Stackchain Magazine section ↗",D.shopSource));
      }else{
        if(route==="pleb-losophy")body.append(el("p","The publication’s mission centres on everyday Bitcoin voices, reporting their stories and encouraging readers to take part."));
        if(["submissions","newsletter","donations","contact"].includes(route))body.append(el("p","Continue on the official Stackchain page to take part. No text, contact details or payments are collected here."));
        body.append(link("Open official "+page.title+" page ↗",page.url));
      }
      body.append(el("small","Public selection verified "+D.verified+" · Summaries, not full articles.","stackchain-stamp"));
    };
    const close=()=>{if(!root?.open)return;root.close();BL.dsbMenuShell.present(root,false);onOpen(false);};
    const click=e=>{const b=e.target.closest("button");if(!b)return;if(b.dataset.route){route=valid.has(b.dataset.route)?b.dataset.route:"home";render();}else if(b.dataset.close!==undefined)close();};
    const input=e=>{if(e.target.dataset.search!==undefined){query=e.target.value.slice(0,120);articles();}};
    const keys=e=>{e.stopPropagation();if(e.type==="keydown"&&e.key==="Escape"){e.preventDefault();close();}};
    const cancel=e=>{e.preventDefault();close();};
    const ensure=()=>{
      if(root)return;root=el("dialog",null,"stackchain-menu");root.setAttribute("aria-label","Stackchain Magazine");
      const header=el("header"),title=el("div"),closeButton=el("button","Return to Magazine");closeButton.type="button";closeButton.dataset.close="";
      title.append(el("small","INDEPENDENT BITCOIN STORIES"),el("h2","STACKCHAIN MAGAZINE"));header.append(title,closeButton);nav=el("nav");nav.setAttribute("aria-label","Stackchain sections");
      for(const p of D.pages)nav.append(button(p.title,p.id));body=el("div",null,"stackchain-content");root.append(header,nav,body);document.body.append(root);
      root.addEventListener("click",click);root.addEventListener("input",input);root.addEventListener("keydown",keys);root.addEventListener("keyup",keys);root.addEventListener("cancel",cancel);
    };
    const leave=()=>{close();active=false;route="home";query="";results=null;body?.replaceChildren();};
    return {enter:()=>{if(!disposed)active=true;},leave,close,
      open:(initial="home")=>{if(!active||disposed)return false;if(root?.open)return true;ensure();route=valid.has(initial)?initial:"home";query="";render();root.showModal();BL.dsbMenuShell.present(root,true);onOpen(true);return true;},
      get isOpen(){return !!root?.open;},get stats(){return {active,route,query,open:!!root?.open,panels:root?1:0,disposed};},
      dispose:()=>{leave();disposed=true;if(root){root.removeEventListener("click",click);root.removeEventListener("input",input);root.removeEventListener("keydown",keys);root.removeEventListener("keyup",keys);root.removeEventListener("cancel",cancel);root.remove();root=body=nav=null;}}
    };
  };
  BL.stackchainMenu={create};
})();
