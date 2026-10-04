// One lazy, visit-local information terminal. No network, storage, credentials or checkout.
(() => {
  "use strict";
  const BL=window.BL,D=BL.bigBitcoinData;
  const create=({onOpen=()=>{},action=null}={})=>{
    const root=document.getElementById("big-terminal"),nav=root.querySelector("nav"),results=root.querySelector(".big-results"),closeButton=root.querySelector('[data-big="close"]');
    let active=false,opened=false,disposed=false,section="overview",previous=null,pending=false,observer=null;
    const el=(type,text)=>{const n=document.createElement(type);if(text)n.textContent=text;return n;};
    const render=()=>{
      results.replaceChildren();
      for(const b of nav.children)b.setAttribute("aria-pressed",String(b.dataset.section===section));
      for(const card of D.cards.filter(c=>c.section===section)){
        const a=el("article"),type=el("p",card.type),link=el("a",card.type==="Official product"?"View product on official site ↗":"Read on official site ↗");type.className="big-eyebrow";
        const url=D.official(card.url);if(!url)throw Error("Unapproved BIG BITCOIN destination");
        link.href=url;link.target="_blank";link.rel="noopener noreferrer";link.referrerPolicy="no-referrer";link.setAttribute("aria-label",link.textContent+" (new tab)");
        a.appendChild(type);a.appendChild(el("h3",card.title));a.appendChild(el("p",card.summary));a.appendChild(link);results.appendChild(a);
      }
    };
    const choose=id=>{if(!D.sections.some(s=>s[0]===id))return;section=id;if(opened)render();};
    const open=()=>{
      if(!active||disposed)return false;if(opened)return true;
      previous=document.activeElement;opened=true;root.hidden=false;
      if(!nav.children.length)for(const [id,title] of D.sections){const b=el("button",title);b.type="button";b.dataset.section=id;nav.appendChild(b);}
      render();onOpen(true);closeButton.focus();return true;
    };
    const close=()=>{if(!opened)return;opened=false;root.hidden=true;onOpen(false);if(previous?.isConnected)previous.focus();previous=null;};
    const requestLayout=()=>{pending=true;};
    const layout=()=>{
      if(!active||!pending||!action)return;pending=false;
      if(!matchMedia("(pointer: coarse), (max-width: 720px)").matches)return;
      const jump=document.getElementById("act").getBoundingClientRect();if(!jump.width)return;
      const x=jump.left+jump.width/2;let half=Math.min(88,x-12,document.documentElement.clientWidth-x-12);
      for(const id of ["joy-move","joy-look"]){const r=document.getElementById(id).getBoundingClientRect();if(r.width)half=Math.min(half,x>r.right?x-r.right-8:r.left>x?r.left-x-8:half);}
      action.style.setProperty("--big-action-x",`${x}px`);action.style.setProperty("--big-action-y",`${jump.top-8}px`);action.style.setProperty("--big-action-width",`${Math.max(44,half*2)}px`);
    };
    const enter=()=>{
      if(disposed||active)return;active=true;action?.classList.add("big-context");
      if(action){observer=new ResizeObserver(requestLayout);observer.observe(document.getElementById("act"));observer.observe(document.documentElement);window.addEventListener("resize",requestLayout);requestLayout();}
    };
    const leave=()=>{
      active=false;close();section="overview";results.replaceChildren();nav.replaceChildren();previous=null;
      if(observer){observer.disconnect();observer=null;window.removeEventListener("resize",requestLayout);}action?.classList.remove("big-context");pending=false;
    };
    const click=e=>{const b=e.target.closest("button");if(!b||!root.contains(b))return;if(b.dataset.big==="close")close();else if(b.dataset.section)choose(b.dataset.section);};
    const keys=e=>{
      e.stopPropagation();if(e.type!=="keydown")return;
      if(e.key==="Escape"){e.preventDefault();close();}
      if(e.key==="Tab"){const items=Array.from(root.querySelectorAll("button, a[href]")).filter(n=>!n.hidden&&!n.closest("[hidden]")),i=items.indexOf(document.activeElement);if(e.shiftKey&&i<=0){e.preventDefault();items[items.length-1]?.focus();}else if(!e.shiftKey&&i===items.length-1){e.preventDefault();items[0]?.focus();}}
    };
    const outside=e=>{if(opened&&!root.contains(e.target)&&e.target!==action)close();};
    root.addEventListener("click",click);root.addEventListener("keydown",keys);root.addEventListener("keyup",keys);document.addEventListener("pointerdown",outside);
    return {enter,leave,open,close,choose,layout,get isOpen(){return opened;},get stats(){return {active,opened,disposed,section,panels:1};},dispose:()=>{if(disposed)return;leave();disposed=true;root.removeEventListener("click",click);root.removeEventListener("keydown",keys);root.removeEventListener("keyup",keys);document.removeEventListener("pointerdown",outside);}};
  };
  BL.bigBitcoinMenu={create};
})();
