# QR code logo

Save the brand logo here as `qr-logo.png` (PNG with a transparent background works best; JPG and SVG also work).
Every QR code from `GET /api/v1/links/{id}/qr` then gets the logo in the middle, on a small badge in the QR
background color. Codes switch to the highest error-correction level so they still scan.

- No file here = plain QR codes (nothing breaks).
- To keep the logo somewhere else, set `QR_LOGO_PATH=/absolute/path/to/logo.png`.
- A single request can skip the logo with `?logo=0`.
- Restart the server after replacing the file (the logo is read once and cached).
