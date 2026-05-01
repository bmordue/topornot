## 2025-01-24 - [Discoverability of Keyboard Shortcuts]
**Learning:** Even if keyboard shortcuts are implemented, they are effectively non-existent to users if they aren't surfaced in the UI. Adding visual hints like `<kbd>` tags significantly improves UX by making power-user features discoverable.
**Action:** Always look for existing but hidden shortcuts or features and surface them with subtle UI hints.

## 2025-01-24 - [Robust Keyboard Shortcuts]
**Learning:** Keyboard event listeners that check for specific characters (like 'a' or 'z') are brittle if they don't account for case. Normalizing `e.key.toLowerCase()` ensures shortcuts work regardless of Caps Lock state or modifier keys, providing a more reliable experience.
**Action:** Always normalize keyboard input to lowercase when implementing single-character shortcuts.

## 2026-04-28 - [Visual Feedback for Keyboard Shortcuts]
**Learning:** Keyboard shortcuts lack the tactile and visual feedback of physical button clicks. Adding a brief visual "flash" (e.g., a momentary CSS `scale` or `background` change) to the corresponding UI button when a shortcut is pressed bridges this gap and confirms the action to the user.
**Action:** Implement a helper function like `flashButton()` to trigger an active state on UI buttons when their mapped keyboard shortcuts are used.

## 2026-05-15 - [Active Loading Feedback]
**Learning:** Users can be unsure if a refresh or sync action is actually working if the response is fast or the UI doesn't change much. Adding a temporary "spinning" state to icons provides immediate acknowledgement of the user's intent and confirms the system is active.
**Action:** Use CSS animations (like a spin keyframe) and toggle a 'spinning' class during asynchronous load or refresh operations.

## 2026-05-01 - [Visual Feedback for All Swipe Directions]
**Learning:** When an interface supports multi-directional gestures (like swiping left, right, and up), every direction must have consistent visual feedback. If only some directions show hints or card movement, the others feel broken or hidden. Enabling `translateY` alongside `translateX` and adding a corresponding "DEFER" hint completes the mental model of the card stack for the user.
**Action:** Ensure all supported gestures have matching visual indicators and physical transformations to provide a cohesive experience.
