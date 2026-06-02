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

## 2026-05-18 - [O(1) JSON Fragment Indexing]
**Learning:** When performing incremental updates to a JSON fragment cache (`Array<string>`), `indexOf(oldFragment)` performs an O(N) string search. Maintaining a secondary Map of `id -> index` allows for O(1) removals and updates, providing a ~40x speedup for status updates in large datasets.
**Action:** Use an index Map to accelerate removals and updates in array-based caches where value-based lookups are O(N).

## 2026-05-20 - [O(1) Queue Updates with Map-based Fragment Caching]
**Learning:** Refactoring an array-based pending cache (using `splice` and manual index maps) to a native JavaScript `Map` provides O(1) removals and appends while preserving insertion order. This eliminates the O(N) cost of re-indexing and string searches, resulting in a ~17x reduction in update latency for large suggestion queues.
**Action:** Use Map-based caches for incremental status/filtered views that require frequent removals and appends. Leverage Map's `delete` and `set` operations to efficiently implement "move to back" (rotation) logic in O(1).

## 2026-05-25 - [Incremental LIFO Cache Updates]
**Learning:** For LIFO-ordered views derived from an insertion-ordered source, incremental updates can be performed in O(1) by mapping the source index to the reversed index using `length - 1 - fIdx`. This avoids O(N) rebuilds on every write, reducing read latency after mutations from O(N) to O(1) (plus a fast string join).
**Action:** Use reverse index mapping to maintain LIFO caches incrementally. Ensure status checks are performant before updating filtered subsets.

## 2026-05-26 - [O(1) Creation via Lazy LIFO Invalidation]
**Learning:** Maintaining LIFO-ordered caches incrementally via `unshift` in the creation path becomes a significant bottleneck (O(N)) as the dataset grows (e.g., ~0.8ms for 100k items). Switching to lazy invalidation (setting cache to null) moves this cost to the first subsequent read, ensuring sub-millisecond latency for writes.
**Action:** Favor lazy invalidation over incremental O(N) maintenance for LIFO views in write-heavy paths. Use pre-allocated arrays (`new Array(len)`) when rebuilding these caches to optimize V8 performance.

## 2026-05-27 - [Pre-Regex Truncation & Redundant Logic Removal]
**Learning:** Performing regex replacements on unsanitized inputs before truncation can lead to unnecessary CPU work for large malicious payloads. Additionally, passing already-sanitized values (like `req.identity.user`) back through sanitization functions in hot paths (like rate limiting) adds redundant overhead.
**Action:** Always truncate strings to their maximum allowed length *before* running regex-based sanitizers. Audit request lifecycle to ensure sanitization happens exactly once per field.

## 2026-05-28 - [Fast-Path Sanitization for Clean Strings]
**Learning:** Performing `String.prototype.replace()` on every input string, even those that are already clean and within length limits, incurs unnecessary overhead due to full-string scanning and new string allocation. Implementing a "fast-path" check with `RegExp.test()` for common clean cases improves throughput by ~30-40% for typical inputs like IPs and simple usernames.
**Action:** In high-frequency utility functions (like sanitizers or validators), implement a non-destructive fast-path check to avoid expensive operations on clean inputs.

## 2026-05-29 - [Consolidated Fast-Paths & Map Operation Reduction]
**Learning:** Consolidating multiple fast-path checks into a single, comprehensive regex test (e.g., covering both C0 and C1 ranges) reduces redundant CPU cycles and prevents logic inconsistencies where one check is more permissive than the final replacement. Additionally, in Map-based rotation logic, ensuring exactly one `delete/set` pair (avoiding an initial `set` if the status didn't change) minimizes operations on the Map's internal structures.
**Action:** Always unify fast-path regexes to match the full replacement range. Audit state transition logic to ensure the minimum necessary Map operations are performed for "move-to-back" behaviors.

## 2025-06-10 - [Pre-allocated Arrays & Standard For Loops for Load Optimization]
**Learning:** Replacing `forEach` with a standard `for` loop and using a pre-allocated array (`new Array(len).fill(null)`) for large collections in `db.js`'s `_load()` path reduces initialization latency by ~20% for 100k items. This avoids dynamic resizing overhead and leverages V8's optimization of monomorphic loops.
**Action:** Favor pre-allocated arrays and standard `for` loops for large-scale data initialization in performance-critical paths.

## 2026-06-01 - [Animation Delay Bypass for Reduced Motion]
**Learning:** Hardcoded animation delays (e.g., matching CSS transition durations) create unnecessary latency for users who have opted out of animations. Detecting `prefers-reduced-motion` in JS allows bypassing these delays, providing a ~300ms speedup per interaction.
**Action:** Always check `prefers-reduced-motion` before awaiting animation timeouts or using `smooth` scroll behavior.

## 2026-06-02 - [Symbol-based Metadata Indexing]
**Learning:** Using a `Symbol` to store internal metadata (like fragment indices) directly on objects is more efficient than maintaining a secondary `Map`. It provides faster (1)$ access (direct property access vs. hash map lookup), reduces memory overhead by eliminating redundant keys, and naturally hides the metadata from `JSON.stringify` and standard object iteration.
**Action:** When tracking metadata for objects in a collection, prefer Symbol-based properties over secondary lookup Maps to minimize overhead and prevent serialization leaks.
