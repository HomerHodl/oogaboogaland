// Permanent exterior addresses. Append new numbers; never infer IDs from scene/array order.
(() => {
  "use strict";
  const BL=window.BL,S=BL.scene;
  // number, existing identity, x, z, type, plaque centre above floor, front offset, mount.
  // Houses use their authored local +z facade; balcony signs attach to the outward rail.
  const REGISTRY=Object.freeze([
    [1,"VACANT 21",5,51,"house",2.78,0.16,"facade"],
    [2,"VACANT 20",26,60,"house",2.78,0.16,"facade"],
    [3,"VACANT 19",57,57,"house",2.78,0.16,"facade"],
    [4,"VACANT 4",56,40,"house",2.78,0.16,"facade"],
    [5,"VACANT 1",31,45,"house",2.78,0.16,"facade"],
    [6,"VACANT 5",4,44,"house",2.78,0.16,"facade"],
    [7,"VACANT 2",10,23,"house",2.78,0.16,"facade"],
    [8,"VACANT 3",36,23,"house",3.65,1.06,"balcony rail"],
    [9,"VACANT 11",64,25,"house",2.78,0.16,"facade"],
    [10,"VACANT 10",60,9,"house",2.78,0.16,"facade"],
    [11,"VACANT 9",39,17,"house",3.35,1.06,"balcony rail"],
    [12,"VACANT 8",32,16,"house",2.78,0.16,"facade"],
    [13,"VACANT 7",17,14,"house",2.78,0.16,"facade"],
    [14,"VACANT 6",8,13,"house",3.85,1.06,"balcony rail"],
    [15,"VACANT 25",-14,19.5,"house",2.78,0.16,"facade"],
    [16,"VACANT 24",-20.5,19.5,"house",2.78,0.16,"facade"],
    [17,"VACANT 23",-27,19,"house",2.85,1.06,"balcony rail"],
    [18,"VACANT 22",-34,18,"house",2.78,0.16,"facade"],
    [19,"VACANT 15",9,-2,"house",2.85,1.06,"balcony rail"],
    [20,"VACANT 12",25,2,"house",3.85,1.06,"balcony rail"],
    [21,"VACANT 13",36,2,"house",2.78,0.16,"facade"],
    [22,"VACANT 14",54,1,"house",2.78,0.16,"facade"],
    [23,"VACANT 17",39,-9,"house",2.78,0.16,"facade"],
    [24,"VACANT 18",32,-21,"house",2.85,1.06,"balcony rail"],
    [25,"VACANT 16",19,-16,"house",2.78,0.16,"facade"],
    [26,"VACANT 32",13,-12,"house",2.78,0.16,"facade"],
    [27,"VACANT 26",6.65,-14.4,"house",2.85,1.06,"balcony rail"],
    [28,"VACANT 33",5,-22,"house",2.78,0.16,"facade"],
    [29,"VACANT 27",-0.2,-17.6,"house",2.78,0.16,"facade"],
    [30,"VACANT 28",-7.9,-20.8,"house",2.78,0.16,"facade"],
    [31,"VACANT 31",-10.1,-11.7,"house",2.78,0.16,"facade"],
    [32,"VACANT 30",-4.8,-9.4,"house",2.78,0.16,"facade"],
    [33,"VACANT 29",2.5,-6,"house",2.78,0.16,"facade"],
    [34,"olympus-mill-east",-14,-58,"windmill",1.05,2.18,"beside tower door"],
    [35,"olympus-mill-west",-24,-66,"windmill",1.05,2.18,"beside tower door"]
  ].map(([number,buildingId,x,z,type,signY,signZ,mount])=>Object.freeze({number,buildingId,x,z,type,signY,signZ,mount})));
  const REVIEWS={
    "vac-overview":{yaw:.35,pitch:.75,dist:137,target:{x:17,y:12,z:17}},
    "vac-lower":{yaw:.1,pitch:.48,dist:64,target:{x:30,y:6,z:48}},
    "vac-central":{yaw:.2,pitch:.58,dist:73,target:{x:25,y:9,z:19}},
    "vac-upper":{yaw:.5,pitch:.6,dist:72,target:{x:12,y:11,z:-11}},
    "vac-windmills":{yaw:2.2,pitch:.12,dist:32,target:{x:-19,y:28,z:-62}}
  };
  const create=({root,land,olympus})=>{
    const group=S.createNode({sightHidden:true}),properties=[];S.addChild(root,group);
    for(const address of REGISTRY){
      const house=address.type==="house";
      const matches=house?land.buildings.filter(b=>b.name===address.buildingId):olympus.group.children.filter(n=>n.children.length===1&&n.position.x===address.x&&n.position.z===address.z);
      if(matches.length!==1)throw Error("Vacancy property missing or ambiguous: "+address.buildingId);
      const building=matches[0],x=house?building.x:building.position.x,z=house?building.z:building.position.z;
      if(x!==address.x||z!==address.z)throw Error("Vacancy property moved: "+address.buildingId);
      const yaw=house?building.yaw:building.rotation.y,floor=house?building.floor:building.position.y,front=house?building.d/2:0;
      const c=Math.cos(yaw),s=Math.sin(yaw),point=(lx,y,lz)=>({x:x+c*lx+s*lz,y:floor+y,z:z-s*lx+c*lz});
      const node=S.createNode({position:{x,y:floor,z},rotation:{x:0,y:yaw+(house?0:.85),z:0},sightHidden:true});S.addChild(group,node);
      const text="VAC "+address.number,width=house?2.25:1.65,height=house?.58:.48,depth=.16,signZ=front+address.signZ;
      const plaque=BL.dsbModels.block(node,"#346e9c",0,address.signY,signZ,width,height,depth);
      const lettering=BL.dsbModels.sign(node,text,.04,address.signY-(house?.18:.14),signZ+.12,house?.48:.36,"#fff4df");
      properties.push({address,building,node,plaque,lettering,text,x,z,yaw,floor,front:"local +z",mount:address.mount,
        door:point(0,house?0:.2,house?front+.075:2.18),approach:point(0,0,house?front+1.5:3.8)});
    }
    const resolve=number=>properties.find(p=>p.address.number===number);
    const dispose=()=>{S.removeChild(root,group);while(group.children.length)S.removeChild(group,group.children[group.children.length-1]);properties.length=0;};
    return {group,properties,resolve,dispose};
  };
  BL.dsbVacancies={REGISTRY,REVIEWS,create};
})();
