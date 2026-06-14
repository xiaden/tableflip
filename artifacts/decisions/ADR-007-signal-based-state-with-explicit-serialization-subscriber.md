# ADR-007: Signal-Based State with Explicit Serialization Subscriber

**Status:** Proposed  
**Date:** 2026-06-14  
**Tags:** state, signals, serialization, future-direction  

## Context

The current state management uses a monolithic pub/sub store (see ADR-006). The store solves reactivity and serialization as a single concern — one AppState object that is both the reactive source and the .rcjson payload. This was the right tradeoff for alpha: 116 lines of code, zero drift between what's reactive and what's saveable.

As the application matures, the costs of the monolith increase: broadcast notifications on every change, deep clone on every mutation, no granular reactivity, every component coupled to the full AppState type. Preact signals offer a lighter, more idiomatic path forward — but only if serialization is addressed.

## Decision

1. **Signals replace the monolith store for reactivity.** Each state concern gets its own signal or group of signals. Components subscribe to specific signals via Preact's automatic dependency tracking — no manual subscription management, no broadcast notifications, no deep cloning.

2. **Serialization is a separate concern with a single subscriber.** A dedicated serialization module subscribes to the signals that constitute the saveable report configuration. When those signals change, it gathers their values into the .rcjson payload shape. This is one subscriber, not one per component. The subscriber is the only code that needs to know the full payload shape.

3. **The store is deleted.** Once signals + the serialization subscriber replace the store's reactivity and persistence roles, the custom store implementation (`core/store.ts`) is removed. State that doesn't need persistence (UI-only state like panel open/close, hover states) lives in local component state or signals that the serialization subscriber ignores.

4. **Migration path: signal-by-signal.** Each top-level state key migrates independently. During migration, the store and signals coexist — the serialization subscriber reads from whichever source owns each key. Once all keys have migrated, the store is removed.

## Consequences

**Positive:**
- Granular reactivity: components re-render only when signals they read change
- No deep clone overhead — signals hold values directly, mutations are explicit
- Preact-native: signals are the idiomatic state primitive for Preact, reducing custom infrastructure
- Smaller surface area: delete 116 lines of store code plus the deep clone utility
- Serialization is explicit and auditable: one subscriber, one place that knows the payload shape

**Challenges:**
- **Set preservation:** The current store's deep clone preserves `Set` objects (used for `selCols`, `excludedRows`). Signals don't natively handle Set reactivity — `excludedRows` Set mutations would need either a wrapper signal or manual invalidation
- **Batch updates:** Multiple state changes that should produce one serialization event need explicit batching (Preact's `batch()` or manual debounce)
- **Migration coexistence:** During migration, the serialization subscriber must merge signal values and store values into one payload — two sources of truth temporarily
- **State loading:** `state-applier.ts` currently sets the entire store at once. With signals, loading a .rcjson means setting multiple signals individually — order may matter for derived signals

**What this doesn't change:**
- The `.rcjson` format and `buildPayload()` shape remain the same
- The `AppState` type may simplify but doesn't need to be redesigned
- State-applier logic is adapted, not rewritten from scratch
