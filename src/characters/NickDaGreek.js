(() => {
  "use strict";
  const BL = window.BL;
  // Matched from NickDaGreek YT thumbs: shaved head, salt-and-pepper beard,
  // black-frame glasses, fair-warm skin, dark eyes, solid build.
  BL.characters.add({
    handle: "NickDaGreek",
    display: "NickDaGreek",
    // GitHub account that opens the PR (fork owner)
    github: "nickdagreek1",
    joined: 1791435201,
    lastCommit: 1791435201,
    look: {
      portrait: { min: [-1, -2, -1], max: [7, 9, 8] },
      bald: true,
      hairless: true,
      face: "beard",
      build: "normal",
      height: 1.04,
      hatY: 6,
      skin: "#d9a882",
      hair: "#6a6560",
      fur: "#5c534c",
      eyeColor: "#3a2c22"
    },
    voice: {
      poke: "Ooga. NickDaGreek in the cave.",
      idle: [
        "Stack sats. Speak Greek.",
        "One more block.",
        "Island time.",
        "Build in public.",
        "No leverage. Only bananas.",
        "From the chain to the cliff."
      ]
    },
    dress: {
      // Round the bald crown; black rectangular glasses over the eyes
      crown(k, v) {
        const frame = k.color("#1a1a1a");
        const lens = k.color("#2a3038");
        const lensHi = k.color("#3d4650");
        for (const x of [0, 6]) for (const z of [0, 5]) v.del(x, 5, z);
        for (const x of [1, 5]) {
          v.del(x, 5, 0);
          v.del(x, 5, 5);
        }
        // Bridge + rims
        v.fill(0, 6, 3, 3, 6, 6, frame);
        v.fill(0, 1, 2, 3, 6, 6, lens);
        v.fill(5, 6, 2, 3, 6, 6, lens);
        v.set(1, 3, 6, lensHi);
        v.set(5, 3, 6, lensHi);
        // Temples
        v.fill(-1, -1, 3, 3, 4, 6, frame);
        v.fill(7, 7, 3, 3, 4, 6, frame);
      }
    }
  });
})();
