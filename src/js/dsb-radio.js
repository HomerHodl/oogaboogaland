// Original Noderunner harbor loop: no recording, stream, scheduler or extra AudioContext.
(() => {
  "use strict";
  const RATE=22050,BEAT=60/108,STEPS=64;
  let samples=null;
  const score=()=>{
    if(samples)return samples;
    samples=new Float32Array(Math.round(STEPS*BEAT*.5*RATE));
    const melody=[0,7,12,7,3,10,15,10,5,12,17,12,3,7,10,7];
    const roots=[48,51,53,46];let seed=71821;
    for(let step=0;step<STEPS;step++){
      const start=Math.round(step*BEAT*.5*RATE),root=roots[(step/16)|0];
      const frequency=440*2**((root+12+melody[step%16]-69)/12);
      for(let i=0,n=Math.floor(BEAT*.47*RATE);i<n&&start+i<samples.length;i++){
        const t=i/RATE,envelope=Math.min(1,t/.006)*Math.exp(-t*11);
        samples[start+i]+=.16*envelope*(Math.sin(t*frequency*Math.PI*2)+.2*Math.sin(t*frequency*Math.PI*4));
      }
      if(step%2===0){
        const bass=440*2**((root-12-69)/12);
        for(let i=0,n=Math.floor(BEAT*.9*RATE);i<n&&start+i<samples.length;i++){
          const t=i/RATE;samples[start+i]+=.17*Math.min(1,t/.01)*Math.exp(-t*6)*Math.sin(t*bass*Math.PI*2);
        }
      }
      for(let i=0,n=Math.floor(.12*RATE);i<n&&start+i<samples.length;i++){
        const t=i/RATE;seed=(Math.imul(seed,1664525)+1013904223)|0;
        const hiss=(seed>>>0)/2147483648-1;
        samples[start+i]+=.023*hiss*Math.exp(-t*65);
        if(step%4===0)samples[start+i]+=.22*Math.sin(2*Math.PI*(48*t+9*(1-Math.exp(-t*30))))*Math.exp(-t*25);
        if(step%4===2)samples[start+i]+=.07*hiss*Math.exp(-t*35);
      }
    }
    return samples;
  };
  // Adapted historical inverse-distance response, with no permanent background floor.
  const attenuation=distance=>{
    const edge=Math.max(0,Math.min(1,(42-distance)/12));
    return edge*edge*(3-2*edge)/(1+(Math.max(0,distance-5)/12)**2);
  };
  const create=(context,master)=>{
    const buffer=context.createBuffer(1,score().length,RATE);buffer.copyToChannel(samples,0);
    const gain=context.createGain();gain.gain.value=0;gain.connect(master);
    const source=context.createBufferSource();source.buffer=buffer;source.loop=true;source.connect(gain);source.start();
    let target=0,level=0,disposed=false;
    return {
      update:(dt,distance,enabled)=>{
        if(disposed)return;
        target=enabled ? .45*attenuation(distance) : 0;
        level+= (target-level)*(1-Math.exp(-Math.max(0,dt)*4));
        if(!enabled)level=0;
        gain.gain.setTargetAtTime(level,context.currentTime,.06);
      },
      get stats(){return {target,level,sources:disposed?0:1,starts:1,disposed,contextState:context.state};},
      dispose:()=>{if(disposed)return;disposed=true;target=level=0;source.stop();source.disconnect();gain.disconnect();}
    };
  };
  window.BL.dsbRadio={create,attenuation};
})();
