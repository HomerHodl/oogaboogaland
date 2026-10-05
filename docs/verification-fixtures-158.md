# Verification fixtures: issue #158

Canonical rock 822adde failed the baked activity assertion and then threw while constructing pool water, before completing its unit checks. These failures reproduced with the performance changes absent.

The activity check now compares org `last_seen_at` with `lastContributionAt`, which drives the contributor's overall activity, while retaining every per-repository timestamp assertion. `lastCommitAt` tracks repository history separately.

The water fixture supplies actual ground, membrane and sign-post meshes because the current water module clips those meshes and builds residual waterfall streaks against the ground. It samples an exterior channel, rather than an inner feeder whose wet footprint can be offset by its voxel banks. The unavailable lake stays low and dim under the documented contract. Both overflow stages can feed all nine outlets; the full-flood assertion checks that exact count. Cube bursts fill the live sets with birth spacing before testing queue capacity and exactly two dropped events.

The existing monotonic scale, anchor levels, stage transitions, dry paths and nests, cliff/lip exclusion, stale hold and bounded queue requirements remain asserted. No production behavior changes.

Validation: `npm run test:unit` passes 130/130 on this branch. This does not establish that the browser suite passes; covered movement and several interaction checks still fail in the earlier full run.
