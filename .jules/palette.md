## 2026-05-05 - [Dynamic Feedback in Page Title]
**Learning:** Real-time information like a queue count is highly valuable but can clutter a small mobile interface. Utilizing the document title (`document.title`) provides this state globally and subtly across browser tabs without consuming UI real estate.
**Action:** Consider updating the page title to reflect the application's primary state or pending item count.

## 2026-05-05 - [Semantic Accessibility]
**Learning:** Modern screen readers rely heavily on semantic landmarks. Converting generic `div` containers for the main content ("card") and primary actions ("action-bar") into `<article>` and `<nav>` with appropriate ARIA labels significantly improves navigation for assistive technology users.
**Action:** Always audit for generic `div` usage where semantic elements like `<article>`, `<nav>`, or `<aside>` would be more descriptive.

## 2026-05-06 - [Accessible Shortcuts & Tactile Feedback]
**Learning:** Hardcoding keyboard shortcuts in `aria-label` (e.g., "Refresh (R)") causes redundant or confusing announcements in some screen readers. Using `aria-keyshortcuts` combined with `aria-hidden="true"` on visual `<kbd>` elements provides a cleaner, more semantic experience. Adding a tiny 10ms haptic vibration (`navigator.vibrate`) provides a surprising "touch of delight" that confirms actions on mobile devices.
**Action:** Prefer `aria-keyshortcuts` for keyboard interactions and consider micro-haptics for primary action confirmation.
