# Issue #93: step 1 — render targets

Implements only the two primary settings in recommendation 1: a finite positive deviceMemory hint ≤8 selects medium before renderer allocation, and high requests 2× MSAA instead of 4×. Missing/invalid hints retain the pointer default; downward-only governors remain active. Optional bloom, pixel-budget, shadow and geometry changes are excluded. This does not close #93.

## Validation

Runtime source `6d3aff6a152a134a29dd7ccf036db36118551492`, base `dab6e36bea482f2d712b65f3e2d559348400b527`, tested on 2026-10-02 with Node 24.12.0 and an M1 Pro/32 GB. [Measurements and limitations](render-target-memory-evidence.json).

Build, changed-file syntax and all existing adaptive-quality probe assertions pass. Native high-tier allocation and context-loss/restoration comparisons pass on both versions with clean logs; frames resume and restored buffers retain 4 samples on base and 2 on head.

At identical 2039×1274 targets (1440×900 CSS, DPR 2), the three screen renderbuffers estimate 124,688,928 versus 62,344,464 bytes: **59.46 MiB saved**, assuming four bytes per pixel per sample. Textures, geometry, driver padding and process overhead are excluded. Total-tab memory of 700–750 MB on a base M1 remains unverified.

Both full-suite attempts fail and abort at the same missing-player-root breakables unit fixture, without final totals. Head has 79 distinct failing names, base 78, with 76 shared. The three unmatched head results were investigated: native clicks reach wrong controls, and the original node soak changes quality tiers. Using #122's existing compositor-safe click fixture, all 54 selected DSB assertions pass on both builds; six returns at fixed low quality retain identical node/target/tween/DOM counts on both. These diagnostic controls explain the unmatched results without adding DSB fixes here; they are not full-suite passes.

Covered movement fails on both (base 32.62 FPS, head 29.45 FPS; p95 50 ms, low quality). Ordinary movement also fails on both. Other Chrome processes and variable timing prevent a performance-equivalence claim. Existing requirements remain unchanged; #128 tracks performance.

The expanded scene-return attempt hit an inherited Canvas console warning in seven cases; its eighth used an invalid context-loss wait and is excluded. The corrected native-event restoration probe passes separately. No fresh 8/8 clean-console or full-suite success is claimed. **Draft remains appropriate.**
