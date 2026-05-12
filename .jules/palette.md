## 2026-05-05 - [Dynamic Feedback in Page Title]
**Learning:** Real-time information like a queue count is highly valuable but can clutter a small mobile interface. Utilizing the document title (`document.title`) provides this state globally and subtly across browser tabs without consuming UI real estate.
**Action:** Consider updating the page title to reflect the application's primary state or pending item count.

## 2026-05-05 - [Semantic Accessibility]
**Learning:** Modern screen readers rely heavily on semantic landmarks. Converting generic `div` containers for the main content ("card") and primary actions ("action-bar") into `<article>` and `<nav>` with appropriate ARIA labels significantly improves navigation for assistive technology users.
**Action:** Always audit for generic `div` usage where semantic elements like `<article>`, `<nav>`, or `<aside>` would be more descriptive.

## 2026-05-06 - [Accessible Shortcuts & Tactile Feedback]
**Learning:** Hardcoding keyboard shortcuts in `aria-label` (e.g., "Refresh (R)") causes redundant or confusing announcements in some screen readers. Using `aria-keyshortcuts` combined with `aria-hidden="true"` on visual `<kbd>` elements provides a cleaner, more semantic experience. Adding a tiny 10ms haptic vibration (`navigator.vibrate`) provides a surprising "touch of delight" that confirms actions on mobile devices.
**Action:** Prefer `aria-keyshortcuts` for keyboard interactions and consider micro-haptics for primary action confirmation.

## 2026-05-08 - [Dark Mode & Threshold Haptics]
**Learning:** Implementing Dark Mode requires careful attention to secondary components like skeleton loaders and toast notifications; simply inverting the main background isn't enough for a polished feel. Skeletons should use darker, more subtle gradients (e.g., `#334155` to `#475569`) to avoid jarring contrast. Additionally, triggering haptic feedback (`vibrate(10)`) exactly when a gesture crosses a decision threshold provides a critical "physical" confirmation that enhances user confidence during complex interactions.
**Action:** Always refine skeleton loaders and toasts for dark themes; use haptics to mark interaction boundaries.

## 2024-05-11 - [Visual Progress and Descriptive Position Announcements]
**Learning:** A visual progress bar at the top of a card-based interface provides immediate, non-intrusive feedback on task progress. Combining this with `aria-atomic` on dynamic counts and explicit `aria-label` for position (e.g., "Suggestion 1 of 10") significantly improves the experience for both visual and assistive technology users.
**Action:** Use unobtrusive progress indicators for sequential tasks and ensure dynamic counters use `aria-atomic` for complete context updates.

## 2026-05-12 - [Contrast Compliance & Interaction Safeguards]
**Learning:** WCAG AA compliance for white text on colored backgrounds often requires darker "600/700" shades (e.g., Indigo #4f46e5) than default branding. Enabling text selection (`user-select: auto`) is a vital usability baseline for information-heavy cards. Additionally, global keyboard shortcuts MUST include safeguards against triggering when the user is focused on an input or textarea to prevent disruptive interactions.
**Action:** Audit color variables for AA contrast; avoid `user-select: none` on content; always verify `e.target` in global key listeners.
