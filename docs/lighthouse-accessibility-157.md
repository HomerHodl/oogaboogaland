# Lighthouse accessible names: issue #157

The supplied Lighthouse report found an unsupported name on the generic `time` element and a destination button whose fixed name omitted its changing visible label.

The clock keeps its `time` element and `datetime`; the drawn SVG now has the image role and its existing local/Ooga Booga time label. The destination button is labelled by its visible place name plus the existing instructions. Referenced hidden instructions contribute to the accessible name without changing layout. The generic dot-container name is removed.

Chrome accessibility-tree checks passed for all six destinations: Pile, Lab, Mirror, HQ, Basement and Mempool. The existing frozen-clock/block-height check also passed, including glyph centering and independent block updates. These are permanent browser regressions in the header scene. The console was clean. Build, changed-file syntax and whitespace checks pass.

[Native evidence](lighthouse-accessibility-evidence.json) records the actual computed names. No new Lighthouse score or screen-reader playthrough is claimed. The earlier full suite has independent movement/interaction failures; baseline unit fixture repairs are tracked in #158.
