// The pile's shared sound: a fire's crackle over an ember rumble, heard near the pile by everyone in
// the room at the same moment. Synthesized once into an eight-second buffer from a fixed seed, so the
// crackles fall at the same seconds on every machine, then looped; the playhead is set from the room's
// clock (`net.serverNow() - net.state.loopEpoch`) and re-seeked when it drifts past DRIFT_S. Gain eases
// from full within NEAR of the pile to nothing past FAR. No audio file: the loop is a few Web Audio nodes.
// The context opens only after a real gesture (`navigator.userActivation`), honours the page-wide mute
// (`oogaboogaland.audio`), plays only while the room is live, and `dispose` closes it.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const LOOP_S = 8, SEED = 0x0b1f17e, FADE_S = 0.05;
  const NEAR = 5, FAR = 16, MASTER = 0.175;
  const CRACKLES = 110, SNAPS = 9;
  const DRIFT_S = 0.25, DRIFT_CHECK_S = 2;
  const STORAGE_KEY = "oogaboogaland.audio";

  // One loop, built for the context's own sample rate. Timings come from the seed in seconds, so the
  // pops line up across machines whatever their rate; only the noise inside a pop differs.
  const bake = (ctx) => {
    const rate = ctx.sampleRate, n = Math.round(LOOP_S * rate), fade = Math.round(FADE_S * rate);
    const buffer = ctx.createBuffer(1, n, rate), data = buffer.getChannelData(0);
    const rand = BL.math.mulberry32(SEED);
    // The rumble: brown noise, slowly breathing, generated past the end so the seam can crossfade.
    const tail = new Float32Array(fade);
    let brown = 0;
    for (let i = 0; i < n + fade; i++) {
      brown = (brown + (rand() * 2 - 1) * 0.02) * 0.995;
      const t = i / rate;
      const v = brown * 3.2 * (0.75 + 0.25 * Math.sin(t * Math.PI * 2 / LOOP_S * 2));
      if (i < n) data[i] = v;
      else tail[i - n] = v;
    }
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      data[i] = data[i] * k + tail[i] * (1 - k);
    }
    // The crackle: short bright bursts of noise that die fast, and a few louder snaps.
    const pop = (at, amp, len) => {
      const start = Math.floor(at * rate), count = Math.floor(len * rate);
      let last = 0;
      for (let j = 0; j < count; j++) {
        const noise = rand() * 2 - 1, bright = noise - last;
        last = noise;
        data[(start + j) % n] += bright * amp * Math.exp(-j / (count * 0.18));
      }
    };
    for (let i = 0; i < CRACKLES; i++) pop(rand() * LOOP_S, 0.08 + rand() * 0.22, 0.003 + rand() * 0.012);
    for (let i = 0; i < SNAPS; i++) pop(rand() * LOOP_S, 0.45 + rand() * 0.3, 0.012 + rand() * 0.02);
    return buffer;
  };

  const create = () => {
    const net = BL.net;
    let ctx = null, master = null, zone = null, buffer = null, source = null;
    let startedAt = 0, startOffset = 0, checkIn = 0, level = -1, muted = false;
    try {
      muted = localStorage.getItem(STORAGE_KEY) === "off";
    } catch {
      muted = false;
    }

    const open = () => {
      if (ctx || typeof AudioContext === "undefined" || navigator.userActivation && !navigator.userActivation.hasBeenActive) return false;
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : MASTER;
      master.connect(ctx.destination);
      zone = ctx.createGain();
      zone.gain.value = 0;
      zone.connect(master);
      buffer = bake(ctx);
      return true;
    };

    // Where the room says the loop is now, in seconds into it.
    const phase = () => (((net.serverNow() - net.state.loopEpoch) / 1000) % LOOP_S + LOOP_S) % LOOP_S;

    const play = () => {
      if (source) {
        source.onended = null;
        source.stop();
        source.disconnect();
      }
      source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(zone);
      startOffset = phase();
      startedAt = ctx.currentTime;
      source.start(0, startOffset);
    };

    const stop = () => {
      if (!source) return;
      source.stop();
      source.disconnect();
      source = null;
    };

    /** Once a frame with where the listener stands. Writes the gain only when it moves. */
    const update = (dt, x, z) => {
      const live = net.state.room === "live" && net.state.loopEpoch > 0;
      if (!ctx && (!live || !open())) return;
      if (!live) {
        stop();
        return;
      }
      if (ctx.state === "suspended") ctx.resume();
      if (!source) {
        play();
        checkIn = DRIFT_CHECK_S;
      }
      checkIn -= dt;
      if (checkIn <= 0) {
        checkIn = DRIFT_CHECK_S;
        const at = (startOffset + ctx.currentTime - startedAt) % LOOP_S;
        let off = Math.abs(at - phase());
        if (off > LOOP_S / 2) off = LOOP_S - off;
        if (off > DRIFT_S) play();
      }
      const d = Math.hypot(x, z);
      const t = Math.min(1, Math.max(0, (d - NEAR) / (FAR - NEAR)));
      const gain = Math.round((1 - t) * (1 - t) * 100) / 100;
      if (gain !== level) {
        level = gain;
        zone.gain.setTargetAtTime(gain, ctx.currentTime, 0.15);
      }
    };

    const setMuted = (on) => {
      muted = !!on;
      if (master) master.gain.setTargetAtTime(muted ? 0 : MASTER, ctx.currentTime, 0.05);
    };

    const dispose = () => {
      if (ctx) ctx.close();
      ctx = master = zone = buffer = source = null;
      level = -1;
    };

    return { update, setMuted, dispose, get playing() { return !!source; }, get level() { return level; }, get playhead() { return source ? (startOffset + ctx.currentTime - startedAt) % LOOP_S : -1; } };
  };

  BL.pileAudio = { create, LOOP_S, NEAR, FAR };
})();
