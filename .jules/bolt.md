## 2025-05-15 - [O(1) ID Lookups & Optimized Sorting]
**Learning:** For simple file-based JSON DBs, maintain an in-memory `Map` index to avoid O(n) array searches on every update/read. Leveraging insertion order for sorting (`.reverse()` vs `.sort()`) can provide ~10-20x speedup on retrieval for large datasets.
**Action:** Always check if a collection is already sorted by a key before applying a manual sort. Implement Map indexes for frequently accessed IDs.

## 2025-05-16 - [O(1) Subset Caching & I/O Skip]
**Learning:** Maintaining an in-memory Map for frequently filtered subsets (like 'pending' status) avoids O(N) filtering costs. Combining this with early returns for no-op updates significantly reduces blocking disk I/O in file-based databases.
**Action:** For any "status" or "filtered view" that is frequently accessed, maintain a dedicated in-memory index. Always check for no-op state updates before performing expensive serialization/disk operations.

## 2025-05-17 - [Result Caching & Fast ETag Validation]
**Learning:** Even with in-memory Maps, repeatedly converting values to arrays or reversing them can be O(N) and costly at high frequency. Pre-caching these result arrays and using a simple version counter for fast ETag validation allows the server to bypass JSON serialization entirely for unchanged data, significantly reducing CPU and latency.
**Action:** Implement result-level caching for frequently accessed read views. Use a version counter to enable fast path ETag checks before performing any heavy lifting (like serialization or database queries).

## 2025-05-18 - [Granular Cache Invalidation]
**Learning:** When using result caching for multiple views (e.g., 'all' vs 'pending'), a write operation may only affect a subset of those views. In-place mutation of objects within cached arrays allows the 'all' view to remain valid during status updates, avoiding redundant O(N) copy/reverse operations.
**Action:** Implement granular invalidation in the save path. Identify which result caches are truly invalidated by a specific change and preserve others to maximize cache hits and minimize CPU work.

## 2025-05-19 - [RAF Throttling & Layer Promotion]
**Learning:** High-frequency input events like `touchmove` can trigger redundant DOM updates that exceed the screen's refresh rate, causing "jank" and wasted CPU cycles. Throttling these updates with `requestAnimationFrame` ensures we only render once per frame. Combining this with `will-change` layer promotion offloads transformations to the GPU, keeping the main thread free.
**Action:** Use `requestAnimationFrame` to throttle DOM manipulations in response to high-frequency events (`scroll`, `resize`, `touchmove`). Apply `will-change` to elements that are frequently animated or transformed to leverage compositor optimization.

## 2025-05-20 - [Lazy JSON Caching & Incremental Array Updates]
**Learning:** Even with Map indexes and array caches, JSON serialization and array reconstruction (reverse/filter) can be O(N) and expensive for large datasets. Caching the final stringified JSON and performing incremental array mutations (unshift, push, splice) during writes reduces the read path to a true O(1) operation.
**Action:** For high-traffic read endpoints, cache the pre-stringified JSON response. Update internal array caches incrementally during writes instead of invalidating them to eliminate O(N) overhead on subsequent reads.
