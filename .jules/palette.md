## 2025-01-24 - [Discoverability of Keyboard Shortcuts]
**Learning:** Even if keyboard shortcuts are implemented, they are effectively non-existent to users if they aren't surfaced in the UI. Adding visual hints like `<kbd>` tags significantly improves UX by making power-user features discoverable.
**Action:** Always look for existing but hidden shortcuts or features and surface them with subtle UI hints.

## 2025-01-24 - [Robust Keyboard Shortcuts]
**Learning:** Keyboard event listeners that check for specific characters (like 'a' or 'z') are brittle if they don't account for case. Normalizing `e.key.toLowerCase()` ensures shortcuts work regardless of Caps Lock state or modifier keys, providing a more reliable experience.
**Action:** Always normalize keyboard input to lowercase when implementing single-character shortcuts.
