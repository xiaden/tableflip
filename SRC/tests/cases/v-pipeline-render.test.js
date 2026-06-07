
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { db } from '../../js/core/state.js';
import { renderPipeline } from '../../js/query/pipeline-card.js';

describe('V. Pipeline card rendering with lookups', () => {
  it('renderPipeline does not throw when pipeline has a lookup', () => {
    db.base = 'Orders';
    db.lookups = [{
      rightId: 'Contacts',
      keyPairs: [{ left: 'Company', right: 'Company' }],
      cols: ['Email'],
      required: false,
      enabled: true,
      duplicatePolicy: { mode: 'combine', combine: { separator: '; ', unique: true } },
    }];

    assert.doesNotThrow(() => {
      renderPipeline(Object.keys(db.tables));
    }, 'renderPipeline should not throw with a lookup configured');
  });
});
