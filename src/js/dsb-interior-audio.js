// The historical Meme Factory workshop hum, independent of the shared exterior bus.
(() => {
  "use strict";
  const create=()=>{
    let context=null,bus=null,hum=null,buzz=null,noise=null,filter=null,humGain=null,buzzGain=null,noiseGain=null;
    let kind="meme-factory",duck=false;
    let active=false,muted=false,connected=false,disposed=false;
    const gate=()=>{
      if(!bus)return;
      const on=active&&!muted&&!document.hidden;
      if(on&&!connected){bus.connect(context.destination);connected=true;}
      if(!on&&connected){bus.disconnect();connected=false;}
    };
    const wake=()=>{
      if(context||disposed||!active||!window.AudioContext||!navigator.userActivation?.hasBeenActive)return;
      context=new AudioContext();bus=context.createGain();bus.gain.value=.7;
      humGain=context.createGain();humGain.gain.value=.028;humGain.connect(bus);
      hum=context.createOscillator();hum.type="triangle";hum.frequency.value=46;hum.connect(humGain);hum.start();
      buzzGain=context.createGain();buzzGain.gain.value=.007;buzzGain.connect(bus);
      buzz=context.createOscillator();buzz.type="sawtooth";buzz.frequency.value=92;buzz.connect(buzzGain);buzz.start();
      const buffer=context.createBuffer(1,context.sampleRate*2,context.sampleRate),samples=buffer.getChannelData(0);
      let seed=48121;
      for(let i=0;i<samples.length;i++){seed=(Math.imul(seed,1103515245)+12345)|0;samples[i]=(seed>>>0)/2147483648-1;}
      noise=context.createBufferSource();noise.buffer=buffer;noise.loop=true;
      filter=context.createBiquadFilter();filter.type="bandpass";filter.frequency.value=1100;filter.Q.value=.8;
      noiseGain=context.createGain();noiseGain.gain.value=.01;noise.connect(filter);filter.connect(noiseGain);noiseGain.connect(bus);noise.start();
      gate();
    };
    const gesture=()=>{wake();if(active&&context?.state==="suspended")context.resume().catch(()=>{});};
    document.addEventListener("pointerdown",gesture);document.addEventListener("keydown",gesture);document.addEventListener("visibilitychange",gate);
    return {
      setActive:(on,room="meme-factory")=>{active=!!on;kind=room;duck=false;wake();gate();},
      setDucked:on=>{duck=!!on;},
      update:on=>{
        if(muted!==!!on){muted=!!on;gate();}
        if(!active||!context)return;
        const t=context.currentTime;
        bus.gain.setTargetAtTime((kind==="shop"?.12:kind==="studio"?.32:.7)*(duck?.2:1),t,.15);
        hum.frequency.setTargetAtTime(44+Math.sin(t*.8)*2,t,.08);
        buzz.frequency.setTargetAtTime(90+Math.sin(t*3.2)*7,t,.08);
        buzzGain.gain.setTargetAtTime(.006+.003*(.5+.5*Math.sin(t*1.7)),t,.12);
        noiseGain.gain.setTargetAtTime(.008+.004*(.5+.5*Math.sin(t*2.3)),t,.12);
      },
      get stats(){return {active,connected,contexts:context?1:0,sources:context?3:0,state:context?.state||"locked"};},
      dispose:()=>{
        disposed=true;active=false;gate();
        document.removeEventListener("pointerdown",gesture);document.removeEventListener("keydown",gesture);document.removeEventListener("visibilitychange",gate);
        if(!context)return;
        for(const source of [hum,buzz,noise]){source.stop();source.disconnect();}
        for(const node of [filter,humGain,buzzGain,noiseGain,bus])node.disconnect();
        context.close().catch(()=>{});context=null;
      }
    };
  };
  window.BL.dsbInteriorAudio={create};
})();
