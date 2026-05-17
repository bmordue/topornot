## 2026-05-16 - [Snap-back Animation & Contrast Compliance]
**Learning:** Adding a `transition` to a draggable element provides a "premium" feel by smoothly returning it to its origin, but it MUST be disabled during active dragging (using a class like `.dragging`) to prevent "laggy" follow behavior. Additionally, ensuring secondary text meets WCAG AA contrast standards in dark mode (e.g., shifting from `#94a3b8` to `#cbd5e1`) significantly improves readability without breaking the dark aesthetic.
**Action:** Use `.dragging` class to toggle transitions on interactive elements; audit all text-muted colors for contrast compliance.

## 2026-05-17 - [UI State Persistence & Rich Sharing]
**Learning:** When navigating between items in a stack (like cards), failing to reset UI state (e.g., expanded `<details>` sections) can lead to "information leakage" where context from a previous item is mistakenly shown for the new one. Additionally, enhancing clipboard sharing with semantic metadata (agent name, full context) transforms a simple copy-paste into a useful debugging and collaboration tool.
**Action:** Always reset transient UI expansion/focus states during item transitions; include relevant metadata in clipboard payloads for "rich" sharing.
