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
**Learning:** For read-heavy API endpoints, caching the pre-stringified JSON response reduces O(N) serialization overhead to O(1). Combining this with incremental updates to in-memory array caches (e.g., `unshift` for LIFO, `push` for FIFO, and `splice` for removals) avoids costly O(N log N) sorting or O(N) filtering on every write, keeping both read and write paths efficient.
**Action:** Identify endpoints that serve stable data structures and implement lazy JSON caching. Maintain array-based caches incrementally during write operations instead of invalidating them entirely.

## 2025-05-21 - [Fragment Joining for Optimized Serialization]
**Learning:** In read-heavy but write-active systems with large JSON datasets, `JSON.stringify` on the entire dataset during setiap save operation becomes a significant bottleneck (blocking the event loop). Maintaining a cache of pre-stringified "fragments" for each record and joining them during serialization reduces the cost from a full object graph traversal to a simple string join, providing ~50-100x speedup for large datasets.
**Action:** When working with file-based persistence for large collections, use fragment joining to minimize the CPU impact of serialization. Maintain a mapping of record IDs to fragment indices for O(1) updates.

## 2026-05-07 - [Lazy Fragment Stringification]
**Learning:** Initializing large in-memory caches with eager `JSON.stringify` calls during database load can cause significant event loop blockage (e.g., ~50ms for 5000 items), even for requests that only need metadata (like ETag validation). Using a lazy pattern with `null` placeholders and on-demand stringification eliminates this cold-start penalty.
**Action:** Use lazy initialization for expensive serialization tasks in read-heavy/cold-start paths.

## 2026-05-08 - [Throttled Disk Persistence]
**Learning:** Frequent synchronous disk I/O (e.g., `fs.writeFileSync`) in the request-response cycle is a massive bottleneck for event-loop responsiveness, especially for burst writes. Implementing a throttled save pattern with a debounce timer and a mandatory `flush()` on process exit improves burst throughput by several orders of magnitude (e.g., ~6000x) while maintaining acceptable durability.
**Action:** Always decouple synchronous I/O from the critical path using batching/throttling. Ensure final persistence via process signal handlers (`SIGTERM`, `SIGINT`).

## 2026-05-16 - [Incremental Array-Based JSON Caching]
**Learning:** Maintaining JSON caches as arrays of pre-stringified fragments instead of monolithic strings enables O(1) or O(P) incremental updates. For LIFO views, the reverse index can be mapped in O(1) via `length - 1 - fIdx`. This avoids O(N) rebuild loops and reduces string allocation overhead.
**Action:** Use array-of-fragments for JSON caches that require partial updates. Ensure state transitions (e.g., pending -> pending) are handled via in-place replacement to prevent duplication.

## 2026-05-17 - [Joined String Memoization]
**Learning:** Even with pre-stringified fragments, the O(N) cost of `.join(',')` and string concatenation for large arrays (e.g., 5000+ items) can consume ~1-2ms of CPU time per request. Memoizing the final joined JSON string until the next data mutation reduces read overhead to O(1) and eliminates redundant allocations.
**Action:** Always memoize the final serialization result of large collections in read-heavy paths. Ensure robust invalidation in all mutation and load/reset paths.
