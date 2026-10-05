(() => {
  "use strict";
  const BL = window.BL;
  const { box, lathe, merge, GOLD_CLUB_PALETTE } = BL.models;
  const { createNode, addChild } = BL.scene;
  const cigaretteGeometry = (h) => merge(
    box({ w: 0.035 * h, h: 0.035 * h, d: 0.26 * h, color: "#f3efe4", offset: { z: 0.13 * h } }),
    box({ w: 0.037 * h, h: 0.037 * h, d: 0.06 * h, color: "#c78b42", offset: { z: 0.29 * h } }),
    box({ w: 0.04 * h, h: 0.04 * h, d: 0.025 * h, color: "#e35b2d", emissive: 0.7, offset: { z: 0.34 * h } })
  );
  const energyCanCache = new Map();
  const energyCanGeometry = (h, gold = false) => {
    const key = `${h}/${gold}`;
    let geo = energyCanCache.get(key);
    if (!geo) {
      geo = merge(
        lathe({ profile: [[0.075 * h, -0.18 * h], [0.088 * h, -0.14 * h], [0.088 * h, 0.14 * h], [0.075 * h, 0.18 * h]], segments: 10, color: "#c9ccd2" }),
        box({ w: 0.12 * h, h: 0.3 * h, d: 0.014 * h, color: "#2458a6", offset: { z: 0.086 * h } }),
        box({ w: 0.014 * h, h: 0.3 * h, d: 0.12 * h, color: "#2458a6", offset: { x: 0.086 * h } }),
        box({ w: 0.11 * h, h: 0.028 * h, d: 0.018 * h, color: "#d32f2f", offset: { y: 0.035 * h, z: 0.096 * h } }),
        box({ w: 0.055 * h, h: 0.045 * h, d: 0.02 * h, color: "#e23d32", offset: { y: -0.045 * h, z: 0.098 * h } }),
        lathe({ profile: [[0.072 * h, 0.18 * h], [0.065 * h, 0.195 * h], [0, 0.195 * h]], segments: 10, color: "#c9ccd2" }),
        box({ w: 0.055 * h, h: 0.008 * h, d: 0.025 * h, color: "#5f6670", offset: { y: 0.202 * h } })
      );
      if (gold) for (const face of geo.faces) face.color = GOLD_CLUB_PALETTE[0];
      energyCanCache.set(key, geo);
    }
    return geo;
  };
  BL.characters.add({
    handle: "YellowBrokeIt",
    joined: 1789677925,
    lastCommit: 1788225311,
    // cigarette also keeps the right hand closed in crew.js
    look: { bald: true, cleanShaven: true, wideEyes: true, cigarette: true, face: "none", skin: "#ffe36a", hair: "#21160e", fur: "#ed9b24" },
    dress: {
      torso(k, v) {
        v.fill(0, 8, 0, 7, 0, 5, k.color("#e89423"));
      },
      // An energy can instead of a club, held upright
      club: (k) => ({ default: energyCanGeometry(k.h), gold: energyCanGeometry(k.h, true), rest: { x: 0, z: 0 } }),
      gear(k) {
        const h = k.h;
        addChild(k.parts.armL, createNode({ position: { x: 0, y: -0.62 * h, z: 0.16 * h }, geometry: cigaretteGeometry(h) }));
      },
      // A simple black nose and a white muzzle
      mark(k, v) {
        const P = k.P;
        v.fill(1, 5, 0, 1, 5, 6, P.white);
        v.set(3, 2, 6, P.black);
        v.set(0, 5, 6, P.black);
        v.set(1, 4, 6, P.black);
        v.set(6, 5, 6, P.black);
        v.set(5, 4, 6, P.black);
      }
    }
  });
})();
