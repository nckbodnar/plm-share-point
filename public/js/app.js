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
  
  // Highlight active menu item
  highlightActiveMenuItem();
});

// Highlight the active menu item based on current path
function highlightActiveMenuItem() {
  const currentPath = window.location.pathname;
  const menuLinks = document.querySelectorAll('.sidebar .nav-link');
  
  menuLinks.forEach(link => {
    link.classList.remove('active');
    const href = link.getAttribute('href');
    
    if (href === currentPath || 
        (href === '/drawings' && currentPath === '/') ||
        (currentPath.startsWith(href) && href !== '/')) {
      link.classList.add('active');
    }
  });
}

// ---------------------------------------------------------------------------
// Shared CRUD helpers used by drawings/detail, projects/detail, groups/detail
// ---------------------------------------------------------------------------

/**
 * Send a DELETE request to `url` using the provided CSRF token, then
 * call `onSuccess`. Shows an alert on failure.
 */
async function removeAssignment(url, csrf, onSuccess) {
  if (!confirm('Remove this assignment?')) return;
  const r = await fetch(url, { method: 'DELETE', headers: { 'x-csrf-token': csrf } });
  if (r.ok) onSuccess();
  else alert('Error: ' + await r.text());
}

/**
 * Read data-url / data-csrf from a remove-member button and DELETE the resource.
 */
async function removeMember(btn) {
  if (!confirm('Remove this member?')) return;
  const r = await fetch(btn.dataset.url, { method: 'DELETE', headers: { 'x-csrf-token': btn.dataset.csrf } });
  if (r.ok) window.location.reload();
  else alert('Error: ' + await r.text());
}

/**
 * Serialize a form as JSON and PUT it to `url`, then reload on success.
 */
async function submitEdit(url, formId, csrf) {
  const form = document.getElementById(formId);
  const body = {};
  new FormData(form).forEach((v, k) => { body[k] = v; });
  const r = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
    body: JSON.stringify(body),
  });
  if (r.ok) window.location.reload();
  else alert('Save failed: ' + await r.text());
}

/**
 * DELETE an entity and redirect to `redirectTo` on success.
 */
async function deleteEntity(url, csrf, redirectTo) {
  if (!confirm('Permanently delete this item?')) return;
  const r = await fetch(url, { method: 'DELETE', headers: { 'x-csrf-token': csrf } });
  if (r.ok) window.location.href = redirectTo;
  else alert('Delete failed: ' + await r.text());
}
