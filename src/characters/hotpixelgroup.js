(() => {
  "use strict";
  const BL = window.BL;
  const { makeVox, voxelGeometry, box, lathe, merge, cached, forward } = BL.models;
  const { createNode, addChild } = BL.scene;
  const { hexToRgb } = BL.math;

  // Forge hammer & pick: a stout hardwood shaft with iron banding and a heavy
  // dual-purpose head (faceted hammer face behind, tapered chisel pick in front),
  // set with a glowing Bitcoin-orange core stone.
  const HAMMER_PALETTE = [
    hexToRgb("#3d2817"), // 0: dark wood
    hexToRgb("#5c3e24"), // 1: wood
    hexToRgb("#222326"), // 2: dark iron
    hexToRgb("#43464d"), // 3: iron
    hexToRgb("#717682"), // 4: steel edge
    hexToRgb("#f7931a"), // 5: rune orange
    hexToRgb("#ffe291")  // 6: lit core
  ];
  const GOLD_HAMMER_PALETTE = [
    hexToRgb("#5c3e24"),
    hexToRgb("#855933"),
    hexToRgb("#473711"),
    hexToRgb("#8c7121"),
    hexToRgb("#d4a83a"),
    hexToRgb("#f7931a"),
    hexToRgb("#fff2b8")
  ];

  const hammerVoxels = (rand) => {
    const v = makeVox();
    const woodJ = () => rand() < 0.2 ? 0 : 1;
    const ironJ = () => rand() < 0.25 ? 2 : 3;

    // Handle
    v.fill(0, 0, -2, 13, 0, 0, woodJ);
    // Grip wraps
    v.fill(-1, 1, 0, 1, 0, 0, ironJ);
    v.fill(0, 0, 0, 1, -1, 1, ironJ);
    v.fill(-1, 1, 4, 5, 0, 0, ironJ);
    v.fill(0, 0, 4, 5, -1, 1, ironJ);

    // Collar under head
    v.fill(-1, 1, 10, 10, -1, 1, ironJ);

    // Hammer & Pick head (y = 11..13, z = -2..2)
    v.fill(-1, 1, 11, 13, -2, 2, ironJ);
    v.fill(0, 0, 11, 13, -3, -3, 4); // Flat hammer striking face
    v.fill(-1, 1, 12, 12, -3, -3, 4);
    v.fill(0, 0, 11, 13, 3, 3, 3);   // Pick transition
    v.set(0, 12, 4, 4);              // Pick point

    // Glowing core stone atop the eye
    v.set(0, 14, 0, 5);
    v.set(0, 13, 0, 6);
    v.set(0, 12, 0, 5);
    return v;
  };

  // Mining goggles worn tilted up above the brow. Brass frames, amber lenses,
  // dark leather strap hugging the head.
  const gogglesGeometry = cached(() => {
    const brass = "#c4932f";
    const darkBrass = "#7a5917";
    const leather = "#2e1f14";
    const amber = "#f7931a";
    const glass = "#ffe082";

    // Eyepieces at left (x = -0.11) and right (x = 0.11)
    const eyepiece = (sx) => {
      const rim = lathe({
        profile: [
          [0.055, 0],
          [0.08, 0],
          [0.085, 0.03],
          [0.08, 0.05],
          [0.055, 0.05],
          [0.05, 0.02]
        ],
        segments: 12,
        color: brass
      });
      const lens = lathe({
        profile: [
          [0, 0.035],
          [0.058, 0.035],
          [0.058, 0.042],
          [0, 0.042]
        ],
        segments: 12,
        color: amber,
        emissive: 0.4
      });
      const glint = box({
        w: 0.02,
        h: 0.008,
        d: 0.006,
        color: glass,
        emissive: 0.8,
        offset: { x: 0.02, y: 0.02, z: 0.04 }
      });
      return forward(merge(rim, lens, glint), { x: sx, y: 0, z: 0.28 });
    };

    // Bridge between eyepieces
    const bridge = box({
      w: 0.08,
      h: 0.025,
      d: 0.02,
      color: darkBrass,
      offset: { x: 0, y: 0, z: 0.285 }
    });

    // Side straps wrapping to temples
    const strapL = box({
      w: 0.03,
      h: 0.035,
      d: 0.28,
      color: leather,
      offset: { x: -0.22, y: 0, z: 0.12 }
    });
    const strapR = box({
      w: 0.03,
      h: 0.035,
      d: 0.28,
      color: leather,
      offset: { x: 0.22, y: 0, z: 0.12 }
    });
    const strapBack = box({
      w: 0.44,
      h: 0.035,
      d: 0.03,
      color: leather,
      offset: { x: 0, y: 0, z: -0.03 }
    });

    return merge(eyepiece(-0.11), eyepiece(0.11), bridge, strapL, strapR, strapBack);
  });

  BL.characters.add({
    handle: "hotpixelgroup",
    joined: 1790600000,
    lastCommit: 1790680000,
    display: "hotpixelgroup",
    github: "hotpixelgroup",
    look: {
      skin: "#c48253",
      hair: "#26170d",
      fur: "#d98a2e",
      height: 1.08,
      eyeColor: "#f7931a",
      eyeGlow: 0.8,
      face: "beard",
      hatY: 12,
      portrait: { min: [-1, -2, 0], max: [7, 8, 8] }
    },
    voice: {
      poke: "Hot pixels, forged blocks.",
      idle: [
        "Proof of work never sleeps.",
        "The hardest stone yields to patience.",
        "Tick tock, next block.",
        "Stacking sats, pixel by pixel."
      ]
    },
    dress: {
      // Leather smith's apron with a gold anvil/rune emblem on the chest
      torso(k, v) {
        const apron = k.color("#382314");
        const apronDk = k.color("#21140a");
        const gold = k.color("#f7931a");
        const goldGlow = k.color("#ffe291");
        const steel = k.color("#717682");

        // Heavy leather bib apron
        v.fill(2, 6, 2, 7, 5, 5, (x, y) => (x + y) % 3 === 0 ? apronDk : apron);
        v.fill(2, 6, 2, 7, 4, 4, apron);

        // Shoulder straps for the apron
        v.fill(2, 2, 4, 7, 1, 5, apronDk);
        v.fill(6, 6, 4, 7, 1, 5, apronDk);

        // Golden anvil/Bitcoin rune on the bib
        v.set(4, 5, 5, goldGlow);
        v.fill(3, 5, 4, 4, 5, 5, gold);
        v.set(4, 3, 5, gold);
        v.fill(3, 5, 2, 2, 5, 5, gold);

        // Tool belt with metal buckles
        v.fill(1, 7, 2, 2, 5, 5, apronDk);
        v.set(4, 2, 5, steel);

        // Apron waist ties on back
        v.fill(2, 6, 2, 2, 0, 0, apronDk);
      },

      // Custom forge hammer / pick
      club(k) {
        const voxels = hammerVoxels(k.rand), unit = k.u;
        const origin = { x: -unit, y: -unit, z: -unit }, emissive = { 5: 0.6, 6: 1 };
        return {
          // Keep the voxels so the shared builder does not draw a fallback club from k.rand.
          voxels,
          default: voxelGeometry(voxels, { unit, palette: HAMMER_PALETTE, origin, emissive }),
          gold: voxelGeometry(voxels, { unit, palette: GOLD_HAMMER_PALETTE, origin, emissive }),
          rest: { x: 0.2, z: -0.05 },
          carry: { x: 0.35, z: 0 }
        };
      },

      // Headband & hair binding
      crown(k, v) {
        const leather = k.color("#2e1f14");
        const gold = k.color("#f7931a");

        // Brow band around head at y = 5
        v.fill(-1, 7, 5, 5, -1, 5, (x, y, z) => (x === -1 || x === 7 || z === -1 || z === 5) ? leather : null);
        // Golden gem badge on brow
        v.set(3, 5, 6, gold);

        // Top knot / tied hair tuft at the crown
        v.fill(2, 4, 8, 9, 1, 3, k.hairJ);
        v.set(3, 10, 2, k.hairJ());
      },

      // War paint below the eyes, on the beard's exposed front rather than the blink cells.
      mark(k, v) {
        const ochre = k.color("#e06820");
        v.set(0, 1, 7, ochre);
        v.set(1, 1, 7, ochre);
        v.set(5, 1, 7, ochre);
        v.set(6, 1, 7, ochre);
      },

      // Brass mining goggles on the forehead
      headgear(k) {
        const h = k.h, u = k.u;
        addChild(k.parts.head, createNode({
          position: { x: 0, y: 5.6 * u, z: 0.4 * u },
          rotation: { x: 0.15, y: 0, z: 0 },
          scale: { x: h, y: h, z: h },
          geometry: gogglesGeometry(),
          portraitHidden: true
        }));
      }
    }
  });
})();
