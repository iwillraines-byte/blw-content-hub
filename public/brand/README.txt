Brand assets — drop replacements here using the SAME filenames to swap them
across the entire app without changing code.

  blw-logo.svg          — Full BLW Studio horizontal lockup. Used in: login,
                          sidebar header (when desktop, full width).
  blw-mark.svg          — BLW square mark only (no wordmark). Used as the
                          favicon-shaped tile next to "BLW Studio" in
                          collapsed sidebar / mobile.
  prowiffleball.svg     — ProWiffleball wordmark. Used in: sidebar footer
                          credit, settings → integrations.

You can replace any of these with PNG by saving the new file as the same
basename (e.g. blw-logo.png) AND updating the import in src/brand-assets.js
to the new filename. SVG is recommended — scales cleanly to any size.
