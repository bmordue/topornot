## 2025-05-14 - [Shortcut Discoverability & Accessibility]
**Learning:** Keyboard shortcuts are powerful but invisible. Surfacing them with `<kbd>` tags directly on buttons significantly improves discoverability for power users. However, ensure that the visual hints match the implementation (e.g., handling case-insensitivity) to avoid "broken promises".
**Action:** Always pair visual shortcut hints with robust event handling (like `toLowerCase()`) and ensure standard accessibility features like `:focus-visible` and high contrast are implemented alongside UX polish.
