// One height-aware exterior collision set. Instanced dressing gets a matching, unrendered shell.
(() => {
  "use strict";
  const BL=window.BL,S=BL.scene,M=BL.models;
  const PASSABLE=new Set(["agave","bougainvillea","cover","flowers","glass","grass","herbs","meadow","paving","rope","shade","shrub","vine","windowglow","foam"]);
  const MEDITERRANEAN=new Set(["olive","cypress","grass","flowers","rock","planter","shrub"]);
  const CHORA=new Set(["crate","barrel","table","bench","driftwood","net","window"]);
  const trunk=M.box({w:.45,h:2.1,d:.45,color:"#76654e",offset:{x:0,y:1.05,z:0}});
  const create=({land,nature,detail,enrichment,town,olympus,noderunner,vacancies,structures})=>{
    const solids=BL.solidProps.create(),instances=S.createNode();
    const put=(geometry,p,sx=1,sy=sx,sz=sx)=>S.addChild(instances,S.createNode({geometry,position:{x:p.x,y:p.y,z:p.z},rotation:{x:0,y:p.yaw||0,z:0},scale:{x:sx,y:sy,z:sz}}));
    const planted=(p,sx,sy,sz,geometry)=>{
      if(PASSABLE.has(p.kind))return;
      if(p.kind==="olive"||p.kind==="cypress")put(trunk,p,sx*(p.kind==="olive"?1.3:.65),sy*(p.kind==="olive"?.65:.33),sz*(p.kind==="olive"?1.3:.65));
      else put(geometry,p,sx,sy,sz);
    };
    // Terrain is sampled directly; the remaining geography children are building shells, doors and decks.
    for(let i=1;i<land.root.children.length;i++)solids.add(land.root.children[i]);
    solids.add(noderunner.group);solids.add(detail.group);solids.add(town.collision);solids.add(vacancies.group);
    for(const node of structures)solids.add(node);
    for(const p of nature.placements)if(!PASSABLE.has(p.kind))planted(p,p.scale,p.scale,p.scale,BL.dressing.mediterranean(p.kind));
    for(const p of detail.placements)if(p.kind!=="bollard"&&!PASSABLE.has(p.kind))planted(p,p.scale||1,p.scale||1,p.scale||1,
      MEDITERRANEAN.has(p.kind)?BL.dressing.mediterranean(p.kind):BL.dressing.chora(p.kind));
    for(const p of enrichment.placements){
      if(p.node){solids.add(p.node);continue;}
      if(p.sx===undefined||PASSABLE.has(p.kind))continue;
      const geometry=MEDITERRANEAN.has(p.kind)?BL.dressing.mediterranean(p.kind):CHORA.has(p.kind)?BL.dressing.chora(p.kind):BL.dressing.coastal(p.kind);
      planted(p,p.sx,p.sy,p.sz,geometry);
    }
    const olive=BL.dressing.mediterranean("olive"),herbs=new Set([BL.dressing.mediterranean("flowers"),BL.dressing.mediterranean("shrub"),BL.dressing.mediterranean("cover")]);
    for(const node of olympus.group.children){
      const g=node.geometry;if(!g)continue;
      if(g===olive){planted({kind:"olive",x:node.position.x,y:node.position.y,z:node.position.z,yaw:node.rotation.y},node.scale.x,node.scale.y,node.scale.z,g);continue;}
      if(herbs.has(g)||g.glassOpacity||g.faces.some(face=>face.water))continue;
      solids.add(node);
    }
    solids.add(instances);solids.sync();
    return {solids,sync:solids.sync,dispose:()=>solids.dispose()};
  };
  BL.dsbCollision={create};
})();
