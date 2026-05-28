## 2026-05-16 - [Snap-back Animation & Contrast Compliance]
**Learning:** Adding a `transition` to a draggable element provides a "premium" feel by smoothly returning it to its origin, but it MUST be disabled during active dragging (using a class like `.dragging`) to prevent "laggy" follow behavior. Additionally, ensuring secondary text meets WCAG AA contrast standards in dark mode (e.g., shifting from `#94a3b8` to `#cbd5e1`) significantly improves readability without breaking the dark aesthetic.
**Action:** Use `.dragging` class to toggle transitions on interactive elements; audit all text-muted colors for contrast compliance.

## 2026-05-17 - [UI State Persistence & Rich Sharing]
**Learning:** When navigating between items in a stack (like cards), failing to reset UI state (e.g., expanded `<details>` sections) can lead to "information leakage" where context from a previous item is mistakenly shown for the new one. Additionally, enhancing clipboard sharing with semantic metadata (agent name, full context) transforms a simple copy-paste into a useful debugging and collaboration tool.
**Action:** Always reset transient UI expansion/focus states during item transitions; include relevant metadata in clipboard payloads for "rich" sharing.

## 2026-05-18 - [Gesture Threshold Visual Feedback]
**Learning:** In touch-first interfaces using swipe gestures, providing immediate visual state changes (like a halo/ring and background tint) when an action threshold is reached significantly improves "discoverability" and reduces user anxiety about whether an action will trigger. Using `color-mix` for subtle background tints allows for responsive feedback that works across light and dark modes without hardcoding numerous color variants.
**Action:** Implement active visual state changes for gesture-based interactions to confirm intent before the action is finalized.

## 2026-05-19 - [Discoverability via On-Demand Help]
**Learning:** For keyboard-heavy "power user" interfaces, rely on invisible shortcuts alone creates a steep learning curve. Providing a universal, on-demand help trigger (like `?`) that displays a transient summary of available actions via existing notification systems (like toasts) bridges the gap between discoverability and a clean, minimal UI.
**Action:** Always provide a help shortcut (`?`) that surfaces available keyboard interactions in a non-intrusive way.

## 2026-05-24 - [Keyboard Accessibility & Feedback Reinforcement]
**Learning:** Implementing a "Skip to content" link is a critical yet often overlooked accessibility feature for keyboard-only users, significantly reducing "tab fatigue" in applications with global headers. Additionally, subtle animations (like a pulse) on state-indicating elements (like a queue counter) bridge the gap between "something happened" and "I see what changed," reinforcing the user's mental model of the system state without being distracting.
**Action:** Always include a skip link for main content in layout templates; use subtle, non-intrusive animations to signal important state transitions.

## 2026-05-20 - [Context-Aware Global Shortcuts]
**Learning:** Adding intuitive global shortcuts (like `Enter` for a primary action) improves flow, but without explicit target gating (e.g., checking `e.target.tagName`), these shortcuts can collide with native browser behaviors for focused interactive elements like buttons, links, or `<summary>` tags.
**Action:** When implementing global keyboard listeners, always exclude active interactive elements from triggering primary action aliases to preserve standard accessibility expectations.

## 2026-05-20 - [Accessibility: Skip to Content Link]
**Learning:** Implementing a "Skip to content" link as the first focusable element on a page significantly improves the experience for keyboard and screen reader users by allowing them to bypass repetitive navigation and jump straight to the primary task. For maximum effectiveness, it should be visually hidden until focused and transition smoothly into view.
**Action:** Always include a skip-link in keyboard-heavy or navigation-rich PWAs to satisfy WCAG 2.4.1 (Bypass Blocks); ensure it is the first child of the <body>.

## 2026-05-25 - [Celebratory Completion & Screen Reader Granularity]
**Learning:** Providing a distinct "success" state when a user completes a repetitive task queue (like reviewing items) transforms a routine action into a moment of closure and delight. Coupling this with haptic feedback reinforces the accomplishment. Additionally, for progress indicators,  is essential for translating abstract percentages into human-readable context (e.g., "Item 1 of 5") that is immediately useful to screen reader users.
**Action:** Always provide a celebratory state or message upon task completion; use `aria-valuetext` to provide human-readable context for abstract progress metrics.

## 2026-05-27 - [Sticky Actions & Glassmorphism Polishing]
**Learning:** For variable-length content (like suggestions with long descriptions), anchoring primary actions (Approve/Reject) using `position: sticky` ensures they remain "at the user's fingertips" regardless of scroll depth. Applying a glassmorphism effect (`backdrop-filter: blur`) with a semi-transparent `color-mix` background provides a premium, "built-in" feel while maintaining legibility of actions when they overlay content.
**Action:** Use sticky positioning for critical action bars in scroll-heavy views; pair with glassmorphism and subtle borders for visual separation.

## 2026-05-25 - [Celebratory Completion & Screen Reader Granularity]
**Learning:** Providing a distinct "success" state when a user completes a repetitive task queue (like reviewing items) transforms a routine action into a moment of closure and delight. Coupling this with haptic feedback reinforces the accomplishment. Additionally, for progress indicators, `aria-valuetext` is essential for translating abstract percentages into human-readable context (e.g., "Item 1 of 5") that is immediately useful to screen reader users.
**Action:** Always provide a celebratory state or message upon task completion; use `aria-valuetext` to provide human-readable context for abstract progress metrics.

## 2026-05-28 - [Shortcut Discoverability & Semantic Focus]
**Learning:** Explicitly advertising alternative shortcuts (like Arrow keys) in tooltips, ARIA labels, and help systems significantly improves discoverability for new users while preserving a clean UI. Additionally, implementing semantic focus states (e.g., green for approve, red for reject) provides immediate, non-textual confirmation of the targeted action, reinforcing the user's mental model of the system.
**Action:** Always include alternative shortcuts in `title` and `aria-keyshortcuts` attributes; use semantic colors for focus-visible states on high-stakes action buttons.
