# Contributing to PHI Scrubber

Thank you for helping. This tool stands between patient records and
third-party services, so a few rules here are stricter than in most projects.

## The one hard rule: no real patient information

Never put real protected health information in an issue, pull request,
commit, test fixture, screenshot or discussion. That includes "lightly
edited" real notes.

To report something the scrubber missed, write an **invented** example with
the same shape. If the miss was `Pt: SMITH,JOHN A` in a real note, report
`Pt: DOE,JANE Q`. The pattern is what matters, not the person.

If you see real PHI anywhere in this repository, do not quote it. Follow
[SECURITY.md](SECURITY.md) so it can be removed.

## Reporting a problem

- **A missed identifier** (something that should have been removed): use the
  "Missed identifier" issue form.
- **Over-redaction** (clinical content removed or flagged by mistake) or any
  other defect: use the "Bug report" form.
- **A way for text to leave the page**: do not open a public issue. See
  [SECURITY.md](SECURITY.md).

## Setting up

You need Node 22 or later and Python 3. There is nothing to install.

```bash
npm test
```

```bash
python3 dev-server.py
```

Then open <http://localhost:8742>.

## Making a change

1. Fork the repository and create a branch from `main`.
2. Make the change. Scrubbing rules live in `src/phiScrub.js`; the page
   controller is `src/app.js`.
3. Add or update a test in `test/` using invented data.
4. Run `npm test` and check the page by hand in a browser.
5. Open a pull request that explains what the change catches or fixes.

## Design principles

Changes are reviewed against these.

- **Fail closed.** When a rule cannot decide, it removes the text or flags it
  for review. A rule that trades a leak for a tidier result will not be
  accepted.
- **Nothing leaves the page.** Do not add network requests, analytics, remote
  fonts, CDN links or storage. Do not loosen the Content-Security-Policy in
  `index.html`.
- **No build step and no runtime dependencies.** The project is static files
  that a reviewer can read as shipped. New third-party code must be vendored,
  licence-compatible, and justified in the pull request.
- **Rules stay pure.** `src/phiScrub.js` has no DOM access and no I/O, so the
  same code runs in the page, in tests and in the prompt guard.
- **Every rule has a test.** Include a case that must be removed and, where
  it applies, a nearby case that must be kept.
- **The person is the final check.** Prefer surfacing an uncertain word for
  review over silently guessing.

## Style

Match the surrounding code: ES modules, two-space indentation, single quotes,
semicolons. Comments explain why a rule exists, including the real-world
shape that motivated it (described, never quoted from a real note).

## Licence

By contributing you agree that your contribution is released under the
[MIT License](LICENSE).
