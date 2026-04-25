## 2025-05-15 - [O(1) ID Lookups & Optimized Sorting]
**Learning:** For simple file-based JSON DBs, maintain an in-memory `Map` index to avoid O(n) array searches on every update/read. Leveraging insertion order for sorting (`.reverse()` vs `.sort()`) can provide ~10-20x speedup on retrieval for large datasets.
**Action:** Always check if a collection is already sorted by a key before applying a manual sort. Implement Map indexes for frequently accessed IDs.
