// Local browse-only snapshot; all shopping happens on SVRN's official site in a separate tab.
(() => {
  "use strict";
  const BL=window.BL,D=BL.svrnData;
  const create=({onOpen=()=>{}}={})=>{
    let root=null,body=null,nav=null,active=false,disposed=false,route="home";
    const valid=new Set(D.pages.map(p=>p.id));
    const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
    const link=(title,url)=>{const n=el("a",title);n.href=url;n.target="_blank";n.rel="noopener noreferrer";n.referrerPolicy="no-referrer";return n;};
    const button=(title,id)=>{const b=el("button",title);b.type="button";b.dataset.route=id;return b;};
    const render=()=>{
      body.replaceChildren();root.scrollTop=0;
      for(const b of nav.children)b.setAttribute("aria-pressed",String(b.dataset.route===route));
      const page=D.pages.find(p=>p.id===route);body.append(el("h3",page.title));
      if(route==="home"||route==="about")body.append(el("p","Bitcoin clothing, faith apparel and decor — a public catalog centred on freedom, sovereignty and conversation."));
      if(route==="new")body.append(el("p","New Arrivals is a section on the official homepage. Follow the link for the latest releases; this room does not track stock or new drops."));
      if(route==="lookbook")body.append(el("p","Explore SVRN Society’s fashion photography on the official Lookbook. The in-world garments are stylized display studies, not exact product previews."));
      if(["home","collections","svrn","faith"].includes(route)){
        const grid=el("div",null,"svrn-grid");
        for(const c of D.collections.filter(c=>route!=="faith"||c.id==="faith")){const card=el("article",null,"svrn-card");card.append(el("small","COLLECTION"),el("h3",c.title),link("Explore official collection ↗",c.url));grid.append(card);}body.append(grid);
      }
      const products=D.products.filter(p=>["home","apparel"].includes(route)||p.category===route);
      if(products.length){body.append(el("h3","Selected public listings"));const grid=el("div",null,"svrn-grid");for(const p of products){const card=el("article",null,"svrn-card");card.append(el("small","SVRN SOCIETY"),el("h3",p.title),link("View on official site ↗",p.url));grid.append(card);}body.append(grid);}
      body.append(link(route==="home"?"Visit Official Site ↗":"Open official "+page.title+" ↗",page.url),el("p","Browse only. Purchases take place on svrnsociety.com. No account, payment details or personal data are collected here.","svrn-note"),el("small","Public source snapshot · "+D.verified+" · Current product details remain on the official site.","svrn-note"));
    };
    const close=()=>{if(!root?.open)return;root.close();BL.dsbMenuShell.present(root,false);onOpen(false);};
    const click=e=>{const b=e.target.closest("button");if(!b)return;if(b.dataset.route){route=valid.has(b.dataset.route)?b.dataset.route:"home";render();}else if(b.dataset.close!==undefined)close();};
    const keys=e=>{e.stopPropagation();if(e.type==="keydown"&&e.key==="Escape"){e.preventDefault();close();}};
    const cancel=e=>{e.preventDefault();close();};
    const ensure=()=>{
      if(root)return;root=el("dialog",null,"svrn-menu");root.setAttribute("aria-label","SVRN Society");
      const header=el("header"),title=el("div"),back=el("button","Return to store");back.type="button";back.dataset.close="";
      title.append(el("small","VAC 7 · CHORA"),el("h2","SVRN Society"));header.append(title,back);nav=el("nav");nav.setAttribute("aria-label","SVRN catalog");
      for(const p of D.pages)nav.append(button(p.title,p.id));body=el("div",null,"svrn-content");root.append(header,nav,body);document.body.append(root);
      root.addEventListener("click",click);root.addEventListener("keydown",keys);root.addEventListener("keyup",keys);root.addEventListener("cancel",cancel);
    };
    const leave=()=>{close();active=false;route="home";body?.replaceChildren();};
    return {enter:()=>{if(!disposed)active=true;},leave,close,
      open:(initial="home")=>{if(!active||disposed)return false;if(root?.open)return true;ensure();route=valid.has(initial)?initial:"home";render();root.showModal();BL.dsbMenuShell.present(root,true);onOpen(true);return true;},
      get isOpen(){return !!root?.open;},get stats(){return {active,route,open:!!root?.open,panels:root?1:0,disposed};},
      dispose:()=>{leave();disposed=true;if(root){root.removeEventListener("click",click);root.removeEventListener("keydown",keys);root.removeEventListener("keyup",keys);root.removeEventListener("cancel",cancel);root.remove();root=body=nav=null;}}
    };
  };
  BL.svrnMenu={create};
})();
