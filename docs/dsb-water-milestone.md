# DSB Milestone 3: Aegean water

Starting checkpoint: 66edff9f68348ae7d4354f0f0b7815aa7ae3a242.
Visual approval is pending. Later milestones must wait for it.

## Implementation

The DSB scene replaces only its placeholder sea with dsb-water.js. It retains
the mean water elevation (-0.3), 650-metre footprint, approved overview camera,
terrain, buildings, piers, walkability and the 37-degree daylight clock.

Selected routines are adapted from [Clearwater](https://github.com/Aureliengmz/clearwater),
revision 4bc826134321043a25df3c2b6fed16fb7b9241e8, Copyright (c) 2026 Lumaris,
MIT. The complete notice is in dsb-water.js and survives the single-file build.
Adaptations cover its seeded directional wave spectrum, complex spectral
evolution, inverse FFT butterfly and dielectric Fresnel equation. Absorption
and refraction follow its optical approach. No demo assets, runtime, camera,
UI, fixed lighting, postprocessing or external dependencies are imported.

A 64x64 CPU inverse FFT feeds an RGBA8 surface texture. The patch loops after
120 seconds, uses preallocated arrays, and needs no floating-point framebuffer
extension. Two differently scaled samples reduce repetition. A 256x256 optical
depth map samples the approved terrain and extends the apparent seabed depth
offshore. Refraction, wavelength-dependent absorption, curvature-based caustic
approximation, restrained shore foam and glints use that map and existing
daylight inputs. The renderer reserves material 6 and texture units 7 and 8;
the road material remains confined to material 5.

The mean surface is static: this milestone animates optical surface detail,
not the shoreline or collision mesh. Reflections use sky illumination rather
than scene captures. Caustics are an inexpensive curvature approximation, not
Clearwater's refracted ray-grid pass. Underwater cameras, swimming, boats and
interactive wave impacts are outside this checkpoint.

Canvas 2D uses a depth-colored surface with standard scene lighting. Its lack
of FFT shader optics is deliberate. Both renderers retain their public API
and expose waterTextures (2 in WebGL while DSB is active, otherwise 0).
Water textures are released on scene removal and renderer disposal; context
restoration recreates them. The scene drops its visit-owned arrays on leave.

## Validation

- Canonical build and syntax checks passed.
- Focused desktop, 390x844 phone and Canvas fallback sessions passed:
  deterministic finite looping FFT, animated state, offshore depth progression,
  keyboard movement (WebGL sessions), two Portara crossings with DSB returns,
  character identity, texture release/recreation, clean consoles.
- The portal test activates the existing receiving state to exercise physical
  crossing and lifecycle; it does not retest the dialer's timed UI sequence.
- Approved geography compared to the starting commit: non-water geometry and
  transforms, layout metadata, and 24,964 height/clear/walk query positions
  have identical hashes. Daylight source is unchanged.
- Noon, dawn, sunset and night were checked at day 80 and the approved camera.
- The CPU FFT update measured about 1.1 ms on this desktop in the focused run.
  This is not an overall frame-rate or real-device mobile performance claim.
- The global tier still fails the pre-existing surface cave c3 and mirror
  damage checks, then crashes at test/run.mjs:8574 reading a missing position,
  as documented in dsb-master-layout.md. No full-suite pass is claimed.

Geography golden SHA-256 values:
- geometry/transforms: 259bd84709f79f45ee273b131988f66edff695ec916a3e2af9aa501f0c7c45af
- support/clear/walk queries: 27cbd6a9d437c377f436ef33578d5ad925822edb1b6193fd069ce7ddab59925c
- layout metadata: c4e84c6d07d3b63e23d11bb1b4724614023560b9115f809e787dc5e83b2c47cf

The existing branch Pages workflow builds rock unchanged at the site root and
this branch under /dsb-preview/. As before, a later rock deployment can remove
the preview; restoring it needs a run of this branch workflow.
