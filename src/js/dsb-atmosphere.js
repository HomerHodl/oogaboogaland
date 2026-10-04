// DSB Land's art direction for light and horizon, kept out of the scene file: the Aegean light pass, lanterns at
// the doors, the sea to the horizon with islets and sails on it, and the Portara's marble. Visual only.
(() => {
  "use strict";
  const BL=window.BL,S=BL.scene,M=BL.models;
  // Render options the scene merges in: the sky pass draws its sea past the water tile, and the sky's haze
  // horizon stays at sea level (the hub drops it for an island floating far above the sea).
  const OPTS={sea:-.3,hazeDrop:0};
  const PORTARA={shaftHalf:2.5,footHalf:2.25,footTop:.5,lintelY:6.5};
  const portaraAperture=Object.freeze({width:PORTARA.shaftHalf*2,height:PORTARA.lintelY,footWidth:PORTARA.footHalf*2,footHeight:PORTARA.footTop,inset:.025});
  let golden=0;
  // Runs right after `daylight.sample`. High sun: whiter light and sand bounce, so white walls stay white and
  // shade stays luminous. Low sun: the light holds its strength and rakes gold, and lanterns come on while the
  // sky is still bright. Writes in place; allocates nothing.
  const light=o=>{
    const alt=o.sunAltitude,high=(o.day||0)*(1-(o.twilight||0)),g=o.ground,d=o.direct,k=o.sky;
    g[0]+=(.50-g[0])*high*.75;g[1]+=(.47-g[1])*high*.75;g[2]+=(.42-g[2])*high*.75;
    d[0]+=(.78-d[0])*high*.45;d[1]+=(.74-d[1])*high*.45;d[2]+=(.66-d[2])*high*.45;
    k[0]+=(.48-k[0])*high*.5;k[1]+=(.55-k[1])*high*.5;k[2]+=(.69-k[2])*high*.5;
    const low=Math.max(0,Math.min(1,(alt+1)/4))*Math.max(0,Math.min(1,(16-alt)/8));golden=low;
    d[0]+=(1-d[0])*low*.85;d[1]+=(.66-d[1])*low*.85;d[2]+=(.38-d[2])*low*.85;
    g[0]+=(.46-g[0])*low*.6;g[1]+=(.33-g[1])*low*.6;g[2]+=(.27-g[2])*low*.6;
    o.directStrength=o.directionalLightStrength=Math.max(o.directStrength,low*.92);
    o.shadowStrength=Math.max(o.shadowStrength,low*.85);
    o.lampFactor=o.torch=Math.max(o.lampFactor,1-Math.max(0,Math.min(1,(alt-6)/8)));
    o.bloomStrength+=low*.2;
  };
  // The gate's dressed marble on the quarter-metre grid, so the block shader courses it. Same opening as before.
  const portara=M.cached(()=>{
    const b=(x0,y0,z0,x1,y1,z1,color)=>M.box({w:x1-x0,h:y1-y0,d:z1-z0,color,offset:{x:(x0+x1)/2,y:(y0+y1)/2,z:(z0+z1)/2}});
    const p=PORTARA;
    const g=M.merge(b(-4.25,-1,-1.25,-p.footHalf,p.footTop,1.25,"#d9cfb8"),b(p.footHalf,-1,-1.25,4.25,p.footTop,1.25,"#d9cfb8"),b(-3.75,p.footTop,-.75,-p.shaftHalf,p.lintelY,.75,"#efe7d6"),b(p.shaftHalf,p.footTop,-.75,3.75,p.lintelY,.75,"#efe7d6"),b(-4,p.lintelY,-1,4,8,1,"#f3ecdd"),b(-4.5,8,-1.25,4.5,8.5,1.25,"#e4dac4"));
    g.voxel=new Float32Array([.25,0,0,0]);return g;
  });
  const create=({root,land,renderer})=>{
    const group=S.createNode({sightHidden:true});S.addChild(root,group);
    // One warm light a door, venues first, after the scene's own lamps: the tiers draw the first 32 / 20 / 10.
    const doors=[];
    for(const b of land.buildings){const c=Math.cos(b.yaw),s=Math.sin(b.yaw);doors.push(b.x+s*(b.d/2+1.3),b.floor+2.5,b.z+c*(b.d/2+1.3));}
    let sails=null;
    if(renderer.kind!=="canvas2d"){
      // The main island's own sea stacks, hazed by the existing fog, and its rafts under sail.
      for(const [deg,r,v] of [[18,470,0],[52,430,1],[97,500,2],[138,450,0],[212,470,1],[262,440,2],[318,490,0]]){const a=deg*Math.PI/180;S.addChild(group,S.createNode({geometry:BL.dressing.islet(v),position:{x:Math.sin(a)*r,y:-2.3,z:-Math.cos(a)*r},rotation:{x:0,y:deg*.7,z:0},scale:{x:1.2,y:1.2,z:1.2},sightHidden:true}));}
      sails=BL.dressing.fleet({sea:-.3,spots:[[150,1.1,3.2],[178,2.2,3.8],[136,3.5,3],[192,4.7,4],[160,5.6,3.4]],seed:11});
      for(const n of sails.nodes)S.addChild(group,n);
    }
    // Appends the door lights after the lamps the scene has already written.
    const lights=o=>{
      const k=o.lampFactor,a=o.lights;let count=o.lightCount;
      if(k>.001)for(let i=0;i<doors.length&&count<BL.glRenderer.POINT_LIGHT_CAPACITY;i+=3){const p=count++*8;a[p]=doors[i];a[p+1]=doors[i+1];a[p+2]=doors[i+2];a[p+3]=9;a[p+4]=k*.95;a[p+5]=k*.62;a[p+6]=k*.3;a[p+7]=0;}
      o.lightCount=count;
    };
    // After the weather has written its sky: a floor of fair-weather cloud, thicker and with longer sight at
    // golden hour.
    const update=(time,o,outdoors)=>{
      o.clouds=Math.max(o.clouds||0,.36+.2*golden);o.fogNear+=golden*170;o.fogFar+=golden*260;
      if(sails&&outdoors)sails.update(time);
    };
    const dispose=()=>{S.removeChild(root,group);while(group.children.length)S.removeChild(group,group.children[group.children.length-1]);doors.length=0;sails=null;};
    return {group,lights,update,dispose,get doors(){return doors.length/3;}};
  };
  BL.dsbAtmosphere={OPTS,light,portara,portaraAperture,create};
})();
