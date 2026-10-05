// Entrance audio: four recordings, quiet ducked music, and pooled walking sounds.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  // Five compressed recordings at most, shared across visits. Decode receives a copy because
  // decodeAudioData detaches its input. Failed requests are evicted so a later visit can retry.
  const recordings = new Map();
  const recording = (url, held) => {
    let entry = recordings.get(url);
    if (!entry) {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
      entry = { controller, users: 0, pending: true, promise: null, url };
      entry.promise = fetch(url, { signal: controller.signal }).then((response) => {
        if (!response.ok) throw new Error("Entrance audio unavailable");
        return response.arrayBuffer();
      }).catch((error) => {
        if (recordings.get(url) === entry) recordings.delete(url);
        throw error;
      }).finally(() => { entry.pending = false; clearTimeout(timer); });
      recordings.set(url, entry);
    }
    if (!held.has(entry)) { held.add(entry); entry.users++; }
    return entry.promise;
  };
  // All outdoor sources are started once; updates only automate this fixed graph.
  const createAmbience = (context, master) => {
    const sources = [], nodes = [], layers = {}, names = ["river", "waterfall", "motor", "crowd", "wildlife"], targets = new Float32Array(5);
    let nextCall = 0, calls = 0, birdSide = 0, enabled = false;
    const bus = context.createGain(); bus.gain.value = 0; bus.connect(master); nodes.push(bus);
    const noiseBuffer = context.createBuffer(1, context.sampleRate * 3, context.sampleRate), samples = noiseBuffer.getChannelData(0);
    let seed = 71931;
    for (let i = 0; i < samples.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; samples[i] = (seed >>> 0) / 2147483648 - 1; }
    const noise = context.createBufferSource(); noise.buffer = noiseBuffer; noise.loop = true; noise.start(); sources.push(noise);
    for (const name of names) {
      const gain = context.createGain(), pan = context.createStereoPanner(); gain.gain.value = 0; gain.connect(pan); pan.connect(bus);
      layers[name] = { gain, pan }; nodes.push(gain, pan);
    }
    const filter = (name, frequency, q) => {
      const f = context.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = frequency; f.Q.value = q;
      noise.connect(f); f.connect(layers[name].gain); nodes.push(f); return f;
    };
    filter("river", 850, 0.45); filter("waterfall", 240, 0.35);
    const murmur = filter("crowd", 620, 1.3);
    const motorFilter = context.createBiquadFilter(); motorFilter.type = "lowpass"; motorFilter.frequency.value = 220; motorFilter.connect(layers.motor.gain); nodes.push(motorFilter);
    const motor = context.createOscillator(); motor.type = "sawtooth"; motor.frequency.value = 58; motor.connect(motorFilter); motor.start(); sources.push(motor);
    const birds = [];
    for (let i = 0; i < 2; i++) {
      const oscillator = context.createOscillator(), gain = context.createGain(); gain.gain.value = 0; oscillator.connect(gain); gain.connect(layers.wildlife.gain); oscillator.start();
      birds.push({ oscillator, gain }); sources.push(oscillator); nodes.push(gain);
    }
    const attenuate = (distance, range) => 1 / (1 + (distance / range) ** 2);
    const position = (layer, x, y, z, camera, level, range, index) => {
      const dx = x - camera.position.x, dy = y - camera.position.y, dz = z - camera.position.z;
      const fx = camera.target.x - camera.position.x, fz = camera.target.z - camera.position.z;
      const distance = Math.hypot(dx, dy, dz), horizontal = Math.hypot(dx, dz), forward = Math.hypot(fx, fz);
      const pan = horizontal > 0.01 && forward > 0.01 ? (-fz * dx + fx * dz) / (horizontal * forward) : 0;
      targets[index] = level * attenuate(distance, range);
      layer.gain.gain.setTargetAtTime(targets[index], context.currentTime, 0.25);
      layer.pan.pan.setTargetAtTime(Math.max(-0.85, Math.min(0.85, pan)), context.currentTime, 0.2);
    };
    const update = (camera, boat, active, muted) => {
      const at = context.currentTime;
      enabled = active && !muted;
      bus.gain.setTargetAtTime(enabled ? 1 : 0, at, 0.3);
      if (!enabled) { nextCall = at + 2; return; }
      const radius = Math.hypot(camera.position.x, camera.position.z), ux = radius > 0.01 ? camera.position.x / radius : 0, uz = radius > 0.01 ? camera.position.z / radius : 1;
      position(layers.river, ux * 39, -0.5, uz * 39, camera, 0.065 * (0.93 + Math.sin(at * 0.6) * 0.07), 15, 0);
      position(layers.waterfall, ux * 44, -5, uz * 44, camera, 0.09, 17, 1);
      position(layers.motor, boat.x, boat.y, boat.z, camera, 0.023 * (0.9 + Math.sin(at * 16) * 0.1), 13, 2);
      motor.frequency.setTargetAtTime(58 + Math.sin(at * 0.8) * 3, at, 0.1);
      position(layers.crowd, -18, 1, -9, camera, 0.026 * (0.55 + 0.2 * Math.sin(at * 2.7) + 0.15 * Math.sin(at * 4.1)), 11, 3);
      murmur.frequency.setTargetAtTime(650 + Math.sin(at * 1.9) * 180, at, 0.12);
      if (at >= nextCall) {
        birdSide = calls % 2;
        const bird = birds[birdSide], base = birdSide ? 1850 : 1350;
        nextCall = at + 6 + (calls % 3) * 1.7; calls++;
        bird.oscillator.frequency.cancelScheduledValues(at); bird.oscillator.frequency.setValueAtTime(base, at);
        bird.oscillator.frequency.exponentialRampToValueAtTime(base * 1.45, at + 0.09); bird.oscillator.frequency.exponentialRampToValueAtTime(base * 0.9, at + 0.28);
        bird.gain.gain.cancelScheduledValues(at); bird.gain.gain.setValueAtTime(0, at); bird.gain.gain.linearRampToValueAtTime(0.65, at + 0.02);
        bird.gain.gain.linearRampToValueAtTime(0, at + 0.12); bird.gain.gain.linearRampToValueAtTime(0.5, at + 0.17); bird.gain.gain.linearRampToValueAtTime(0, at + 0.3);
      }
      position(layers.wildlife, birdSide ? 25 : -27, 3, birdSide ? -21 : 3, camera, 0.016, 28, 4);
    };
    return { update, get stats() { return { enabled, calls, sources: sources.length, nodes: nodes.length, river: targets[0], waterfall: targets[1], motor: targets[2], crowd: targets[3], wildlife: targets[4], gain: bus.gain.value, motorPan: layers.motor.pan.pan.value }; }, dispose: () => { for (const source of sources) { source.stop(); source.disconnect(); } for (const node of nodes) node.disconnect(); } };
  };
  const create = () => {
    const heldRecordings = new Set();
    let context = null, master = null, musicGain = null, speechGain = null, voice = null, music = null, disposed = false;
    let muted = false, progress = 0, next = 0, queued = 0, musicVersion = 0, cue = -1, outdoors = false, stepAt = 0, stepSide = 0, steps = 0, ready = false, duration = 7, failure = "";
    let foot = null, footGain = null, ambience = null;
    let radioVolume = 0.075;
    let musicEnabled = true, ambientEnabled = true, hidden = false, radio = null, radioTimer = 0, radioWatchdog = 0, radioEpoch = 0, radioStatus = "Radio starts outdoors";
    const radioWanted = () => outdoors && musicEnabled && !muted && !hidden && !disposed;
    const stopRadio = () => {
      radioEpoch++; clearTimeout(radioTimer); clearTimeout(radioWatchdog); radioTimer = radioWatchdog = 0;
      if (radio) { radio.onplaying = radio.onerror = radio.onended = radio.onwaiting = null; radio.pause(); radio.removeAttribute("src"); radio.load(); }
    };
    const startRadio = () => {
      if (!radioWanted()) return;
      stopRadio(); const epoch = radioEpoch;
      if (!radio) { radio = new Audio(); radio.preload = "none"; }
      radio.volume = radioVolume; radio.muted = false; radioStatus = "Connecting to Noderunners Radio";
      const failed = () => {
        if (epoch !== radioEpoch || !radioWanted()) return;
        stopRadio(); radioStatus = "Radio offline - retrying; ambient sounds available";
        radioTimer = setTimeout(startRadio, 30000);
      };
      radio.onplaying = () => { if (epoch !== radioEpoch) return; clearTimeout(radioWatchdog); radioWatchdog = 0; radioStatus = "Live - Noderunners Radio"; };
      radio.onerror = radio.onended = failed;
      radio.onwaiting = () => { if (!radioWatchdog) radioWatchdog = setTimeout(failed, 12000); };
      radioWatchdog = setTimeout(failed, 12000);
      radio.src = "https://stream.noderunnersradio.com/stream?_=" + Date.now();
      radio.play().catch((error) => {
        if (epoch !== radioEpoch || !radioWanted()) return;
        if (error.name === "NotAllowedError") { stopRadio(); radioStatus = "Press Play radio to enable sound"; }
        else failed();
      });
    };
    const syncRadio = () => {
      if (radioWanted()) startRadio();
      else { stopRadio(); radioStatus = !outdoors ? "Radio starts outdoors" : !musicEnabled ? "Music off" : muted ? "All sound muted" : "Radio paused"; }
    };
    const clips = [null, null, null, null], versions = new Uint32Array(4), fired = new Uint8Array(4), triggers = new Float64Array([0.2, 0.4, 0.6, 0.8]);
    const mix = () => musicGain.gain.setTargetAtTime((outdoors || !musicEnabled ? 0 : 0.015 + progress * progress * 0.11) * (voice ? 0.144 : 1), context.currentTime, voice ? 0.025 : 0.35);
    const startMusic = (buffer) => {
      if (music) { music.stop(); music.disconnect(); }
      music = context.createBufferSource(); music.buffer = buffer; music.loop = true; music.connect(musicGain); music.start();
    };
    const decode = async (decoder, encoded) => {
      let bytes;
      if (BL.dsbAudioData.external) {
        const compressed = await recording(encoded, heldRecordings);
        if (disposed) return null;
        bytes = compressed.slice(0);
      } else {
        const binary = atob(encoded), decoded = new Uint8Array(binary.length);
        for (let j = 0; j < binary.length; j++) decoded[j] = binary.charCodeAt(j);
        bytes = decoded.buffer;
      }
      return decoder.decodeAudioData(bytes);
    };
    const schedule = () => {
      let total = 0; for (const clip of clips) if (clip) total += clip.duration;
      duration = Math.max(7, total + 7);
      let at = 2;
      for (let i = 0; i < clips.length; i++) { triggers[i] = at / duration; at += (clips[i] ? clips[i].duration : 0) + 1; }
    };
    const preload = async () => {
      const decoder = context;
      try {
        const results = await Promise.allSettled([
          ...BL.dsbAudioData.voices.map(async (encoded, i) => {
            const buffer = await decode(decoder, encoded);
            if (!disposed && buffer && versions[i] === 0) clips[i] = buffer;
          }),
          (async () => {
            const buffer = await decode(decoder, BL.dsbAudioData.music);
            if (!disposed && buffer && musicVersion === 0) startMusic(buffer);
          })()
        ]);
        if (results.some((result) => result.status === "rejected")) throw new Error("Entrance audio unavailable");
      } catch { if (!disposed) failure = "An entrance audio track could not be decoded."; }
      if (!disposed) { schedule(); ready = true; }
    };
    const ensure = () => {
      if (context || disposed || !window.AudioContext || navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
      context = new AudioContext(); master = context.createGain(); master.gain.value = muted ? 0 : 0.5; master.connect(context.destination);
      musicGain = context.createGain(); musicGain.gain.value = 0; musicGain.connect(master);
      speechGain = context.createGain(); speechGain.connect(master);
      foot = context.createOscillator(); foot.type = "sine";
      footGain = context.createGain(); footGain.gain.value = 0;
      foot.connect(footGain); footGain.connect(master); foot.start();
      if (outdoors) ambience = createAmbience(context, master);
      preload();
    };
    const gesture = () => { ensure(); if (context && context.state === "suspended") context.resume().catch(() => {}); };
    const playNext = () => {
      if (!context || !ready || voice || disposed || muted) return;
      while (next < queued) {
        const buffer = clips[next++];
        if (!buffer) continue;
        voice = context.createBufferSource(); voice.buffer = buffer; voice.connect(speechGain);
        voice.onended = () => { if (disposed) return; voice.disconnect(); voice = null; playNext(); mix(); };
        cue = next - 1; mix(); voice.start(); break;
      }
    };
    const update = (p, elapsed, walking = false) => {
      progress = p;
      if (ready || !window.AudioContext) for (let i = 0; i < 4; i++) if (p >= triggers[i] && !fired[i]) { fired[i] = 1; queued = i + 1; }
      if (muted) next = queued;
      if (!context) return;
      playNext();
      const at = context.currentTime;
      mix();
      if (!walking || muted || !ready) {
        stepAt = elapsed;
        footGain.gain.cancelScheduledValues(at); footGain.gain.setTargetAtTime(0, at, 0.02);
      } else if (elapsed >= stepAt) {
        stepAt = elapsed + 0.52; stepSide ^= 1; steps++;
        foot.frequency.cancelScheduledValues(at); foot.frequency.setValueAtTime(stepSide ? 115 : 100, at);
        foot.frequency.exponentialRampToValueAtTime(48, at + 0.1);
        footGain.gain.cancelScheduledValues(at); footGain.gain.setValueAtTime(0, at);
        footGain.gain.linearRampToValueAtTime(voice ? 0.018 : 0.03, at + 0.012);
        footGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.14);
        footGain.gain.setValueAtTime(0, at + 0.16);
      }
    };
    window.addEventListener("pointerdown", gesture); window.addEventListener("keydown", gesture);
    // Touch activation can arrive on release; ensure reuses the same audio graph.
    window.addEventListener("pointerup", gesture); window.addEventListener("touchend", gesture);
    // A click through the hub has already activated audio; direct visits wait for input.
    ensure();
    return { update, gesture, fired, get radioVolume() { return radioVolume; }, environment: (camera, boat, dt = 1 / 60, source = null) => {
      const p = camera.position, distance = source ? Math.hypot(p.x - source.x, p.y - source.y, p.z - source.z) : Infinity;
      const volume = 0.04 + 0.16 / (1 + (distance / 12) ** 2);
      radioVolume += (volume - radioVolume) * (1 - Math.exp(-Math.max(0, dt) * 4));
      if (radio) radio.volume = radioVolume;
      if (ambience) ambience.update(camera, boat, outdoors && ambientEnabled, muted); }, get ambience() { return ambience ? ambience.stats : null; }, arrive: () => { outdoors = true; if (context) { if (!ambience) ambience = createAmbience(context, master); mix(); } syncRadio(); }, toggleMusic: () => { gesture(); musicEnabled = !musicEnabled; if (context) mix(); syncRadio(); }, toggleAmbient: () => { gesture(); ambientEnabled = !ambientEnabled; }, playRadio: () => { gesture(); musicEnabled = true; syncRadio(); }, get musicEnabled() { return musicEnabled; }, get ambientEnabled() { return ambientEnabled; }, get radioStatus() { return radioStatus; }, get cue() { return cue; }, get musicDuration() { return music ? music.buffer.duration : 0; }, get levels() { return { music: musicGain ? musicGain.gain.value : 0, speech: speechGain ? speechGain.gain.value : 0, footsteps: footGain ? footGain.gain.value : 0, steps }; }, get ready() { return ready; }, get duration() { return duration; }, get durations() { return clips.map((clip) => clip ? clip.duration : 0); }, get failure() { return failure; }, visibility: (value) => { hidden = value; syncRadio(); if (!context) return; if (hidden) context.suspend().catch(() => {}); else context.resume().catch(() => {}); }, get pending() { return !muted && (!!voice || next < queued && !!context); }, get muted() { return muted; }, toggle: () => {
      gesture(); muted = !muted;
      if (muted && voice) { voice.onended = null; voice.stop(); voice.disconnect(); voice = null; next = queued; }
      if (master) master.gain.setTargetAtTime(muted ? 0 : 0.5, context.currentTime, 0.03);
      syncRadio(); return muted;
    }, dispose: () => {
      disposed = true;
      for (const entry of heldRecordings) {
        entry.users--;
        if (entry.pending && !entry.users) {
          if (recordings.get(entry.url) === entry) recordings.delete(entry.url);
          entry.controller.abort();
        }
      }
      heldRecordings.clear();
      stopRadio(); radio = null; window.removeEventListener("pointerdown", gesture); window.removeEventListener("keydown", gesture);
      window.removeEventListener("pointerup", gesture); window.removeEventListener("touchend", gesture);
      if (voice) { voice.onended = null; voice.stop(); voice.disconnect(); } if (music) { music.stop(); music.disconnect(); }
      if (foot) { foot.stop(); foot.disconnect(); footGain.disconnect(); }
      if (ambience) { ambience.dispose(); ambience = null; }
      if (context) context.close().catch(() => {});
      clips.fill(null); context = master = musicGain = speechGain = voice = music = foot = footGain = null;
    } };
  };
  BL.dsbAudio = { create };
})();
