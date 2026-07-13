# Refactor Backlog

## Derived thumbnails for sites without preview assets

Status: non-blocking UX follow-up after the reader/UI extraction.

18comic does not expose cheap thumbnail assets. The panel currently shows a
numbered placeholder until the full image has been loaded through another
consumer. Do not restore eager loading for every visible thumbnail because each
preview would require a full download, anti-scramble decode and Blob allocation.

Target policy:

- Reuse loaded assets and cache a canvas thumbnail capped near 300 px.
- Keep numbered placeholders for missing assets.
- After panel scrolling settles for 200-300 ms, request only the 1-2 items
  nearest the panel viewport center at thumbnail priority.
- Release/cancel stale thumbnail leases when panel scrolling continues.
- Promote and reuse the same request when the user selects an item.
- Never apply this fallback to adapters that provide URL or sprite previews.

Acceptance checks:

- Scrubbing the panel does not create an unbounded decode queue.
- A settled panel gradually fills only its centered previews.
- Selecting an item never starts a duplicate resolve/decode operation.
- E-Hentai and 4KHD thumbnail behavior remains unchanged.

## Scroll position drift after closing the reader on an unloaded image

Status: resolved and accepted. Stage 8 is complete.

Observed behavior from real-site testing:

- Open the reader from scroll mode and navigate to an image that has not yet
  loaded in the underlying scroll page.
- Close the reader. The page returns to the corresponding image, but its
  viewport position is offset.
- After that image has loaded successfully, opening and closing the reader on
  the same image restores the position correctly.
- Other tested reader behavior remains functional.

Working hypothesis (not yet proven):

- The current close path measures and centers the scroll element after two
  animation frames.
- An unloaded item may still be a placeholder, may be replaced by an `<img>`,
  or may change height after its real dimensions become available.
- The restoration therefore uses geometry that can become stale immediately
  after `scrollTo()`. Already-loaded images have stable geometry and do not
  reproduce the drift.

Target fix:

- Record a stable Gallery item key and its relative viewport offset when the
  reader opens or changes the intended return target.
- Resolve the live element again by item key when closing; do not retain a DOM
  reference that may have been replaced.
- If the target is still unloaded, preserve a stable aspect-ratio placeholder
  or perform one bounded correction after the real image dimensions settle.
- Restore with the element anchor plus relative offset instead of always
  forcing the target to the viewport center.
- Keep restoration independent of duplicate image loads and avoid a persistent
  resize/scroll feedback loop.

Acceptance checks:

- Closing on an unloaded image and on an already-loaded image produces the same
  stable target position.
- Placeholder-to-image replacement does not move the target out of position.
- Opening and closing without reader navigation returns to the original
  relative viewport offset.
- Navigating in the reader returns to the selected image with a deterministic
  offset near the viewport reading position.
- The fix works when a previous Gallery page was prepended while the reader was
  open and at document top/bottom boundaries.

Implementation note:

- Reader close now resolves the live element by stable item key and restores an
  element anchor plus relative viewport offset.
- If the target is still a placeholder, one scoped image-loaded subscription
  performs a bounded correction after replacement and then removes itself.
- Local browser smoke reproduced an unloaded third image and measured `0 px`
  error after placeholder-to-image replacement. Real sites still need to
  confirm their layout and native scripts do not introduce an additional shift.
- Real-site testing then reproduced a remaining offset after a large jump to an
  unloaded later page. The first fix corrected only the target replacement;
  earlier placeholders and page batches could continue changing height and move
  the target afterward.
- Reader close now starts a bounded 12-second stabilization period. It observes
  Gallery batch resize, relevant DOM insertion and shared image-loaded events,
  coalescing changes into at most one double-RAF correction at a time.
- The stabilizer disconnects on timeout or the next Reader open. Scroll
  correction does not change batch size, so it does not feed ResizeObserver.
- Browser smoke inserted a delayed `600 px` layout shift before an unloaded
  target after close; the final measured anchor error remained `0 px`.
- A subsequent 4KHD mobile test found visible jitter because the second fix
  observed every Gallery batch for the full stabilization window, including
  already-stable content and layout changes below the target.
- The stabilizer is now conditional: an already-loaded target with no nearby
  preceding placeholders receives one restoration and no long-lived observer.
- For unstable targets, only the target and eight preceding scroll elements are
  resize-observed. Corrections under `2 px` are ignored, and observers exit
  after `750 ms` of stable loaded layout or at the existing 12-second maximum.
- Browser regression retained `0 px` error for the delayed `600 px` shift and
  measured `0 px` drift over the following second for an already-loaded target.
- Real-site testing then exposed the stabilizer's architectural side effects:
  4KHD mobile visibly shook during correction, and a user-triggered back-to-top
  action could be pulled back to the stale Reader anchor for up to 12 seconds.
- The bounded stabilizer is no longer part of the active close path. Every item
  now owns a permanent `.hr-image-slot`; placeholder/image state changes happen
  inside that slot, while the shared loader publishes ready dimensions once to
  the scroll session.
- Reader close synchronizes known dimensions and performs one instant key-based
  position update while PhotoSwipe still covers the viewport. Reader navigation
  returns the target slot to a fixed top baseline, so target height is not part
  of the positioning calculation. No code writes scroll position after reveal.
- Local browser regression measured `top = 0` immediately and one second after
  closing on a previously unrendered target. A subsequent user back-to-top
  remained at `scrollY = 0` after 1.5 seconds. Mobile UI styling and unchanged
  Reader navigation both retained stable close behavior.
- An immediate-close edge case (about 30 ms after a large Reader jump) also
  remained at `top = 0` after dimensions arrived, then respected back-to-top.
- Further real-site evaluation showed the remaining requirement itself was not
  well-defined: a tall viewport can contain several short images, while scroll
  placeholders remain unloaded during Reader use. Resuming them can move the
  selected image even when the initial jump was correct. Exact centering would
  therefore require loading or geometrically controlling the whole visible
  neighbourhood, which is disproportionate to this convenience feature.
- Final implementation removes the geometric slot/dimension registry and retains
  the existing `ReaderSession index -> GalleryItem.key -> .r-ph/.r-img` mapping.
  No-navigation close restores the captured scrollY once. For a navigated close,
  cached dimensions are projected only within a fixed five-item radius before
  one centered jump. Unknown target dimensions use the current placeholder
  geometry without waiting. The
  bounded range matches the existing Reader prefetch radius and creates no image,
  request, decode or new cache. Later natural layout movement is accepted, and
  no post-close code may reclaim scroll ownership.
- Local browser regression confirmed direct positioning even when the host page
  declares smooth scrolling, stable centered placement when cached geometry is
  available, page-start fallback without waiting when it is not, unchanged
  scrollY when Reader navigation does not occur, and correct key lookup after
  content is prepended while Reader is open.
- Final alignment smoke measured a tall `1080px` target at `-182px` versus an
  ideal `-180px` center in a `720px` viewport, and a short `360px` target at
  `178px` versus an ideal `180px` center. Matching the placeholder's projected
  bottom margin to the final image removed the prior roughly 30px replacement
  offset. Returning to the original item key after Reader navigation restored
  the captured `scrollY = 900` exactly instead of performing another jump.
- Real-site verification confirmed that already-rendered targets retain their
  correct position without an extra jump. A large jump to a target that still
  existed as a placeholder could still finish with the resulting image aligned
  near the viewport start instead of centered.
- Real-site verification found that the one-frame target upgrade was not useful
  on 4KHD: the target still finished high in the viewport and the delayed image
  appearance made the second layout calculation visibly shake. That close-time
  upgrade and its temporary image-loaded listener have been removed.
- Reader close returns to one direct centered jump; no close-time request,
  target materialization, wait or second correction remains. Adapters without
  reliable dimensions retain the shared placeholder fallback.
- E-Hentai real-site testing then showed a correctly loaded `800 x 1400` target
  could still finish high in the viewport. Its resolved hath URL, cached natural
  dimensions and final `<img>` aspect ratio were already correct, so this was
  not another metadata gap. Reader return now computes the document scroll top
  directly from the target rectangle and viewport height, avoiding host
  `scrollIntoView` alignment rules while retaining one instantaneous write.
- Mobile E-Hentai tracing confirmed the direct jump itself reached `-0.2 px`
  center error. Within 50 ms the document then shrank by `3,798 px` without any
  additional placeholder replacement: off-screen `.r-ph` elements had been
  estimated by `contain-intrinsic-size: auto 100vh`, then fell back to their real
  `400 px` minimum when the far jump made them render-relevant. Browser scroll
  clamping moved the target from about `501 px` to `82 px`. The placeholder
  intrinsic fallback now matches its actual `400 px` fallback height. Actual
  images retain `content-visibility` and the `100vh` intrinsic fallback; no
  request, observer, delayed scroll or extra DOM is added.
- 4KHD time tracing subsequently showed why its static HTML dimensions were not
  trustworthy: the target placeholder advertised `1300 x 1500`, while the
  loaded image was `1350 x 2024`. Reader return stayed within `0.2 px` of center
  for one second, then four preceding replacements reduced both target document
  top and total document height by about `446 px`. The 4KHD adapter no longer
  publishes those generic display dimensions. It uses the same stable `400 px`
  unknown fallback, while the Reader-loaded target still receives exact shared
  cache geometry before the single centered jump.

Final resolution:

- Reader navigation returns by stable item key and performs at most one direct
  viewport-centered document jump using geometry already available in the
  shared cache.
- Unknown placeholders use a `400 px` intrinsic fallback that matches their real
  minimum; no image is requested for positioning.
- No post-close observer, timer, retry, target materialization or scroll
  correction remains.
- E-Hentai and 18comic real-site verification passed. 4KHD verified exact
  initial centering; later movement caused by previously unknown images loading
  is accepted natural layout behavior, not owned by Reader restoration.
- The issue is closed. Reopen only for a blocking regression such as wrong item
  identity, incorrect initial jump, repeated scroll writes or user input being
  overridden.
