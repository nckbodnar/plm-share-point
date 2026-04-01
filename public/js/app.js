/**
 * PLM SharePoint – client-side helpers
 *
 * Kept minimal intentionally: no bulk-download helpers, no data-export buttons.
 */

'use strict';

// Disable right-click save on document iframes to discourage casual exfiltration.
// (Not a security boundary – true access control is server-side.)
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.doc-viewer iframe').forEach((iframe) => {
    iframe.addEventListener('contextmenu', (e) => e.preventDefault());
  });
});
