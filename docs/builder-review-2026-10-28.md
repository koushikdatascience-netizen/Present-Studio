# Builder fixes prepared for review

Based on `koushikdatascience-netizen/Present-Studio` main at `c930cff5e25fa889d5af8541a4d9899a3c31d56e`. The changes were prepared and tested locally in `Present-Studio-review` before publication. On 29 October 2026 the owner authorized committing, pushing and redeploying through the repository's validated VPS deployment workflow.

## Changes

- Keep structural edits dirty while slides/images load, then resume autosave after loading. New Slide, Duplicate Slide and Delete Slide now survive reload without requiring a later edit. An existing autosave interrupted by navigation is retained. Pending image insertions and save conflicts still block unsafe saves.
- Render animation previews on a separate Fabric scene. Saving and history see the original authored objects throughout the delay and animation. Repeated previews cancel the previous preview; navigation and editing clean it up. Delayed image decode callbacks cannot display a preview on a different slide.
- Bind Duration and Delay to the generated ribbon controls. Timing edits persist without clicking an animation preset again, including a zero delay.
- Hydrate the enhanced sidebar and controls when the initial presentation fetch finishes before the builder UI script arrives. Both script arrival orders are supported.
- Release room-join database sessions before awaiting socket session operations or state broadcasts. This removes a verified connection-holding path under concurrent joins. It does not establish that every possible cause of the historical production pool timeouts is resolved; other event handlers still need workload-specific investigation if timeouts recur.
- Update builder script cache versions and add regressions.
- Reduce desktop workspace side padding to 8px and remove the slide's height-derived width limit and maximum width. The slide uses the available workspace width while retaining its 16:9 proportions; smaller phone layouts keep their responsive sizing.
- Reveal Insert and scroll to the relevant tools when selecting media, shapes, visuals or Word Art; ordinary text selects Home. Media selection brings Fit without crop into view.
- Offer slide Background color in Home and Insert independently of the selected object. Both controls stay synchronized and colors persist after reload. Hide irrelevant object formatting groups instead of presenting disabled Fill controls for unrelated selections.

## Validation

- Frontend: **117 tests passed**, including eight new behavioral cases for structural autosave, delayed loading, conflict guards, preview isolation/cancellation and timing inputs.
- Backend: **169 tests passed**, including three new connection-lifetime cases. Twenty concurrent joins complete with a pool limited to one connection; socket session and rejection paths also release their connections before transport I/O.
- TypeScript: `npm run check` passed.
- JavaScript syntax and `git diff --check` passed.
- Real browser: the extended `tests/presentation-performance-browser.py` passed with installed Edge and Fabric 5.3.0 against a temporary local database. It checks create/duplicate/delete followed by reload, long-delay animation autosave, repeated previews, timing edits followed by reload, and deliberately delayed builder UI script loading. Existing independent-loading, rapid-navigation, concurrent-save and conflict-export browser checks also passed.
- The extended browser suite also passed workspace width measurements at 1440×900, Background control availability and persistence after reload, shape fill edits, automatic Insert activation for shapes/images, and hiding irrelevant Fill controls. Layout screenshot: `../server-audit-2026-10-28/builder-workspace-review.png`.

The initial full backend run hit the existing native-helper termination test's timing race. Its targeted rerun and the subsequent complete 169-test run passed; the remote-control implementation was not changed.

Local checks reused the existing dependency installation through an ignored `node_modules` junction. The browser test supports optional `PERF_BROWSER_CHANNEL=msedge` when bundled Chromium is unavailable; CI's default remains unchanged. SQLite test databases are ignored and contain only generated test data. The final browser screenshot is saved outside the checkout at `../server-audit-2026-10-28/builder-fixed-review.png`.

## Review files

- `frontend/js/editor.js`: autosave scheduling and load completion.
- `frontend/js/builder-ui.js`: isolated previews, timing bindings and late initialization.
- `frontend/builder.html`: cache versions.
- `backend/app/socket_manager.py`: room-join session lifetimes.
- `tests/builder-ribbon-regressions.test.cjs`: focused builder behavior.
- `tests/presentation-performance-browser.py`: real browser persistence and load-order cases.
- `tests/slide-image-persistence.test.cjs`: updated conflict-guard assertion.
- `backend/tests/test_socket_connection_lifetime.py`: bounded-pool regressions.
