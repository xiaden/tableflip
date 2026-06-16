import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, initStore, getStore } from '../../core/store';

describe('Store', () => {
  describe('createStore()', () => {
    it('should create a store with default state', () => {
      const store = createStore();
      const state = store.getState();
      expect(state).toBeTruthy();
      expect(state.base).toBe('');
      expect(state.aggMode).toBe('none');
      expect(state.tables).toEqual({});
      expect(state.lookups).toEqual([]);
      expect(state.filters).toEqual([]);
      expect(state.sorts).toEqual([]);
      expect(state.detailBands).toEqual([]);
    });

    it('should apply partial initial state', () => {
      const store = createStore({ base: 'Orders', aggMode: 'group' });
      const state = store.getState();
      expect(state.base).toBe('Orders');
      expect(state.aggMode).toBe('group');
      // other defaults still present
      expect(state.lookups).toEqual([]);
      expect(state.tables).toEqual({});
    });
  });

  describe('getState()', () => {
    it('should return the current state snapshot', () => {
      const store = createStore({ base: 'TestTable' });
      const state = store.getState();
      expect(state.base).toBe('TestTable');
    });

    it('should reflect mutations after update()', () => {
      const store = createStore();
      store.update(draft => { draft.base = 'NewTable'; });
      expect(store.getState().base).toBe('NewTable');
    });
  });

  describe('subscribe()', () => {
    it('should call listener on update()', () => {
      const store = createStore();
      let called = 0;
      store.subscribe(() => { called++; });
      store.update(draft => { draft.base = 'X'; });
      expect(called).toBe(1);
    });

    it('should call listener on set()', () => {
      const store = createStore();
      let called = 0;
      store.subscribe(() => { called++; });
      store.set('base', 'Y');
      expect(called).toBe(1);
    });

    it('should pass new and previous state to listener', () => {
      const store = createStore({ base: 'old' });
      let receivedNew: string | undefined;
      let receivedPrev: string | undefined;
      store.subscribe((newState, prevState) => {
        receivedNew = newState.base;
        receivedPrev = prevState.base;
      });
      store.set('base', 'new');
      expect(receivedNew).toBe('new');
      expect(receivedPrev).toBe('old');
    });

    it('should support multiple listeners', () => {
      const store = createStore();
      let a = 0, b = 0;
      store.subscribe(() => { a++; });
      store.subscribe(() => { b++; });
      store.update(draft => { draft.base = 'X'; });
      expect(a).toBe(1);
      expect(b).toBe(1);
    });

    it('should unsubscribe when returned function is called', () => {
      const store = createStore();
      let called = 0;
      const unsub = store.subscribe(() => { called++; });
      store.update(draft => { draft.base = 'A'; });
      expect(called).toBe(1);
      unsub();
      store.update(draft => { draft.base = 'B'; });
      expect(called).toBe(1); // not called again
    });
  });

  describe('update()', () => {
    it('should apply draft mutation', () => {
      const store = createStore();
      store.update(draft => {
        draft.base = 'Mutated';
        draft.aggMode = 'totals';
      });
      expect(store.getState().base).toBe('Mutated');
      expect(store.getState().aggMode).toBe('totals');
    });

    it('should deep-clone state (mutations to draft do not affect previous state)', () => {
      const store = createStore({ base: 'original' });
      let prevState: any;
      store.subscribe((_new, prev) => { prevState = prev; });
      store.update(draft => {
        draft.base = 'changed';
      });
      expect(prevState.base).toBe('original');
      expect(store.getState().base).toBe('changed');
    });

    it('should notify listeners', () => {
      const store = createStore();
      const calls: string[] = [];
      store.subscribe((state) => { calls.push(state.base); });
      store.update(draft => { draft.base = 'A'; });
      store.update(draft => { draft.base = 'B'; });
      expect(calls).toEqual(['A', 'B']);
    });
  });

  describe('set()', () => {
    it('should set a single top-level key', () => {
      const store = createStore();
      store.set('base', 'Orders');
      expect(store.getState().base).toBe('Orders');
    });

    it('should set arrays', () => {
      const store = createStore();
      store.set('stacks', ['Table1', 'Table2']);
      expect(store.getState().stacks).toEqual(['Table1', 'Table2']);
    });

    it('should notify listeners', () => {
      const store = createStore();
      let called = false;
      store.subscribe(() => { called = true; });
      store.set('base', 'X');
      expect(called).toBe(true);
    });
  });

  describe('initStore() / getStore() singleton', () => {
    beforeEach(() => {
      // Reset singleton by re-initializing
      initStore();
    });

    it('initStore should return a store', () => {
      const store = initStore();
      expect(store).toBeTruthy();
      expect(typeof store.getState).toBe('function');
    });

    it('getStore should return the same instance after initStore', () => {
      const s1 = initStore({ base: 'First' });
      const s2 = getStore();
      expect(s1).toBe(s2);
      expect(s2.getState().base).toBe('First');
    });

    it('getStore without initStore should create a default store', () => {
      const store = getStore();
      expect(store).toBeTruthy();
      expect(store.getState().base).toBe('');
    });

    it('initStore should replace existing store', () => {
      initStore({ base: 'Old' });
      initStore({ base: 'New' });
      expect(getStore().getState().base).toBe('New');
    });
  });
});
