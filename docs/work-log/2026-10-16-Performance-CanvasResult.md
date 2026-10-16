# Canvas performance result

- W1: Select group placement before scene construction. A valid group draft builds and routes one scene, while malformed JSON/shape retains the single-node recovery preview. Final pointer persistence remains unchanged.
- W2: Build columns, keys, and visible FK indexes once per content snapshot. Measure each table once and share results between card bounds, relation ports, and rendered rows. Memoization depends on tables, columns, keys, relations, enums and display mode; layout-only previews reuse measurements while every scene still reroutes all edges against the current obstacles.
- The standalone scene/metrics APIs remain fresh by default, including in-place mutated fixture inputs. Scene-to-metrics links use a WeakMap to preserve serializable scene data and allow disposal. No global document cache is retained.
- PNG keeps the same measurement function and typography. Tests compare indexed and standalone measurements, layout-preview geometry, keys/scope/modes, enum/type/comment/display changes, group scene count, malformed recovery, PNG output, interactions, marquee and lifecycle.
- Validation: model and contracts builds passed; web typecheck passed. Seven targeted canvas test files passed (111 tests).
- Browser FPS or latency improvement has not been measured in this unit. Deterministic work-count checks show one group routing pass and no per-table scans of full columns/relations during indexed scene construction.
