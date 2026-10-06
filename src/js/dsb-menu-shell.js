// Shared viewport, focus and gameplay isolation for every substantial DSB menu.
(() => {
  "use strict";
  const active=new Set(),inert=new Map(),focus=new WeakMap();
  let shade=null;
  const layout=()=>{
    const v=window.visualViewport,w=v?.width||innerWidth,h=v?.height||innerHeight;
    for(const root of active){
      root.style.setProperty("--menu-x",`${(v?.offsetLeft||0)+w/2}px`);
      root.style.setProperty("--menu-y",`${(v?.offsetTop||0)+h/2}px`);
      root.style.setProperty("--menu-w",`${w}px`);root.style.setProperty("--menu-h",`${h}px`);
    }
  };
  const restore=()=>{for(const [node,was] of inert)node.inert=was;inert.clear();};
  const keys=e=>{
    if(e.key!=="Tab")return;
    const root=Array.from(active).at(-1);if(!root)return;
    const items=Array.from(root.querySelectorAll('button:not(:disabled),input:not(:disabled),select,a[href],textarea,iframe,[tabindex="0"]')).filter(n=>n.getClientRects().length&&!n.closest("[hidden]"));
    const i=items.indexOf(document.activeElement);
    if(e.shiftKey&&i<=0){e.preventDefault();items.at(-1)?.focus();}
    else if(!e.shiftKey&&(i<0||i===items.length-1)){e.preventDefault();items[0]?.focus();}
  };
  const present=(root,on)=>{
    root.classList.add("dsb-menu-shell");
    if(on===active.has(root))return;
    if(on){focus.set(root,document.activeElement);active.add(root);root.scrollTop=0;root.classList.add("dsb-menu-engaged");root.setAttribute("aria-modal","true");root.setAttribute("role","dialog");}
    else{active.delete(root);root.classList.remove("dsb-menu-engaged");root.removeAttribute("aria-modal");}
    restore();
    if(active.size){
      if(!shade){shade=document.createElement("div");shade.className="dsb-menu-shade";document.body.appendChild(shade);window.addEventListener("resize",layout);window.visualViewport?.addEventListener("resize",layout);window.visualViewport?.addEventListener("scroll",layout);document.addEventListener("keydown",keys,true);}
      for(const panel of active){let child=panel;while(child!==document.body){for(const sibling of child.parentElement.children){if(sibling===child||sibling===shade||Array.from(active).some(p=>sibling.contains(p)))continue;if(!inert.has(sibling))inert.set(sibling,sibling.inert);sibling.inert=true;}child=child.parentElement;}}
      document.body.classList.add("dsb-menu-open");layout();
      if(on)root.querySelector("button")?.focus();
    }else{
      shade?.remove();shade=null;document.body.classList.remove("dsb-menu-open");window.removeEventListener("resize",layout);window.visualViewport?.removeEventListener("resize",layout);window.visualViewport?.removeEventListener("scroll",layout);document.removeEventListener("keydown",keys,true);
    }
    if(!on){const previous=focus.get(root);if(previous?.isConnected&&!previous.inert)previous.focus();focus.delete(root);}
  };
  window.BL.dsbMenuShell={present,get count(){return active.size;}};
})();
