// Aegean presentation of the shared chain weather. No network, clock or frame loop here.
(() => {
  "use strict";
  const BL = window.BL, { clamp, lerp, mulberry32 } = BL.math;
  const SKY_FIELDS = ["clear", "horizon", "zenith", "sky", "ground"];
  const PRESETS = {
    clear: { soak: 0, gale: 0, cloud: 0 },
    cloudy: { soak: 0, gale: .18, cloud: .65 },
    drizzle: { soak: .12, gale: .16, cloud: .4 },
    "light-rain": { soak: .3, gale: .3, cloud: .62 },
    rain: { soak: .5, gale: .45, cloud: .78 },
    storm: { soak: .9, gale: .9, cloud: 1 },
    wind: { soak: 0, gale: .85, cloud: .15 },
    haze: { soak: 0, gale: .08, cloud: .12 }
  };
  const override = params => params.has("debug") && Object.hasOwn(PRESETS, params.get("weather")) ? params.get("weather") : null;
  const create = ({ root, renderer, camera, land, water, params, audioFactory = null }) => {
    let mode = override(params), nextStrike = mode === "storm" ? 5 : 35, elapsed = 0, interior = false, muted = false;
    const random = mode ? mulberry32(4804) : Math.random;
    const field = { x: 0, y: 0, z: 0 }, centre = { x: 0, y: 35, z: 0 };
    const presentation = { field, cloudCentre: { x: 0, y: 265, z: 0 }, cloudRadius: 220, cloudScale: 3, cloud: 0, surf: 0 };
    const rainFloor = (x, z) => Math.max(-.3, land.heightAt(x, z));
    const shared = BL.weather.create({ root, renderer, camera, heightAt: rainFloor, centre, presentation, random, audioFactory });
    const wind = { x: 0, z: 0, strength: 0 };
    const state = { mode: mode || "clear", precipitation: 0, cloud: 0, wind, quality: renderer.quality, exterior: true, audioEnabled: false };
    const environment = { waveEnergy: 1, roughness: 0, glint: 1, foam: 1 };
    const apply = snapshot => shared.apply(mode ? { ...PRESETS[mode], presentation: true } : snapshot);
    muted = shared.state.muted;
    apply(BL.chain.snapshot);
    const unsubscribe = BL.chain.subscribe(apply);
    const gate = () => {
      state.exterior = !interior && !document.hidden;
      state.audioEnabled = state.exterior && !muted;
      shared.setExterior(state.exterior);
      shared.setMuted(muted);
    };
    document.addEventListener("visibilitychange", gate);
    gate();
    const setInterior = on => { interior = !!on; gate(); };
    const setMode = name => {
      if (!params.has("debug")) return false;
      mode = Object.hasOwn(PRESETS, name) ? name : null;
      apply(BL.chain.snapshot); nextStrike = elapsed + (mode === "storm" ? 5 : 35);
      return true;
    };
    const update = (dt, opts) => {
      elapsed += dt;
      // Keep precipitation near the eye even in the distant overview, not across the whole island.
      field.x = camera.position.x; field.y = camera.position.y - 8; field.z = camera.position.z;
      const prior = shared.state;
      presentation.cloud = mode ? PRESETS[mode].cloud : clamp(prior.soak * .7 + prior.wet * .3, 0, 1);
      if (prior.soak >= .65 && elapsed >= nextStrike) {
        shared.strike(); nextStrike = elapsed + (mode ? 24 : 30 + random() * 35);
      } else if (prior.soak < .65 && !mode) nextStrike = elapsed + 35;
      shared.update(dt, null); // The shared renderer's rainforest sky is replaced by this small adapter.
      const s = shared.state, cloud = s.deck, wet = s.wet;
      state.mode = mode || s.name; state.precipitation = wet; state.cloud = cloud; state.quality = renderer.quality;
      wind.x = s.windX; wind.z = s.windZ; wind.strength = s.gale;
      // sampleDaylight ran immediately before us: all modifiers start from fresh clock values.
      const direct = 1 - .76 * cloud, ambient = 1 - .22 * cloud;
      for (const key of SKY_FIELDS) {
        const c = opts[key], grey = c[0] * .299 + c[1] * .587 + c[2] * .114;
        for (let i = 0; i < 3; i++) c[i] = lerp(c[i], grey, cloud * .5) * ambient;
      }
      opts.directStrength *= direct; opts.directionalLightStrength = opts.directStrength;
      opts.shadowStrength *= direct; opts.bloomStrength *= 1 - .3 * cloud;
      opts.ambientFloor *= 1 - .12 * cloud;
      opts.clouds = cloud * .9;
      opts.stars *= 1 - cloud * .95;
      opts.fog = opts.horizon;
      opts.fogNear = mode === "haze" ? 65 : lerp(250, 85, cloud * wet);
      opts.fogFar = mode === "haze" ? 390 : lerp(600, 410, cloud * wet);
      if (s.flash > 0 && state.exterior) {
        const k = s.flash * .55;
        for (const key of SKY_FIELDS) {
          const c = opts[key]; for (let i = 0; i < 3; i++) c[i] += (1 - c[i]) * k;
        }
        opts.ambientFloor = lerp(opts.ambientFloor, .7, k);
      }
      environment.waveEnergy = 1 + s.gale * 1.4 + wet * .5;
      environment.roughness = s.gale * .6 + wet * .35;
      environment.glint = (1 - cloud * .8) * clamp(opts.sunStrength * 4, 0, 1);
      environment.foam = 1 + s.gale * .8 + wet * .8;
      water.setEnvironment(environment);
      // A quiet surf bed falls away with altitude; wind and rain strengthen it.
      presentation.surf = clamp(1 - Math.max(0, camera.position.y) / 80, 0, 1) * (.16 + s.gale * .22 + wet * .15);
    };
    return {
      state, shared, update, setInterior, setMode,
      toggleMuted: () => { muted = !muted; gate(); return muted; },
      strike: () => { if (params.has("debug") && shared.state.soak >= .65) shared.strike(); },
      dispose: () => { unsubscribe(); document.removeEventListener("visibilitychange", gate); shared.dispose(); }
    };
  };
  BL.dsbWeather = { create, override };
})();
