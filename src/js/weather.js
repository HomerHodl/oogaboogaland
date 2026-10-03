// The island's weather, derived from the chain snapshot rather than pinged by it. Two axes come out
// of chain.js — soak (how much of the backlog pays a fee) and gale (how fast transactions arrive) —
// and soak alone names one of six standing steps (dry, drizzle, light rain, rain, heavy rain, downpour); gale only sets the wind.
// Precipitation is a population held at a target, not a burst per transaction, so it rains for as
// long as the backlog stands; a block strikes.
//
// One fixed-capacity instanced batch carries the rain. Bolts are eight jagged variants built once at
// boot and picked at random, so a strike allocates nothing. The sky is written over the daylight clock's colours after it
// samples; the clock, its sun, moon, phases and factors are never touched, and a clear sky leaves
// every sampled value exactly as it was.
//
// The weather is a cell standing over one place, not a curtain that follows the camera. `create`
// takes the cell's `centre` and the `heightAt` its rain lands on; precipitation falls inside FIELD_R
// of that centre, sky, fog and flash scale by `near` (full within NEAR_FULL, gone by NEAR_NONE) and
// the sound by its own shorter HEARD_FULL/HEARD_NONE, so the rain is heard only around the rainforest.
//
// `stepFor(soak, prev)` climbs a step as soon as soak reaches it and leaves it only HYSTERESIS below.
// How much falls, the drop size and the sky's grey follow the continuous `wetAt(soak)` through the
// steps' own points, so a step names the weather while the rain only eases.
// Lightning is for new blocks only: every block strikes whatever the weather is doing, nothing else does; a bolt
// takes a random turn, scale and mirror. The rain batch is tier-scaled (720/480/260, 120 on Canvas
// 2D), and a streak lies along its drop's velocity, so its head is upwind and the rain leans the way
// the wind travels. The sky goes through `cloudFor` on `wetAt`, the same clear band, after
// `daylight.sample`. Audio is background: MASTER sits under the rally and drop engines and a strike
// is a few times the rain, never the page's loudest thing.
//
// Exports STEPS, stepFor, wetAt, cloudFor and create; an instance offers apply, strike, update,
// setMuted, dispose, state, active and stats.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { models, math } = BL;
  const { createNode, addChild, removeChild } = BL.scene;
  const { clamp, lerp, mulberry32 } = math;

  // Tier-scaled populations: the batch is one draw call at any size, the cost is the simulation.
  const CAP = { high: 720, medium: 480, low: 260 }, CAP_CANVAS = 120;
  // The weather is a cell standing over one place, not a curtain that follows the camera. It falls
  // inside FIELD_R of its centre and the sky only greys for a camera close enough to be under it.
  const FIELD_R = 16, FIELD_TOP = 17, FIELD_SPREAD = 7, RECYCLE_BELOW = 8;
  // Full under the islet, gone by the far end of its bridge, so a storm over there never greys the
  // sky over here: the home island is ~58 out from the cell and the rim head ~29.
  // A distant bolt still flickers the sky and still rolls, both faintly; never zero, because an
  // exponential gain ramp cannot be given one.
  const NEAR_FULL = 16, NEAR_NONE = 30, DISTANT_FLASH = 0.3, DISTANT_THUNDER = 0.12;
  // Sound carries less far than the sky greys, and deliberately so: the rain is only heard around the
  // rainforest itself. The islet is 13 across from its centre and the bridge's near end is 29 out, so
  // full on the island, fading over the far half of the crossing and silent before the home rim.
  const HEARD_FULL = 14, HEARD_NONE = 24;
  // A fixed deck of cloud nodes over the cell, sharing one cached geometry so the whole sky above the
  // island is a single draw call. They are built once and never allocated again: coverage is scale and
  // visibility, colour is a geometry swap, and a strike lights them through each node's own glow.
  // A rainforest is never without cloud, so the deck is always there: CLOUD_FLOOR of it stands even
  // under a clear sky and the weather only thickens and darkens it. Every node shares one cached
  // geometry, so the whole deck is a single instanced draw call whatever its size.
  const CLOUD = { high: 48, medium: 36, low: 22 }, CLOUD_CANVAS = 14;
  const CLOUD_R = 26, CLOUD_LIFT = 3.2, CLOUD_DRIFT = 0.06, CLOUD_EASE = 0.7;
  const CLOUD_FLOOR = 0.62, CLOUD_TIERS = 3;
  // Drops grow with the rain: fine in a drizzle, fat in a downpour.
  const DROP_MIN = 0.7, DROP_MAX = 4, DROP_LIFT = 0.7;
  const RAIN_FALL = 11, RAIN_FALL_PER_SIZE = 3;
  const SPLASH_SIZE = 1.4;
  const WIND_MAX = 9, WIND_TURN = 0.05;
  const FLASH_MAX = 0.85, FLASH_TAU = 0.12, BOLT_SHOW = 0.25, BOLT_RANGE = 18, BOLT_HEIGHT = 26, BOLT_VARIANTS = 8;
  const THUNDER_DELAY_MIN = 0.5, THUNDER_DELAY_SPREAD = 1;
  // Weather is background, not an event: the whole bed sits well under the rally and drop engines, and
  // a strike is only a few times the rain rather than the loudest thing on the page.
  const STORAGE_KEY = "oogaboogaland.audio", MASTER = 0.3, NOISE_SECONDS = 2;
  const EASE = 1.5, DEAD_BAND = 0.02;
  // The sky stays the clock's until the overcast passes a band, wider by day, so a shower can fall
  // under a clear noon sky and a quiet night stays a clear starry night.
  const CLEAR_NIGHT = 0.25, CLEAR_DAY = 0.55;
  const OVERCAST_MIX = 0.7, OVERCAST_DARKEN = 0.22, OVERCAST_DIM = 0.45;
  const OVERCAST_TINT = [0.9, 0.93, 1];
  // Clear air still hazes toward the horizon, so the far islets and clouds sit back; rain pulls it in, but only
  // so far: the fog is full colour at its far end, and a rain range ending at 150 had every far islet and boat
  // turn to pale grey near the rainforest. Rain thickens the haze without ever washing the horizon out.
  const FOG_NEAR = 60, FOG_FAR = 560, FOG_OFF_NEAR = 90, FOG_OFF_FAR = 620;

  // Six standing steps on soak. `from` is where a step begins, `wet` how much falls there.
  const STEPS = [
    { name: "dry", from: 0, wet: 0 },
    { name: "drizzle", from: 0.1, wet: 0.12 },
    { name: "light rain", from: 0.25, wet: 0.3 },
    { name: "rain", from: 0.45, wet: 0.5 },
    { name: "heavy rain", from: 0.65, wet: 0.75 },
    { name: "downpour", from: 0.85, wet: 1 }
  ];
  // A step is climbed as soon as soak reaches it and left only once soak falls HYSTERESIS below it,
  // so a backlog hovering on a boundary holds its step instead of flicking between two.
  const HYSTERESIS = 0.05;
  const stepFor = (soak, prev = 0) => {
    let i = prev;
    while (i < STEPS.length - 1 && soak >= STEPS[i + 1].from) i++;
    while (i > 0 && soak < STEPS[i].from - HYSTERESIS) i--;
    return i;
  };
  // How much falls, continuous through the steps' own points: a step names the weather, while the rain
  // itself only ever eases. Nothing below drizzle, all of it at downpour.
  const wetAt = (soak) => {
    if (soak < STEPS[1].from) return 0;
    let i = 1;
    while (i < STEPS.length - 1 && soak >= STEPS[i + 1].from) i++;
    if (i === STEPS.length - 1) return 1;
    return lerp(STEPS[i].wet, STEPS[i + 1].wet, (soak - STEPS[i].from) / (STEPS[i + 1].from - STEPS[i].from));
  };
  const cloudFor = (overcast, day) => {
    const band = lerp(CLEAR_NIGHT, CLEAR_DAY, clamp(day, 0, 1));
    return clamp((overcast - band) / (1 - band), 0, 1);
  };
  // Desaturate toward a cool grey of the colour's own brightness, so day stays bright and night dark.
  const greyen = (c, k, tint) => {
    if (!c) return;
    const grey = (c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114) * (1 - OVERCAST_DARKEN * k);
    c[0] += (grey * tint[0] - c[0]) * k;
    c[1] += (grey * tint[1] - c[1]) * k;
    c[2] += (grey * tint[2] - c[2]) * k;
  };
  const brighten = (c, k) => {
    if (!c) return;
    c[0] += (1 - c[0]) * k;
    c[1] += (1 - c[1]) * k;
    c[2] += (1 - c[2]) * k;
  };

  // A drop is a streak, not a bar: the per-drop size scales this cross-section, so a fat one at
  // DROP_MAX is still thin enough to read as rain rather than as a falling block.
  const rainDrop = models.cached(() => models.noShadow(models.box({ w: 0.024, h: 0.6, d: 0.024, color: "#c6dbee", emissive: 0.45 })));
  const SPLASH = [models.particleGeometry("#d8e8f4", 0.07, 0.6)];
  // Two builds of the same puff: fair weather and a bruised storm deck. Swapping the geometry on every
  // cloud node recolours the whole sky over the island without touching a vertex.
  const puff = (seed, tone) => models.cached(() => {
    const rand = mulberry32(seed), geos = [];
    for (let i = 0; i < 7; i++) {
      const a = rand() * Math.PI * 2, r = rand() * 3.4;
      // Depth against width: a puff barely a third as tall as it is wide reads as a cut-out.
      const w = 2.6 + rand() * 3.2, h = 1.9 + rand() * 1.4;
      geos.push(models.box({ w, h, d: w * (0.7 + rand() * 0.4), color: i % 2 ? tone[0] : tone[1], emissive: tone[2], offset: { x: Math.cos(a) * r, y: rand() * 0.7, z: Math.sin(a) * r } }));
    }
    const geometry = models.noShadow(models.merge(...geos));
    geometry.cutawayHide = true;
    // Clouds fade independently of the scanning rock/ceiling cut planes.
    geometry.cutawayPreserve = true;
    return geometry;
  });
  const CLOUD_FAIR = puff(3301, ["#f2f5f8", "#dfe6ee", 0.12]);
  const CLOUD_GREY = puff(3301, ["#6d737c", "#565c66", 0.05]);

  // Eight forked bolts, unit height, each from its own seed: a jagged trunk with three branches that
  // fork again. Built once at boot and picked at random with a random turn, scale and mirror, so a
  // strike costs no geometry and no two look alike.
  const bolts = models.cached(() => {
    const out = [];
    for (let v = 0; v < BOLT_VARIANTS; v++) {
      const rand = mulberry32(1013 + v * 977);
      const jag = (x0, z0, y0, y1, steps, spread) => {
        const points = [];
        for (let i = 0; i <= steps; i++) {
          const t = i / steps, ends = i && i < steps ? 1 : 0.25;
          points.push({
            x: x0 + (rand() - 0.5) * spread * ends,
            y: lerp(y0, y1, t),
            z: z0 + (rand() - 0.5) * spread * ends
          });
        }
        return points;
      };
      const trunk = jag(0, 0, 1, 0, 12, 0.22);
      const geos = [models.polyline({ points: trunk, color: "#eef5ff", emissive: 1 })];
      for (let b = 0; b < 3; b++) {
        const at = trunk[3 + b * 3], drop = 0.18 + rand() * 0.22;
        const arm = jag(at.x + (rand() - 0.5) * 0.3, at.z + (rand() - 0.5) * 0.3, at.y, at.y - drop, 4, 0.16);
        geos.push(models.polyline({ points: [at, ...arm.slice(1)], color: "#dbe9ff", emissive: 1 }));
        if (rand() < 0.55) {
          const fork = arm[2];
          geos.push(models.polyline({ points: [fork, ...jag(fork.x + (rand() - 0.5) * 0.25, fork.z, fork.y, fork.y - drop * 0.6, 3, 0.12).slice(1)], color: "#cfe0ff", emissive: 1 }));
        }
      }
      out.push(models.merge(...geos));
    }
    return out;
  });
  // The flash strobes twice, then decays: full, dip, second bright, tail.
  const flashAt = (t) => t < 0.08 ? 1 : t < 0.14 ? 0.25 : t < 0.22 ? 0.85 : 0.85 * Math.exp(-(t - 0.22) / FLASH_TAU);

  const create = ({ root, renderer, camera, heightAt, fx = null, centre, presentation = null, random = Math.random }) => {
    // Optional presentation keeps the shared state, pool, clouds and sound reusable by large worlds.
    const field = presentation ? presentation.field : centre;
    const cloudCentre = presentation ? presentation.cloudCentre : centre;
    const cloudRadius = presentation ? presentation.cloudRadius : CLOUD_R;
    const cloudScale = presentation ? presentation.cloudScale : 1;
    const cloudFloor = presentation ? 0 : CLOUD_FLOOR;
    let exterior = true;
    const canvas2d = renderer.kind === "canvas2d";
    const cap = canvas2d ? CAP_CANVAS : (CAP[renderer.quality] || CAP.medium);
    const node = createNode({ geometry: rainDrop(), instanceData: new Float32Array(cap * 20), instanceCount: 0, drawInstanceCount: 0, instanceVersion: 0, fixedInstanceCapacity: true });
    const x = new Float32Array(cap), y = new Float32Array(cap), z = new Float32Array(cap);
    const w = new Float32Array(cap), h = new Float32Array(cap), vy = new Float32Array(cap);
    let count = 0;
    let flash = 0, flashT = -1, boltT = -1, thunderAt = -1, strikes = 0, thunders = 0, boltVariant = -1;
    // Everything the feed sets is a target; the live value walks there so nothing snaps.
    let soak = 0, soakTarget = 0, gale = 0, galeTarget = 0, wet = 0;
    let cloud = 0, near = 0, heard = 0, windAngle = random() * Math.PI * 2, windX = 0, windZ = 0;
    let stepAt = 0, state = STEPS[0], applied = false;
    const fog = new Float32Array(3);
    const variants = bolts();
    const boltNode = createNode({ geometry: variants[0], visible: false });
    addChild(root, node);
    addChild(root, boltNode);
    // The cloud deck: fixed nodes, seeded once, drifting with the wind and wrapping inside the cell.
    const cloudRand = mulberry32(8821);
    // The fallback rasterizes every face in software, so it carries a thinner deck for the same look.
    const cloudN = canvas2d ? CLOUD_CANVAS : (CLOUD[renderer.quality] || CLOUD.medium);
    const clouds = [], cloudX = new Float32Array(cloudN), cloudZ = new Float32Array(cloudN), cloudBase = new Float32Array(cloudN);
    for (let i = 0; i < cloudN; i++) {
      const a = cloudRand() * Math.PI * 2, r = Math.sqrt(cloudRand()) * cloudRadius;
      cloudX[i] = Math.cos(a) * r;
      cloudZ[i] = Math.sin(a) * r;
      cloudBase[i] = 0.7 + cloudRand() * 0.85;
      // Three loose tiers so the deck has depth instead of reading as one flat lid.
      const tier = i % CLOUD_TIERS;
      const cloud = createNode({
        position: { x: cloudCentre.x + cloudX[i], y: cloudCentre.y + FIELD_TOP + CLOUD_LIFT + tier * 2.6 + cloudRand() * 1.8, z: cloudCentre.z + cloudZ[i] },
        rotation: { x: 0, y: cloudRand() * Math.PI * 2, z: 0 },
        geometry: CLOUD_FAIR(), scale: { x: 0.01, y: 0.01, z: 0.01 }, visible: false
      });
      clouds.push(cloud);
      addChild(root, cloud);
    }
    let cloudCover = 0, cloudForm = "fair";

    // Sound: the context opens only after a real gesture, so weather on a fresh page stays silent.
    let ctx = null, master = null, noise = null, rainGain = null, windGain = null, surfGain = null, thunderGain = null, thunderFilter = null, muted = false, audioConnected = false;
    try {
      muted = localStorage.getItem(STORAGE_KEY) === "off";
    } catch {
    }
    const initAudio = () => {
      if (!exterior || ctx || typeof AudioContext === "undefined" || navigator.userActivation && !navigator.userActivation.hasBeenActive) return false;
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = muted || !exterior ? 0 : MASTER;
      master.connect(ctx.destination); audioConnected = true;
      const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * NOISE_SECONDS), ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      noise = ctx.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;
      const hiss = ctx.createBiquadFilter();
      hiss.type = "bandpass";
      hiss.frequency.value = 2600;
      hiss.Q.value = 0.5;
      rainGain = ctx.createGain();
      rainGain.gain.value = 0;
      noise.connect(hiss);
      hiss.connect(rainGain);
      rainGain.connect(master);
      // The gale rides the same loop through a low band, so the wind howls without a second buffer.
      const howl = ctx.createBiquadFilter();
      howl.type = "bandpass";
      howl.frequency.value = 420;
      howl.Q.value = 0.8;
      windGain = ctx.createGain();
      windGain.gain.value = 0;
      noise.connect(howl);
      howl.connect(windGain);
      windGain.connect(master);
      // One reusable thunder voice, never a timeout or a new graph per strike.
      thunderFilter = ctx.createBiquadFilter(); thunderFilter.type = "lowpass"; thunderFilter.Q.value = 1.2;
      thunderGain = ctx.createGain(); thunderGain.gain.value = 0;
      noise.connect(thunderFilter); thunderFilter.connect(thunderGain); thunderGain.connect(master);
      if (presentation) {
        const surf = ctx.createBiquadFilter(); surf.type = "lowpass"; surf.frequency.value = 580;
        surfGain = ctx.createGain(); surfGain.gain.value = 0;
        noise.connect(surf); surf.connect(surfGain); surfGain.connect(master);
      }
      noise.start();
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      return true;
    };
    // The listener's own distance, read when a roll arrives rather than when its bolt was lit.
    const heardNow = () => {
      if (presentation) return exterior ? 1 : 0;
      const dx = camera.target.x - centre.x, dz = camera.target.z - centre.z;
      const k = clamp((HEARD_NONE - Math.sqrt(dx * dx + dz * dz)) / (HEARD_NONE - HEARD_FULL), 0, 1);
      return k * k;
    };
    const rumble = () => {
      if (!exterior || muted || (!initAudio() && !ctx)) return;
      thunders++;
      const t = ctx.currentTime;
      // Distance takes the crack off a strike before it takes the roll: the opening band falls toward
      // the tail's own frequency as you walk away, so thunder from across the water is a low rumble
      // while thunder overhead still snaps. `near` is read when the roll arrives, not when it was lit.
      const level = lerp(DISTANT_THUNDER, 1, heardNow());
      const low = thunderFilter, g = thunderGain;
      low.frequency.cancelScheduledValues(t); g.gain.cancelScheduledValues(t);
      low.frequency.setValueAtTime(lerp(140, 420, level), t);
      low.frequency.exponentialRampToValueAtTime(90, t + 2.8);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.28 * level, t + 0.06);
      g.gain.exponentialRampToValueAtTime(0.11 * level, t + 0.5);
      g.gain.exponentialRampToValueAtTime(0.2 * level, t + 0.9);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    };

    // One particle placed at the top of the field, in a disk around the camera target.
    const seed = (i, fromTop) => {
      const t = field;
      const a = random() * Math.PI * 2, r = Math.sqrt(random()) * FIELD_R;
      x[i] = t.x + Math.cos(a) * r;
      z[i] = t.z + Math.sin(a) * r;
      y[i] = fromTop ? t.y + FIELD_TOP + random() * FIELD_SPREAD : t.y + random() * (FIELD_TOP + FIELD_SPREAD) - RECYCLE_BELOW;
      const size = clamp(DROP_MIN + random() * 1.1 + wet * DROP_LIFT, DROP_MIN, DROP_MAX);
      w[i] = presentation ? size * .45 : size;
      h[i] = (0.8 + size * 0.35) * (presentation ? .55 : 1);
      vy[i] = RAIN_FALL + RAIN_FALL_PER_SIZE * size;
    };
    // The feed's standing view of the chain. Targets only; `update` walks the live values there.
    const apply = (snapshot) => {
      if (!snapshot) return;
      soakTarget = clamp(Number.isFinite(snapshot.soak) ? snapshot.soak : 0, 0, 1);
      galeTarget = clamp(Number.isFinite(snapshot.gale) ? snapshot.gale : 0, 0, 1);
      if (!applied) {
        applied = true;
        soak = soakTarget;
        gale = galeTarget;
      }
    };
    const strike = () => {
      strikes++;
      flashT = 0;
      boltT = 0;
      thunderAt = exterior ? THUNDER_DELAY_MIN + random() * THUNDER_DELAY_SPREAD : -1;
      const a = random() * Math.PI * 2, r = 6 + random() * (BOLT_RANGE - 6), t = centre;
      const bx = t.x + Math.cos(a) * r, bz = t.z + Math.sin(a) * r;
      const ground = heightAt(bx, bz);
      boltVariant = (random() * variants.length) | 0;
      boltNode.geometry = variants[boltVariant];
      boltNode.position.x = bx;
      boltNode.position.z = bz;
      boltNode.position.y = ground;
      boltNode.rotation.y = random() * Math.PI * 2;
      // A mirrored x flips the fork side, doubling the variants for free.
      boltNode.scale.x = (4 + random() * 3) * (random() < 0.5 ? -1 : 1);
      boltNode.scale.z = 4 + random() * 3;
      boltNode.scale.y = t.y + FIELD_TOP + BOLT_HEIGHT - ground;
      boltNode.visible = true;
    };

    const walk = (value, target, step) => value > target ? Math.max(target, value - step) : Math.min(target, value + step);

    const update = (dt, opts) => {
      const previousCount = node.instanceCount;
      const tierCap = Math.min(cap, canvas2d ? CAP_CANVAS : (CAP[renderer.quality] || CAP.medium));
      const tierClouds = Math.min(cloudN, canvas2d ? CLOUD_CANVAS : (CLOUD[renderer.quality] || CLOUD.medium));
      if (presentation) initAudio();
      const step = dt / EASE;
      // How far under the cell the listener is. `camera.target` is the Ooga you are driving when you
      // are in one and the look-at point when you are flying free, so one value serves both. The sky,
      // the fog, the flash and the sound all read it, so they cannot disagree about where you stand.
      const cx = camera.target.x - centre.x, cz = camera.target.z - centre.z;
      const away = Math.sqrt(cx * cx + cz * cz);
      near = clamp((NEAR_NONE - away) / (NEAR_NONE - NEAR_FULL), 0, 1);
      // Loudness on its own shorter curve, then squared: audible only around the rainforest, already
      // almost gone halfway back over the bridge, and exactly zero anywhere else in the world.
      const reach = clamp((HEARD_NONE - away) / (HEARD_NONE - HEARD_FULL), 0, 1);
      heard = presentation ? (exterior ? 1 : 0) : reach * reach;
      if (Math.abs(soak - soakTarget) > DEAD_BAND) soak = walk(soak, soakTarget, step); else soak = soakTarget;
      if (Math.abs(gale - galeTarget) > DEAD_BAND) gale = walk(gale, galeTarget, step); else gale = galeTarget;
      state = STEPS[stepAt = stepFor(soak, stepAt)];
      wet = wetAt(soak);

      // Wind turns slowly and never snaps; the gale sets its strength.
      windAngle += WIND_TURN * dt;
      const windSpeed = WIND_MAX * gale * 0.7 * (0.6 + 0.4 * wet);
      windX = Math.cos(windAngle) * windSpeed;
      windZ = Math.sin(windAngle) * windSpeed;

      // The deck above: how much of it is there, what colour, and how hard it is lit from below.
      const wantCover = presentation ? presentation.cloud : clamp(wet * 0.55 + soak * 0.45, 0, 1);
      cloudCover += (wantCover - cloudCover) * Math.min(1, dt / CLOUD_EASE);
      const wantForm = cloudCover < 0.18 ? "fair" : "grey";
      if (wantForm !== cloudForm) {
        cloudForm = wantForm;
        const geometry = wantForm === "fair" ? CLOUD_FAIR() : CLOUD_GREY();
        for (let i = 0; i < cloudN; i++) clouds[i].geometry = geometry;
      }
      const shown = Math.round(tierClouds * clamp(cloudFloor + cloudCover * (1 - cloudFloor), 0, 1));
      for (let i = 0; i < cloudN; i++) {
        const cloud = clouds[i];
        if (i >= shown) {
          cloud.visible = false;
          continue;
        }
        cloud.visible = true;
        cloudX[i] += windX * CLOUD_DRIFT * dt;
        cloudZ[i] += windZ * CLOUD_DRIFT * dt;
        // Wrap across the cell rather than drifting away, so the deck never leaves and never grows.
        const cr = Math.hypot(cloudX[i], cloudZ[i]);
        if (cr > cloudRadius) {
          cloudX[i] = -cloudX[i] / cr * cloudRadius;
          cloudZ[i] = -cloudZ[i] / cr * cloudRadius;
        }
        cloud.position.x = cloudCentre.x + cloudX[i];
        cloud.position.z = cloudCentre.z + cloudZ[i];
        const k = cloudBase[i] * (0.8 + cloudCover * 0.6) * cloudScale;
        cloud.scale.x = cloud.scale.z = k;
        cloud.scale.y = k * 0.6;
        // Lightning lights the deck from inside before it lights anything else.
        cloud.glow = flash > 0 ? flash * 0.85 : 0;
      }

      // The population is the weather: hold `target` particles alive and the rain lasts as long as
      // the backlog stands, instead of stopping the moment a transaction stops arriving.
      const target = exterior ? Math.min(tierCap, Math.round(tierCap * clamp(wet * (0.65 + 0.35 * soak), 0, 1))) : 0;
      if (!exterior) count = 0;
      count = Math.min(count, tierCap);
      if (count < target) {
        // Fill over about a second so a change eases in rather than popping a full field.
        const room = Math.min(target - count, Math.max(1, Math.ceil(cap * dt)));
        for (let n = 0; n < room; n++, count++) seed(count, !applied || previousCount > 0);
      }

      const t = field, data = node.instanceData;
      const floorY = t.y - RECYCLE_BELOW;
      for (let i = 0; i < count; i++) {
        y[i] -= vy[i] * dt;
        x[i] += windX * dt;
        z[i] += windZ * dt;
        const ground = heightAt(x[i], z[i]);
        if (y[i] <= ground || y[i] < floorY) {
          if (fx && w[i] >= SPLASH_SIZE && y[i] <= ground) fx.burst(x[i], y[i] + 0.05, z[i], 2, SPLASH, 0.9);
          // Over target the population shrinks by retiring on landing; otherwise it recycles to the top.
          if (count > target) {
            count--;
            x[i] = x[count]; y[i] = y[count]; z[i] = z[count];
            w[i] = w[count]; h[i] = h[count]; vy[i] = vy[count];
            i--;
            continue;
          }
          seed(i, true);
        }
        // Drops outside the field have drifted past the camera; bring them round rather than lose them.
        const ox = x[i] - t.x, oz = z[i] - t.z;
        if (ox * ox + oz * oz > FIELD_R * FIELD_R * 2.25) seed(i, true);

        const o = i * 20, s = w[i] * 0.5 + 0.5, hy = h[i];
        // A streak lies along the drop's own velocity: down at vy, carried sideways at the wind's speed.
        // Bottom to top is the reverse of that travel, so the head of the streak is upwind of its tail
        // and the rain leans the way the wind is going. The ratio is wind over fall speed, so a heavy
        // drop falls straighter through the same gale than a light one, and the lean is capped so a
        // squall never lays the rain flat.
        const tiltX = clamp(-windX / (vy[i] || 1), -0.8, 0.8);
        const tiltZ = clamp(-windZ / (vy[i] || 1), -0.8, 0.8);
        data[o] = s; data[o + 1] = 0; data[o + 2] = 0; data[o + 3] = 0;
        data[o + 4] = tiltX * hy; data[o + 5] = hy; data[o + 6] = tiltZ * hy; data[o + 7] = 0;
        data[o + 8] = 0; data[o + 9] = 0; data[o + 10] = s; data[o + 11] = 0;
        data[o + 12] = x[i]; data[o + 13] = y[i]; data[o + 14] = z[i]; data[o + 15] = 1;
        data[o + 16] = 1; data[o + 17] = 0; data[o + 18] = 0; data[o + 19] = 0;
      }
      node.instanceCount = node.drawInstanceCount = count;
      if (count || previousCount) node.instanceVersion++;
      if (surfGain) surfGain.gain.setTargetAtTime(presentation.surf * heard * 0.09, ctx.currentTime, 0.3);
      if (rainGain) {
        rainGain.gain.setTargetAtTime(Math.min(1, count / (tierCap * 0.6)) * 0.09 * heard, ctx.currentTime, 0.25);
        windGain.gain.setTargetAtTime(gale * (wet > 0 ? 0.07 : 0.02) * heard, ctx.currentTime, 0.4);
      }

      if (boltT >= 0) {
        boltT += dt;
        if (boltT > BOLT_SHOW) {
          boltT = -1;
          boltNode.visible = false;
        }
      }
      if (thunderAt >= 0) {
        thunderAt -= dt;
        if (thunderAt < 0) {
          thunderAt = -1;
          rumble();
        }
      }
      flash = 0;
      if (flashT >= 0) {
        flashT += dt;
        flash = flashAt(flashT);
        if (flash < 0.01) {
          flash = 0;
          flashT = -1;
        }
      }

      // The storm is a place, so standing on the far side of the world leaves your own sky exactly as
      // the clock painted it while you watch it rain over there.
      if (opts) {
        // A clear sky leaves the clock's colours and light exactly as sampled, under the clear-air haze. The
        // sky greys with how hard it is raining, so a drizzle falls under the clock's own sky.
        cloud = cloudFor(wet, opts.day) * near;
        if (cloud > 0.02) {
          const k = cloud * OVERCAST_MIX;
          greyen(opts.clear, k, OVERCAST_TINT); greyen(opts.horizon, k, OVERCAST_TINT); greyen(opts.zenith, k, OVERCAST_TINT);
          greyen(opts.sky, k, OVERCAST_TINT); greyen(opts.ground, k, OVERCAST_TINT); greyen(opts.direct, k, OVERCAST_TINT);
          opts.directStrength *= 1 - cloud * (1 - OVERCAST_DIM);
        }
        fog[0] = opts.horizon[0]; fog[1] = opts.horizon[1]; fog[2] = opts.horizon[2];
        opts.fog = fog;
        opts.fogNear = lerp(FOG_OFF_NEAR, FOG_NEAR, cloud);
        opts.fogFar = lerp(FOG_OFF_FAR, FOG_FAR, cloud);
        opts.clouds = 0.42 + cloud * 0.5;
      }
      if (flash > 0 && opts) {
        // A distant bolt still flickers the sky, just faintly; underneath it the whole sky goes white.
        const k = flash * FLASH_MAX * lerp(DISTANT_FLASH, 1, near);
        brighten(opts.clear, k); brighten(opts.horizon, k); brighten(opts.zenith, k);
        brighten(opts.sky, k); brighten(opts.ground, k); brighten(opts.direct, k);
        opts.ambientFloor = lerp(opts.ambientFloor, 0.9, k);
        opts.directStrength *= 1 + k;
      }
    };

    const setMuted = (on) => {
      if (muted === !!on) return;
      muted = !!on;
      if (master) master.gain.setTargetAtTime(muted || !exterior ? 0 : MASTER, ctx.currentTime, 0.05);
    };
    const setExterior = (on) => {
      if (exterior === !!on) return;
      exterior = !!on;
      if (!exterior) {
        thunderAt = -1; count = 0; node.instanceCount = node.drawInstanceCount = 0; node.instanceVersion++;
        if (thunderGain) { thunderGain.gain.cancelScheduledValues(ctx.currentTime); thunderGain.gain.setValueAtTime(0, ctx.currentTime); }
      }
      if (master) {
        // Disconnect the one exterior bus as well as zeroing its envelope. AudioParam.value
        // can lag a render quantum; a closed gate must not depend on that clock boundary.
        if (!exterior && audioConnected) { master.disconnect(); audioConnected = false; }
        if (exterior && !audioConnected) { master.connect(ctx.destination); audioConnected = true; }
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setValueAtTime(muted || !exterior ? 0 : MASTER, ctx.currentTime);
      }
    };
    const dispose = () => {
      removeChild(root, node);
      removeChild(root, boltNode);
      for (const cloud of clouds) removeChild(root, cloud);
      clouds.length = 0;
      count = 0; audioConnected = false;
      if (ctx) { noise.stop(); ctx.close().catch(() => {}); }
      ctx = master = noise = rainGain = windGain = surfGain = thunderGain = thunderFilter = null;
    };
    const state_ = {
      get name() { return state.name; },
      get drops() { return count; },
      get capacity() { return cap; },
      get flash() { return flash; },
      get bolt() { return boltT >= 0; },
      get boltVariant() { return boltVariant; },
      get boltVariants() { return variants.length; },
      get thunderPending() { return thunderAt >= 0; },
      get strikes() { return strikes; },
      get thunders() { return thunders; },
      get soak() { return soak; },
      get wet() { return wet; },
      get step() { return stepAt; },
      get gale() { return gale; },
      get cloud() { return cloud; },
      get deck() { return cloudCover; },
      get deckForm() { return cloudForm; },
      get deckShown() { return clouds.reduce((n, c) => n + (c.visible ? 1 : 0), 0); },
      get deckCapacity() { return cloudN; },
      get near() { return near; },
      // How much of the weather's sound reaches the listener, and what the bed is actually playing at.
      get heard() { return heard; },
      get rainLevel() { return rainGain ? rainGain.gain.value : 0; },
      get windLevel() { return windGain ? windGain.gain.value : 0; },
      get audible() { return !!ctx; },
      get centre() { return centre; },
      get wind() { return Math.hypot(windX, windZ); },
      // The wind's own travel, and the streak basis a drop is drawn along, so the lean can be checked
      // against the direction rather than eyeballed.
      get windX() { return windX; },
      get windZ() { return windZ; },
      lean: (i) => {
        if (i >= count) return null;
        const o = i * 20, d = node.instanceData;
        return { x: d[o + 4], y: d[o + 5], z: d[o + 6] };
      },
      get applied() { return applied; },
      get audio() { return !!ctx; },
      get muted() { return muted; },
      get exterior() { return exterior; },
      get masterLevel() { return master && audioConnected ? master.gain.value : 0; },
      drop: (i) => i < count ? { x: x[i], y: y[i], z: z[i], size: w[i], fall: vy[i] } : null
    };
    return {
      apply, strike, update, setMuted, setExterior, dispose, state: state_,
      get active() { return count > 0 || flashT >= 0 || boltT >= 0 || thunderAt >= 0; },
      stats: () => ({ rainDrops: count, strikes })
    };
  };

  BL.weather = { STEPS, CLEAR_NIGHT, CLEAR_DAY, stepFor, wetAt, cloudFor, create };
})();
