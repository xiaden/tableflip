# ADR-006: Monolithic State Store — Single Source of Truth for Reactivity and Serialization

**Status:** Proposed  
**Date:** 2026-06-14  
**Tags:** state, serialization, store, architecture  

## Context

TableFlip needs two things from its state: reactivity (the UI must update when state changes) and serialization (the entire report configuration must save to .rcjson and reload). These are usually solved as separate concerns — a reactive library (signals, Redux, Zustand) plus a persistence layer that translates between the reactive model and a serializable format.

The codebase takes a different approach: there is one AppState object. It is both the reactive store and the serialization payload.

## Decision

1. **The AppState object is the single source of truth for all application state.** There is no separation between "reactive state" and "serializable state." The store's `getState()` returns the same shape that `buildPayload()` serializes to `.rcjson`.

2. **All state mutations go through the store.** Direct mutation of state outside `store.update()` or `store.set()` is prohibited. This ensures that every state change triggers subscriber notifications and that the store always reflects the current application state.

3. **The store is a pub/sub monolith.** When any part of state changes, all subscribers are notified with `(newState, prevState)`. There is no granular subscription, no dependency tracking, no computed values. Components subscribe and decide what to re-render by comparing prev/next state.

4. **Immer-style draft pattern for mutations.** `store.update(draft => { draft.filters.push(...) })` provides mutable-style syntax while producing immutable state transitions via deep clone. This preserves Set objects (which JSON.stringify cannot).

## Consequences

**Positive:**
- Zero drift between reactive state and saved state — `buildPayload()` reads directly from the store, no translation layer needed
- Serialization is trivial: one function, one object shape, one responsibility
- 116 lines of store code vs. a signals library + serialization adapter + synchronization logic
- The `.rcjson` format IS the state schema — no separate persistence model to maintain
- State loading (`state-applier.ts`) is a single `store.set()` call that replaces the entire state

**Negative / accepted costs:**
- Broadcast notifications: every state change notifies every subscriber. Components must implement their own change detection (prev/next comparison) to avoid unnecessary re-renders
- Deep clone on every `update()` is brute-force immutability — O(state size) per mutation
- No computed/derived values — every value must be stored explicitly in state or computed at render time
- Single state object couples all parts of the application to the same type (`AppState`)

**Why not separate concerns:**
The alternative — signals for reactivity + a separate serialization layer — would require:
- A mechanism to gather all signal values into a serializable object
- Synchronization logic ensuring the gathered object matches the reactive state
- Two representations of the same data to maintain and debug

At the current scale (alpha, spreadsheet-sized data, modest component tree), the monolith store is the simpler system. The tradeoff would flip if component count or state size grew significantly.
