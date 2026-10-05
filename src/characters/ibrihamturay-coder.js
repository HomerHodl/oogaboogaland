(() => {
  "use strict";
  const BL = window.BL;
  const { makeVox, voxelGeometry } = BL.models;
  const { createNode, addChild } = BL.scene;
  const { hexToRgb } = BL.math;
  // Optimus Ooga: a clean industrial robot in white plating with black joints and
  // a cyan core. Every plate colour is registered as a pair, gloss white now and
  // brushed silver later: tint() hands models.js the second palette and crew.js
  // changes the whole body between the two.
  const twins = new Map();
  let slots = null;
  const colors = (k) => {
    if (slots) return slots;
    const pair = (red, green) => {
      const slot = k.color(red);
      twins.set(slot, green);
      return slot;
    };
    return slots = {
      plate: pair("#e8e8ec", "#c0c4cc"),
      light: pair("#f6f6f8", "#d8dbe0"),
      dark: pair("#c0c4cc", "#8e939c"),
      shell: pair("#e8e8ec", "#c0c4cc"),
      core: pair("#4dd0e1", "#6fe3f0"),
      // The hardware stays the same colour in both states, and so do the eyes.
      joint: k.color("#1a1a1a"),
      // Hands, boots, neckpiece and spine are their own black and dark grey,
      // the same in both colourways.
      grip: k.color("#0f1013"),
      gripLt: k.color("#3a3e45"),
      wire: k.color("#4dd0e1"),
      eye: k.color("#2f8cff"),
      // A graphite wrap in place of hide, flecked with silver: still an Ooga, just a tidy one.
      loin: k.color("#2a2a2e"),
      loinSpot: k.color("#c0c4cc")
    };
  };
  const glowOf = (C) => ({ [C.core]: 1, [C.wire]: 0.5, [C.eye]: 1, [C.light]: 0.12 });
  // Android limbs: a plate over each long bone, a dark joint at every hinge, a
  // black hand or boot at the end and one lamp where the plating opens.
  const legVox = (C, side) => {
    const v = makeVox();
    v.fill(0, 3, 4, 4, 0, 3, C.plate);
    v.fill(0, 3, 3, 3, 0, 3, C.dark);
    v.fill(0, 3, 2, 2, 1, 2, C.joint);
    v.fill(0, 3, 0, 1, 0, 5, C.gripLt);
    v.fill(0, 3, 0, 0, 0, 5, C.grip);
    v.fill(0, 3, 1, 1, 4, 5, C.grip);
    v.set(side < 0 ? 0 : 3, 4, 4, C.core);
    return v;
  };
  const armVox = (C) => {
    const v = makeVox();
    v.fill(-1, 3, 9, 10, -1, 3, C.plate);
    v.fill(-1, 3, 10, 10, -1, 3, C.light);
    v.fill(-1, 3, 8, 8, -1, 3, C.joint);
    v.fill(0, 2, 5, 7, 0, 2, C.plate);
    v.fill(0, 2, 4, 4, 0, 2, C.joint);
    v.fill(0, 2, 2, 3, 0, 2, C.plate);
    v.fill(0, 2, 2, 3, 2, 2, C.dark);
    v.fill(-1, 3, 0, 1, -1, 3, C.gripLt);
    v.fill(-1, 3, 0, 0, -1, 3, C.grip);
    v.set(1, 6, 2, C.core);
    return v;
  };
  // A chest plate over an open waist: the machinery between them is the tell that
  // this Ooga is a machine, and the core sits where a heart would.
  const torsoVox = (C) => {
    const v = makeVox();
    v.fill(0, 8, 0, 7, 0, 5, C.plate);
    v.fill(0, 8, 7, 7, 0, 5, C.gripLt);
    v.fill(0, 8, 6, 6, 0, 5, C.light);
    // The waist pinches in and shows its wiring front and back.
    for (const y of [2, 3]) {
      for (let z = 0; z <= 5; z++) {
        v.del(0, y, z);
        v.del(8, y, z);
      }
      v.fill(1, 7, y, y, 0, 5, C.joint);
    }
    for (const x of [2, 4, 6]) {
      v.set(x, 2, 5, C.wire);
      v.set(x, 3, 0, C.wire);
    }
    // Chest: a lit ring with the core at its centre, seams down the side plates.
    v.fill(3, 5, 4, 5, 5, 5, C.light);
    v.set(4, 5, 5, C.core);
    v.set(4, 4, 5, C.dark);
    v.fill(1, 1, 4, 5, 5, 5, C.dark);
    v.fill(7, 7, 4, 5, 5, 5, C.dark);
    // Pelvis under the waist: its top row carries the machinery on down, so the
    // dark band reads taller than the pinch itself.
    v.fill(0, 8, 1, 1, 0, 5, C.joint);
    v.fill(3, 5, 4, 5, 0, 0, C.gripLt);
    v.fill(1, 2, 4, 5, 0, 0, C.dark);
    v.fill(6, 7, 4, 5, 0, 0, C.dark);
    v.set(4, 6, 0, C.core);
    // A graphite wrap round the pelvis, under the wiring.
    for (let x = 0; x <= 8; x++) for (let z = 0; z <= 5; z++) for (const y of [0, 1]) {
      if (x === 0 || x === 8 || z === 0 || z === 5) v.set(x, y, z, (x * 3 + y * 5 + z * 7) % 6 === 0 ? C.loinSpot : C.loin);
    }
    return v;
  };
  const fingerVox = (C) => {
    const v = makeVox();
    v.set(0, 1, 4, C.grip);
    v.set(2, 1, 4, C.grip);
    return v;
  };
  // A smooth plated helmet: rounded crown, brow shelf and a narrow jaw, no
  // markings at all, and one black visor band across the face for the eyes.
  const skullVox = (v, C) => {
    v.fill(0, 6, 0, 6, 0, 5, C.shell);
    // A high cranium domed at the top, and a jaw narrowed under the cheekbones.
    for (const x of [0, 6]) {
      for (let z = 0; z <= 5; z++) {
        v.del(x, 6, z);
        v.del(x, 0, z);
      }
      for (const z of [0, 5]) v.del(x, 5, z);
    }
    for (const x of [1, 5]) {
      v.del(x, 6, 0);
      v.del(x, 6, 5);
    }
    for (const x of [1, 5]) {
      v.del(x, 0, 0);
      v.del(x, 0, 5);
    }
    // A brow shelf over the sockets, a nose ridge under it, cheekbones beside.
    v.fill(1, 5, 4, 4, 6, 6, C.shell);
    v.fill(3, 3, 2, 3, 6, 6, C.shell);
    v.set(1, 2, 6, C.shell);
    v.set(5, 2, 6, C.shell);
    // The visor wraps the face at eye height and stands proud of it; a silver
    // mouth grille, a crown seam and a black brow line finish the face.
    v.fill(0, 6, 3, 3, 5, 5, C.joint);
    v.fill(1, 5, 3, 3, 6, 6, C.joint);
    v.fill(2, 4, 1, 1, 5, 5, C.dark);
    v.set(3, 1, 6, C.joint);
    v.fill(1, 5, 6, 6, 2, 2, C.dark);
    v.fill(2, 4, 4, 4, 6, 6, C.joint);
  };
  // Nunchaku: two matte sticks on a short chain, their own palette so the gold
  // skin and the body's two colourways never fight over them.
  const CHUK_PALETTE = [hexToRgb("#17181b"), hexToRgb("#767c85"), hexToRgb("#3b3f45")];
  const GOLD_CHUK_PALETTE = [hexToRgb("#c79a2f"), hexToRgb("#e8c669"), hexToRgb("#8a6a18")];
  const STICK = 0, COLLAR = 1, CHAIN = 2;
  // The handle carries the chain stub, so the gap stays filled at every angle.
  const handleVox = () => {
    const v = makeVox();
    v.fill(0, 1, 0, 4, 0, 1, STICK);
    v.fill(0, 1, 1, 1, 0, 1, COLLAR);
    v.fill(0, 1, 4, 4, 0, 1, COLLAR);
    v.fill(0, 1, 5, 5, 0, 0, CHAIN);
    v.fill(0, 1, 6, 6, 1, 1, CHAIN);
    return v;
  };
  const freeVox = () => {
    const v = makeVox();
    v.fill(0, 1, 0, 2, 0, 1, STICK);
    v.fill(0, 1, 0, 0, 0, 1, COLLAR);
    return v;
  };
  // Both sticks in line, as they sit while the pair is spinning: three copies of
  // this trail the live weapon so a fast spin reads as an arc, not a strobe.
  const pairVox = () => {
    const v = handleVox();
    v.fill(0, 1, 7, 9, 0, 1, STICK);
    v.fill(0, 1, 7, 7, 0, 1, COLLAR);
    return v;
  };
  const CHUK_TRAIL = 6;
  // The pivot sits at the top of the handle's chain, in the club's own space.
  const CHAIN_Y = 6;
  // No pack on his back: the thrust comes out of his soles. One node at the
  // feet holds both plumes, so crew.js lights and stretches them as it does any
  // jetpack flame, and they keep their own colours through both colourways.
  const FLAME_PALETTE = [hexToRgb("#4dd0e1"), hexToRgb("#e6fbff")];
  const FLAME_GLOW = { 0: 1, 1: 1 };
  const flameVox = () => {
    const v = makeVox();
    for (const x of [1, 6]) {
      v.fill(x, x + 1, -2, -1, 0, 1, 1);
      v.fill(x, x + 1, -3, -3, 0, 1, 0);
      v.set(x, -4, 0, 0);
      v.set(x + 1, -4, 1, 0);
    }
    return v;
  };
  BL.characters.add({
    handle: "ibrihamturay-coder",
    github: "ibrihamturay-coder",
    display: "Optimus Ooga",
    joined: 1790524280,
    lastCommit: 1790524280,
    // nunchaku swings the free stick in crew.js, footRockets fires the soles,
    // and the tint hook below drives the colourway.
    look: {
      footRockets: true, nunchaku: true,
      bald: true, hairless: true, cleanShaven: true, noBrow: true, noPupils: true,
      face: "none", hatY: 12, height: 1.12,
      skin: "#e8e8ec", hair: "#1a1a1a", fur: "#2a2a2e"
    },
    voice: {
      poke: "Systems nominal.",
      idle: ["Optimizing.", "Running diagnostics.", "Banana protocol engaged."]
    },
    dress: {
      // The whole body is plating, so every voxel part is rebuilt here rather
      // than painted over the caveman underneath. k.vg keeps them in the tint.
      gear(k) {
        const C = colors(k), u = k.u, glow = glowOf(C);
        k.parts.legR.geometry = k.vg(legVox(C, -1), { x: -2 * u, y: -5 * u, z: -2.5 * u }, glow);
        k.parts.legL.geometry = k.vg(legVox(C, 1), { x: -2 * u, y: -5 * u, z: -2.5 * u }, glow);
        const torso = torsoVox(C);
        k.loin = [C.loin, C.loinSpot];
        k.loinFlaps(torso);
        k.parts.torso.geometry = k.vg(torso, { x: -4.5 * u, y: 0, z: -3 * u }, glow);
        const arm = k.vg(armVox(C), { x: -1.5 * u, y: -11 * u, z: -1.5 * u }, glow);
        k.parts.armR.geometry = k.parts.armL.geometry = arm;
        const fingers = k.vg(fingerVox(C), { x: -1.5 * u, y: -u, z: -1.5 * u });
        k.parts.fingersR.geometry = k.parts.fingersL.geometry = fingers;
      },
      club: (k) => ({ voxels: handleVox(), palette: CHUK_PALETTE, goldPalette: GOLD_CHUK_PALETTE, rest: { x: 0.24, z: 0 }, carry: { x: 0.95, z: 0 } }),
      skull(k, v) {
        skullVox(v, colors(k));
        return true;
      },
      eyes(k, v) {
        const C = colors(k);
        // One steady blue lamp each side, set into the visor band.
        for (const x of [1, 5]) {
          v.set(x, 3, 5, C.eye);
          v.set(x, 3, 6, C.eye);
          k.eyeCells.push([x, 3]);
        }
        k.lid = C.joint;
        k.headEmissive = glowOf(C);
        return true;
      },
      // The second colourway: the same palette with every registered plate silver.
      tint: (k, palette) => palette.map((rgb, i) => twins.has(i) ? hexToRgb(twins.get(i)) : rgb),
      extras(k) {
        const u = k.u, origin = { x: -u, y: 0, z: -u };
        const geometry = voxelGeometry(freeVox(), { unit: u, palette: CHUK_PALETTE, origin });
        const gold = voxelGeometry(freeVox(), { unit: u, palette: GOLD_CHUK_PALETTE, origin });
        k.parts.chuk = createNode({ position: { x: 0, y: CHAIN_Y * u, z: 0 }, geometry, skins: { default: geometry, gold } });
        addChild(k.parts.club, k.parts.chuk);
        const trail = voxelGeometry(pairVox(), { unit: u, palette: CHUK_PALETTE, origin: { x: -u, y: -u, z: -u } });
        k.parts.chukTrail = [];
        for (let i = 0; i < CHUK_TRAIL; i++) {
          const ghost = createNode({ geometry: trail, visible: false });
          k.parts.chukTrail.push(ghost);
          addChild(k.parts.armR, ghost);
        }
        // Both the held jump and an equipped jetpack use the same sole thrusters.
        k.parts.jetpack = createNode({ position: { x: 0, y: -5 * u, z: 0 }, visible: false });
        k.parts.jetFlame = createNode({ geometry: voxelGeometry(flameVox(), { unit: u, palette: FLAME_PALETTE, origin: { x: -4.5 * u, y: 0, z: -u }, emissive: FLAME_GLOW }), visible: false });
        addChild(k.parts.jetpack, k.parts.jetFlame);
        addChild(k.root, k.parts.jetpack);
      }
    }
  });
})();
