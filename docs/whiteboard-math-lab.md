# Whiteboard Math Exploration

## Polar Graphs and Math Input

Graph Lab supports polar curves r(theta), with Cardioid, Limacon, Rose, Lemniscate and Spiral presets. Sliders control a and k. Polar, parametric and implicit 2D plots use equal-aspect axes. Domain fields accept finite expressions such as `2*pi`, `pi/2`, `-3pi`, `sqrt(4)` and `360°`; they reject assignments and programming commands.

Graph expressions accept Unicode math symbols and supported LaTeX fractions, radicals, trigonometric functions and logarithms. Equation Studio's Graph this equation action converts supported equations into polar, explicit or implicit Graph Lab input. This is a bounded input converter, not a general LaTeX parser.

Math fields in Graph Lab, Calculator, Math Lab, Live Math and Advanced panels open an automatic on-screen keyboard with Basic, Function and Polar tabs. Selection wrapping, caret movement and deletion preserve field focus. ABC enables the device keyboard on touch screens. Equation Studio uses MathLive's own keyboard on focus.

Polar live objects retain editable expressions, domains and parameter a in `wbMath` metadata. The k value from Graph Lab is substituted into the shared expression. Rings, rays and curves are Fabric vector primitives, not images; existing whiteboard document synchronization displays them on audience and screen canvases. Parametric and implicit graphs are interactive in Graph Lab but are not yet shareable live objects. Sampled polar plots are illustrations, not proofs of symmetry, area, tangents or continuity.

Plotly's graph SVGs explicitly override the whiteboard's 18px icon sizing; modebar icons retain icon dimensions. Browser verification results must be reported separately from unit tests; Safari and production transport are not implied by Chromium checks.

Current integration blocker: `backend/app/whiteboard.py` rejects `wbMath.kind = "polar"` with HTTP 422. This frontend-only change leaves that validator untouched. Local vector insertion and generic audience-canvas deserialization pass, but polar persistence and real meeting synchronization are not operational until the backend whitelist is updated.

Verification on 6 October 2026: all 24 whiteboard unit tests and changed-JavaScript syntax checks pass. A real Chromium harness passes at desktop and 390px mobile sizes using pinned mathjs, Plotly and Fabric: five polar presets, SVG dimensions, cardioid extrema, keyboard focus/insertion/wrapping/deletion/domain input, MathLive focus, equation-to-graph action, vector rendering at a=1/a=2 and a five-petal rose, and generic viewer JSON rendering. The isolated FastAPI preview's actual controller renders a polar insertion but rejects its save with the 422 above. `present.html` and `screen.html` need no new renderer script because they deserialize Fabric primitives through `whiteboard-view.js`; their real cross-client polar synchronization remains blocked and unverified. Safari was not tested.

Re-run: `node --test tests/whiteboard-*.test.cjs`; with Playwright installed or available on `NODE_PATH`, `node tests/whiteboard-browser.cjs`. Set `WB_SCREENSHOTS` for screenshot output and optionally `WB_APP_URL` for a disposable local app using the demo owner account; the app check creates a test meeting. Do not point that demo check at production.

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
