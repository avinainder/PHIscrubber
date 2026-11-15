# Third-party notices

PHI Scrubber's own code is released under the [MIT License](LICENSE). The
`vendor/` directory contains unmodified builds of the libraries below, which
remain under their own licences.

| Component | Files | Licence | Source |
| --- | --- | --- | --- |
| PDF.js 4.10.38 | `vendor/pdfjs/pdf.min.mjs`, `vendor/pdfjs/pdf.worker.min.mjs` | Apache-2.0 ([text](vendor/pdfjs/LICENSE)) | <https://github.com/mozilla/pdf.js> |
| tesseract.js | `vendor/tesseract/tesseract.esm.min.js`, `vendor/tesseract/worker.min.js` | Apache-2.0; bundles regenerator-runtime (MIT) ([notice](vendor/tesseract/LICENSE-tesseract.js)) | <https://github.com/naptha/tesseract.js> |
| tesseract.js-core | `vendor/tesseract/tesseract-core-simd-lstm.wasm.js` | Apache-2.0 ([text](vendor/tesseract/LICENSE-tesseract.js-core)) | <https://github.com/naptha/tesseract.js-core> |
| Tesseract English language model | `vendor/tesseract/eng.traineddata.gz` | Apache-2.0 | <https://github.com/tesseract-ocr/tessdata_fast> |

When updating a vendored library, replace its files and licence text
together and update the version in this table.
