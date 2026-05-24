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
