// One lazy menu. Physical zones choose its opening route; navigation is then unrestricted.
(() => {
  "use strict";
  const BL=window.BL,D=BL.memeFactoryData;
  const create=({onOpen=()=>{}}={})=>{
    let root=null,body=null,nav=null,active=false,disposed=false,route="home";
    const routes=[["home","Home"],["laser","#LaserRayUntil100K"],["podcast","Podcast / Listen"],["contributors","Contributors"]];
    const valid=new Set([...routes.map(r=>r[0]),...D.contributors.map(p=>p.id)]);
    const el=(t,text,cls)=>{const n=document.createElement(t);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
    const link=(title,url)=>{const a=el("a",title);a.href=url;a.target="_blank";a.rel="noopener noreferrer";a.referrerPolicy="no-referrer";return a;};
    const picture=p=>{const img=el("img");img.src=p.image;img.alt=p.name+" · public Meme Factory profile image";img.width=img.height=160;return img;};
    const render=()=>{
      body.replaceChildren();body.scrollTop=0;
      for(const b of nav.children)b.setAttribute("aria-pressed",String(b.dataset.route===route));
      const person=D.contributors.find(p=>p.id===route);
      if(person){const card=el("article",null,"meme-person");card.append(picture(person),el("h3",person.name),link("Open official contributor page ↗",person.url));body.append(card);return;}
      if(route==="home"){
        body.append(el("p","The Meme Factory™ does not exist.","meme-statement"),el("p","We are the reason your mother has laser eyes in her profile pic."),link("The Meme Factory™ ↗",D.home));
        const grid=el("div",null,"meme-gallery");for(const p of D.contributors.slice(0,6)){const b=el("button",null,"meme-profile");b.type="button";b.dataset.route=p.id;b.append(picture(p),el("span",p.name));grid.append(b);}body.append(grid);
        const destinations=el("div",null,"meme-destinations");for(const [title,url] of D.links.slice(4))destinations.append(link(title+" ↗",url));body.append(destinations);
      }else if(route==="laser"){
        body.append(el("h3","#LaserRayUntil100K"),el("p","In February 2021, Bitcoin supporters added glowing eyes to their profile pictures. The hashtag expressed an intention to keep laser eyes until Bitcoin reached $100,000."),el("p","Know Your Meme traces the originating February 16, 2021 tweet to @CHAIRFORCE_BTC."));
        const grid=el("div",null,"meme-gallery");for(const id of ["chairforce","yellow","plan-marcus"]){const p=D.contributors.find(p=>p.id===id);const card=el("figure");card.append(picture(p),el("figcaption",p.name));grid.append(card);}body.append(grid,link("Read the historical reference · Know Your Meme ↗",D.history));
      }else if(route==="podcast"){
        body.append(el("h3","Podcast / Listen"),el("p","Choose an official listening destination. Playback starts there when you choose it."),link("Browse Meme Factory podcast episodes ↗",D.podcast));
        const destinations=el("div",null,"meme-destinations");for(const [title,url] of D.links.slice(0,4))destinations.append(link(title+" ↗",url));body.append(destinations);
      }else{
        body.append(el("h3","Contributors"));const grid=el("div",null,"meme-gallery");
        for(const p of D.contributors){const b=el("button",null,"meme-profile");b.type="button";b.dataset.route=p.id;b.append(picture(p),el("span",p.name));grid.append(b);}body.append(grid,link("Public Nostr directory ↗",D.links[5][1]));
      }
    };
    const close=()=>{if(!root?.open)return;root.close();BL.dsbMenuShell.present(root,false);onOpen(false);};
    const click=e=>{const b=e.target.closest("button");if(!b)return;if(b.dataset.route){route=valid.has(b.dataset.route)?b.dataset.route:"home";render();}else if(b.dataset.close!==undefined)close();};
    const keys=e=>{e.stopPropagation();if(e.type==="keydown"&&e.key==="Escape"){e.preventDefault();close();}};
    const cancel=e=>{e.preventDefault();close();};
    const ensure=()=>{
      if(root)return;root=el("dialog",null,"meme-menu");root.setAttribute("aria-label","The Meme Factory");
      const header=el("header"),title=el("div"),closeButton=el("button","Return to Factory");closeButton.type="button";closeButton.dataset.close="";
      title.append(el("small","MEMES / CREATORS / BITCOIN"),el("h2","THE MEME FACTORY™"));header.append(title,closeButton);nav=el("nav");nav.setAttribute("aria-label","Meme Factory sections");
      for(const [id,title] of routes){const b=el("button",title);b.type="button";b.dataset.route=id;nav.append(b);}body=el("div",null,"meme-content");root.append(header,nav,body);document.body.append(root);
      root.addEventListener("click",click);root.addEventListener("keydown",keys);root.addEventListener("keyup",keys);root.addEventListener("cancel",cancel);
    };
    const leave=()=>{close();active=false;route="home";body?.replaceChildren();};
    return {enter:()=>{if(!disposed)active=true;},leave,close,
      open:(initial="home")=>{if(!active||disposed)return false;if(root?.open)return true;ensure();route=valid.has(initial)?initial:"home";render();root.showModal();BL.dsbMenuShell.present(root,true);onOpen(true);return true;},
      get isOpen(){return !!root?.open;},get stats(){return {active,route,open:!!root?.open,panels:root?1:0,disposed};},
      dispose:()=>{leave();disposed=true;if(root){root.removeEventListener("click",click);root.removeEventListener("keydown",keys);root.removeEventListener("keyup",keys);root.removeEventListener("cancel",cancel);root.remove();root=body=nav=null;}}
    };
  };
  BL.memeFactoryMenu={create};
})();
