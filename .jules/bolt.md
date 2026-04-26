## 2025-05-15 - [Database and Retrieval Optimization]
**Learning:** The initial implementation used string-based `localeCompare` sorting for every retrieval, which is $O(n \log n)$ and expensive. Since suggestions are appended chronologically, they are already sorted by `created_at`. Using `Array.reverse()` provides the latest-first view in $O(n)$ time, and filtering pending items without re-sorting is safe. Additionally, ID-based lookups were $O(n)$ due to `Array.find()`, which was a bottleneck for updates.

**Action:** Leverage insertion order for chronological views; use a `Map` to maintain an O(1) index for ID-based lookups. Avoid pretty-printing JSON in production persistence to minimize I/O.
