// Cached, renderer-neutral gate geometry. Local +Y is the front of the horizon.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {}, M = BL.models, S = BL.scene;
  const rings = new Map();
  const PORTAL_BLUE = "#287cae", RING_BLUE = "#41596c";
  let disc, surge, pedestal;
  const build = (radius, outerRadius) => {
    const key = radius + ":" + outerRadius;
    if (!rings.has(key)) rings.set(key, M.lathe({
      profile: [[radius, -0.08], [outerRadius, -0.08], [outerRadius, 0.08], [radius, 0.08], [radius, -0.08]],
      segments: 32, color: RING_BLUE, emissive: 0 }));
    if (!disc) {
      // A tessellated, two-sided membrane, shared by every portal. The renderers
      // displace it without touching the cached vertices or allocating per frame.
      const profile = [];
      for (let i = 0; i <= 20; i++) profile.push([i / 20, 0]);
      for (let i = 19; i >= 0; i--) profile.push([i / 20, 0]);
      disc = M.lathe({ profile, segments: 64, color: PORTAL_BLUE, emissive: 0.7 });
      disc.portalSurface = true; disc.castShadow = false;
      surge = M.lathe({ profile: [[0.93, 0], [0.965, 0.055], [1, 0], [0.965, -0.012], [0.93, 0]],
        segments: 64, color: "#83e0ed", emissive: 0.9 });
      surge.castShadow = false;
      pedestal = M.merge(M.box({ w: 0.7, h: 0.18, d: 0.7, color: "#485565", offset: { y: 0.09 } }),
        M.box({ w: 0.38, h: 0.8, d: 0.38, color: "#687782", offset: { y: 0.55 } }),
        M.box({ w: 0.8, h: 0.2, d: 0.65, color: "#45687c", offset: { y: 1.0 } }),
        M.box({ w: 0.3, h: 0.04, d: 0.3, color: "#8ae9ee", emissive: 0.8, offset: { y: 1.12 } }));
    }
    const root = S.createNode(), ring = S.createNode({ geometry: rings.get(key), glow: 0.25 });
    const surfaceY = 0;
    const horizon = S.createNode({ position: { x: 0, y: surfaceY, z: 0 }, portalTime: 0, portalSurge: 0, portalReveal: 0, matrixNative: true, geometry: disc, visible: false, sightHidden: true, scale: { x: radius, y: 1, z: radius } });
    const kawoosh = S.createNode({ position: { x: 0, y: surfaceY, z: 0 }, geometry: surge, matrixNative: true, visible: false, sightHidden: true });
    // Ripples now belong to the liquid membrane rather than floating rings.
    const ripples = [];
    S.addChild(root, ring, horizon, kawoosh, ...ripples);
    return { root, ring, surfaceY, horizon, kawoosh, ripples, dialer: S.createNode({ geometry: pedestal }) };
  };
  // Canvas fallback uses the same wave equation as the GPU material.
  const liquidHeight = (x, z, time, surge) => {
    const r = Math.hypot(x, z), envelope = Math.max(0, 1 - r * r);
    const a = Math.hypot(x - 0.22, z + 0.17), b = Math.hypot(x + 0.31, z - 0.24);
    return envelope * (0.016 * Math.sin(a * 32 - time * 4) + 0.01 * Math.sin(b * 25 - time * 3)
      + 0.008 * Math.sin(x * 18 + z * 12 + time * 2) - surge * 0.32 * envelope);
  };
  BL.oogaPortalModels = { build, liquidHeight };
})();
