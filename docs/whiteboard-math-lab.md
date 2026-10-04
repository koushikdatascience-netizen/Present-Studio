# Whiteboard Math Exploration

- Sequences: integer indices (entered as x), 2–500 terms, term plots and compensated finite partial sums. Presets: geometric, harmonic, alternating.
- Calculus: symbolic antiderivatives, definite integrals and finite-point limits through Nerdamer 1.1.13 in a dedicated worker. Eight-second timeout; unresolved expressions remain explicitly unresolved. Antiderivatives include the integration constant.
- Visuals: sampled function plots, shaded definite-integral regions, left/right approach samples, and matrix heatmaps through Plotly 2.35.2. Explicit 2D functions and Riemann lessons can be inserted as editable vector objects, not snapshots.
- Matrices: real rectangular matrices up to 4 by 4. Determinant, inverse, transpose, addition, multiplication and LU linear-system solving through mathjs 13.2.3.

This is not a general proof engine. Finite partial sums do not establish infinite-series convergence. Limit samples are not proofs. Integration rejects sampled undefined/non-real values, but sampling cannot identify every discontinuity; improper integrals and branch-sensitive problems require separate mathematical analysis. Symbolic results depend on the engine's supported functions and assumptions. Plots are finite-resolution illustrations, not exact geometric objects.

All libraries load from pinned CDN URLs. Symbolic worker loading, current browser layouts and production storage insertion still require browser/end-to-end verification. Unit tests cover input bounds, matrix validation and worker dispatch, not symbolic-engine correctness.

## Live Objects

The board stores vector primitives with `wbMath` mathematical metadata. Presenter/co-host selection restores editable parameters; dragging/resizing moves the whole object. Number-line markers, triangle vertex C, tangent position and fraction-strip filling have direct pointer interactions. A floating Live Math panel exposes the same controls and parameter animation. Equations retain `wbLatex` and use vector glyph paths; select an equation and open Equation Studio to edit it.

Available shared lessons: explicit single-function 2D graphs, fraction strips, number lines, triangle angles, tangent/secant demonstrations, midpoint Riemann rectangles and rotation/stretch matrix transformations. Objects survive save/reload, page copies and undo/redo. Existing image objects are not automatically converted.

Presenter changes are broadcast through the existing revision-checked board channel, throttled at roughly 650 milliseconds plus network/save time. Audience canvases display the synchronized vector state and do not write to the teacher's board. This is not yet independent audience exploration or frame-synchronized animation; presenter animations render locally every 150 milliseconds and viewers receive saved parameter states. Simultaneous co-host edits may produce an explicit revision conflict rather than silently overwrite work.

Shared sequences and Three.js surfaces retain editable mathematical parameters. Surface viewers can orbit locally without changing the teacher's camera. Shared implicit/parametric objects, arbitrary matrix heatmaps, full constrained geometry construction and independent learner copies remain pending. Unsupported shared insertion does not fall back to a bitmap. PDF pages remain document-image references. Chrome multi-client synchronization and reconnect checks have passed; Safari, production storage and real audio/video transport still require verification.
