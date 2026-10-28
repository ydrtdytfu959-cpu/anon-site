# Cinematic Commerce 3.0 release verification — October 27, 2026

PR #29: https://github.com/ydrtdytfu959-cpu/anon-site/pull/29.
The owner explicitly authorized this PR and necessary corrections to merge and release through the existing GitHub Pages workflow **after all release gates pass**. No backend deployment, infrastructure change, payment activation, spending increase or customer-data operation is authorized.

## CI recovery

Run `40572810430` failed on the first WebKit Cinematic viewport: `scripts/browser-cinematic.cjs:92` observed a hidden search dialog after clicking its opener. This exposed an existing application race, also present in the pre-Cinematic baseline: a pending catalog request called `renderRoute({focus:false})`, which unconditionally closed the current dialog. Local immediate fixture responses could finish before the click and conceal the race.

The new `scripts/browser-dialog-refresh.cjs` deliberately holds catalog responses, opens and types into the real dialog, then releases the responses. It failed before the correction with `search remains open after delayed catalog refresh` (false versus true). The application now preserves active dialogs only for a guarded background catalog completion. Normal navigation still closes them. Header replacement reapplies expanded state and inert backgrounds; closing a dialog restores focus to its current opener.

The regression covers search and assistant, mobile touch and desktop keyboard, English and Arabic, Chromium/Firefox/WebKit: **24 cases passed**. Each verifies retained draft, dialog DOM and focus, Tab/Shift+Tab containment, Escape focus restoration and dismissal on actual route navigation. The test waits for the existing initial animation-frame focus before entering text; it never waits for the catalog before opening the dialog. No assertions or browser engines were removed. Independent read-only review found no blocking flaw in the correction.

## Final local gates

Final HTML SHA-256: `827f819a68920f3ac5fd354f4573607b7730d6bc6518a5de89dfa38fc98abd53`.

- `npm run build` and `npm run check`: passed.
- `npm test`: 420 passed, zero failures/skips.
- `ENGINES=chromium,firefox,webkit npm run test:browser`: passed, including the existing catalog, commerce, security and icon suites, 264 Cinematic checks, isolated preview/comparison checks and 24 new dialog cases.
- Additional responsive matrix: 156 checks at 320, 375, 430, 768, 1920 and 844×390.
- Fresh Search/Assistant screenshots: 12 images across mobile/desktop and all three engines; inspected representative search and assistant compositions in every engine. Saved locally under ignored `test-results/cinematic-release-dialogs`.
- Existing 146 published comparison screenshots remain valid design evidence; the correction changes dialog lifecycle and focus behavior, not layout/styles. They retain their original source hash and date rather than being relabeled as new captures.
- Paired performance/fallback rerun: 12 local Chromium runs, no failures/warnings. Candidate median LCP 108ms standard / 680ms constrained; startup CLS 0. Compressed document 436,993 bytes versus baseline 431,452 (+1.28%). Reduced motion/transparency, forced colors, 200% root text, 320px width and reduced-height search checks passed. These remain fixture-based laboratory observations, not field Core Web Vitals or physical Safari certification.

Canonical catalog, authentication and commerce modules and backend/AWS files remain byte-identical to the hardening baseline. The final source diff contains only the targeted frontend lifecycle correction, its regression and release documentation. There are no new dependencies or customer/credential fixtures.

## Publication and release evidence

The corrected commit must receive a successful `catalog` check on its actual remote head before merge. Record the final local/remote/merge SHAs, CI and Pages links, production HTML hash and smoke observations in `../anox-cinematic-publication/CONTINUATION.md` and the PR. Do not infer deployment from local tests or merge status.

Use the existing frontend Pages release mechanism only. If a serious production regression is confirmed, use a normal reviewed Git revert of the frontend release and the same Pages deployment path; do not reset backend resources, counters or customer data. Physical-device keyboards, assistive-technology certification and field performance remain nonblocking measurement limitations. Live stock, price and retailer coverage require current provider evidence, not synthetic captures.
