# Security policy

## What counts as a vulnerability

PHI Scrubber promises that the original note never leaves the browser tab.
Anything that breaks that promise is a security issue, for example:

- a way for note text, an opened file or OCR output to be sent over the
  network, written to storage, or leaked through a URL or the referrer;
- a bypass or weakening of the Content-Security-Policy in `index.html`;
- script injection through a pasted note, PDF or image;
- a vendored library with a known vulnerability that is reachable from the
  page;
- real patient information committed to this repository.

A missed identifier (a name or number the rules did not remove) is a defect
rather than a vulnerability. Report it with the "Missed identifier" issue
form, using an invented example.

## Reporting

Please report privately. Do not open a public issue.

Use GitHub's private vulnerability reporting: open the repository's
**Security** tab and choose **Report a vulnerability**.

Include the browser and version, the steps to reproduce, and what leaves the
page. **Do not include real patient information** in the report; an invented
note that triggers the same behaviour is enough.

## What to expect

This project is maintained by volunteers. Reports are acknowledged as soon as
practical, and confirmed issues are fixed on `main` with credit to the
reporter unless they prefer otherwise.

## Supported versions

Only the latest commit on `main` is supported. If you host your own copy,
update it when a security fix lands.
