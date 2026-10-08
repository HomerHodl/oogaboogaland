// The logo's outboard: a yellow cowling helmet drawn with the meme face — round white eyes,
// black pupils, thin red beams — with a long plump tail running off the crown line to a
// propeller and lower unit, and a tiller topped with a propeller as his club.
(() => {
  "use strict";
  const BL = window.BL;
  const { box, lathe, ring, merge, forward, moved, turnedX, turnedY, turnedZ, cached } = BL.models;
  const { createNode, addChild } = BL.scene;
  const shellY = "#e6c22e", shellDk = "#b8912a", ink = "#1a1a1a";
  const white = "#eceae4", black = "#24262a", brass = "#c9a34a", laserRed = "#ff2a1e";
  // Three pitched blades radiating from the shaft axis at height y, out to reach.
  const propBlades = (reach, rise, thick, y, color) => [0.4, 0.4 + 2.094, 0.4 + 4.189]
    .map((a) => moved(turnedY(turnedZ(box({ w: reach, h: rise, d: thick, color, offset: { x: reach / 2 } }), 0.5), a), 0, y, 0));
  // The same for an axis along z — a stern propeller at (atX, atY, atZ).
  const propStern = (reach, rise, thick, atX, atY, atZ, color) => [0.4, 0.4 + 2.094, 0.4 + 4.189]
    .map((a) => moved(turnedZ(turnedX(box({ w: reach, h: rise, d: thick, color, offset: { x: reach / 2 } }), 0.5), a), atX, atY, atZ));
  // The cowling, in head-node units (fractions of height): dome closed top and bottom,
  // widest over the cheeks where the face is drawn.
  const cowlingGeometry = cached(() => {
    const shell = lathe({ profile: [[0, -0.14], [0.25, -0.13], [0.31, -0.08], [0.36, 0.08], [0.35, 0.28], [0.30, 0.44], [0.19, 0.56], [0, 0.62]], segments: 14, color: shellY });
    const lip = ring({ r: 0.33, thickness: 0.035, y: -0.11, segments: 14, color: shellDk });
    // the meme face, drawn on the front of the shell
    const eye = (sx) => merge(
      // round white eye with an inked pupil, and a thin red beam skimming outward off it
      forward(lathe({ profile: [[0.05, 0], [0.075, 0], [0.075, 0.016], [0.05, 0.016]], segments: 12, color: ink }), { x: sx * 0.125, y: 0.265, z: 0.327 }),
      forward(lathe({ profile: [[0, 0], [0.055, 0], [0.055, 0.008], [0, 0.008]], segments: 12, color: white }), { x: sx * 0.125, y: 0.265, z: 0.338 }),
      forward(lathe({ profile: [[0, 0], [0.018, 0], [0.018, 0.007], [0, 0.007]], segments: 8, color: black }), { x: sx * 0.125, y: 0.265, z: 0.346 }),
      moved(turnedY(box({ w: 0.01, h: 0.01, d: 0.2, color: laserRed, emissive: 0.4 }), sx * 0.55), sx * 0.25, 0.265, 0.43));
    // the smirk: a low bar across the middle, both ends hooked up
    const smirk = merge(
      moved(turnedZ(box({ w: 0.17, h: 0.013, d: 0.015, color: ink }), -0.06), 0.02, 0.055, 0.345),
      moved(turnedZ(box({ w: 0.075, h: 0.012, d: 0.015, color: ink }), 0.7), 0.115, 0.1, 0.335),
      moved(turnedZ(box({ w: 0.075, h: 0.012, d: 0.015, color: ink }), -0.7), -0.075, 0.1, 0.335));
    // the outboard body: a plump tail breaks from the shell just under the crown, keeps the
    // helmet's height along its top, bows out, then sweeps in to a tip far to the rear —
    // the drive shaft and gearcase hang below it like the logo's lower unit
    const tail = moved(turnedY(forward(lathe({ profile: [[0.30, 0], [0.295, 0.15], [0.28, 0.35], [0.245, 0.60], [0.20, 0.85], [0.15, 1.08], [0.10, 1.28], [0.055, 1.42], [0.02, 1.50], [0, 1.53]], segments: 14, color: shellY })), Math.PI), 0, 0.30, -0.02);
    const rearHub = moved(turnedY(forward(lathe({ profile: [[0, 0], [0.04, 0.015], [0.04, 0.06], [0.015, 0.085], [0, 0.09]], segments: 8, color: brass })), Math.PI), 0, 0.30, -1.49);
    // comedy: the stern prop is far too big for the motor it hangs on
    return merge(shell, lip, tail, rearHub, ...propStern(0.30, 0.12, 0.028, 0, 0.30, -1.6, brass),
      box({ w: 0.09, h: 0.34, d: 0.09, color: white, offset: { y: -0.04, z: -0.86 } }),
      box({ w: 0.12, h: 0.16, d: 0.13, color: black, offset: { y: -0.24, z: -0.87 } }),
      ...propStern(0.11, 0.045, 0.012, 0, -0.24, -0.95, brass),
      box({ w: 0.015, h: 0.06, d: 0.015, color: ink, offset: { y: 0.16, z: 0.352 } }),
      smirk, eye(-1), eye(1));
  });
  // The club: black tiller grip, pale shaft, a brass three-blade propeller for a head.
  const propellerClub = (h, gold = false) => {
    const u = h / 16;
    const shaftC = gold ? "#f0c75e" : white, brassC = gold ? "#ffd75e" : brass;
    const hub = lathe({ profile: [[0.45 * u, 13.4 * u], [0.5 * u, 14 * u], [0.3 * u, 14.6 * u], [0, 14.7 * u]], segments: 10, color: brassC });
    return merge(
      box({ w: 1.2 * u, h: 3.6 * u, d: 1.2 * u, color: black, offset: { y: -1.8 * u } }),
      box({ w: 0.9 * u, h: 12 * u, d: 0.9 * u, color: shaftC, offset: { y: 6.2 * u } }),
      box({ w: 1.4 * u, h: 1.6 * u, d: 1.4 * u, color: black, offset: { y: 12.9 * u } }),
      hub, ...propBlades(3.2 * u, 0.8 * u, 0.22 * u, 13.9 * u, brassC));
  };
  BL.characters.add({
    handle: "btcmcboatface",
    github: "btcmcboatface",
    display: "Boatface",
    joined: 1787975564,
    lastCommit: 1789253469,
    // low and yellow: the whole Ooga is the boat. The cowling hides the head, so the head
    // stays plain underneath; the eyes and mark hooks draw the meme face for the HUD
    // portraits, which show head voxels only, never the cowling.
    look: { hairless: true, noBrow: true, face: "none", noPupils: true, height: 0.8, skin: "#e8cf94", fur: "#e6c22e" },
    voice: {
      poke: "Boatface here",
      idle: [
        "Arbitrary data is not a sin",
        "I am just here to talk about covenants",
        "I can haz CTV? French CTV?",
        "There is no second boat",
        "A propeller is just another flywheel",
        "Boatface is open-source dev now"
      ]
    },
    dress: {
      // swag and donation hats sit on the cowling's crown
      hatY: (k) => 0.64 * k.h,
      headgear(k) {
        addChild(k.parts.head, createNode({ scale: { x: k.h, y: k.h, z: k.h }, geometry: cowlingGeometry() }));
      },
      club: (k) => ({ default: propellerClub(k.h), gold: propellerClub(k.h, true), rest: { x: 0.3, z: 0 }, carry: { x: 0.95, z: 0 } }),
      eyes(k, v) {
        // round whites with high inner pupils, the way the cowling draws them
        v.fill(0, 1, 2, 3, 5, 5, k.P.white);
        v.fill(5, 6, 2, 3, 5, 5, k.P.white);
        v.set(1, 3, 5, k.P.black);
        v.set(5, 3, 5, k.P.black);
        return true;
      },
      mark(k, v) {
        // the smirk, hooked up at the corners
        v.fill(1, 5, 0, 0, 5, 5, k.P.black);
        v.set(0, 1, 5, k.P.black);
        v.set(6, 1, 5, k.P.black);
      }
    }
  });
})();
