import { db } from '../js/core/state.js';
import { quoteId } from '../js/core/sqldb.js';

// ── Fixture data for Orders and Contacts tables ─────────────────────────────
// These match the table structure described in the test plan.
// Cols arrays are the physical column names in SQLite.

const ORDERS_COLS = ['OrderId', 'Company', 'Contact', 'Status', 'Amount', 'OrderDate', 'Region'];

const ORDERS_ROWS = [
  { OrderId: 'ORD-001', Company: 'Acme Corp',    Contact: 'Alice',  Status: 'Open',     Amount: 150.00, OrderDate: '2025-01-15', Region: 'North' },
  { OrderId: 'ORD-002', Company: 'Beta Inc',     Contact: 'Bob',    Status: 'Shipped',  Amount: 275.00, OrderDate: '2025-02-01', Region: 'South' },
  { OrderId: 'ORD-003', Company: 'Acme Corp',    Contact: 'Alice',  Status: 'Open',     Amount: 99.50,  OrderDate: '2025-03-10', Region: 'North' },
  { OrderId: 'ORD-004', Company: 'Gamma LLC',    Contact: 'Carol',  Status: 'Closed',   Amount: 500.00, OrderDate: '2024-11-20', Region: 'East'  },
  { OrderId: 'ORD-005', Company: 'Delta Co',     Contact: 'Dave',   Status: 'Open',     Amount: 0.00,   OrderDate: '2025-01-01', Region: 'West'  },
  { OrderId: 'ORD-006', Company: 'Beta Inc',     Contact: 'Bob',    Status: 'Shipped',  Amount: null,   OrderDate: '2025-04-05', Region: 'South' },
  { OrderId: 'ORD-007', Company: 'Echo Ltd',     Contact: 'Eve',    Status: 'Open',     Amount: 820.00, OrderDate: '2025-05-12', Region: 'East'  },
  { OrderId: 'ORD-008', Company: 'Acme Corp',    Contact: 'Alice',  Status: 'Pending',  Amount: 310.00, OrderDate: '2025-06-01', Region: 'North' },
];

const CONTACTS_COLS = ['Company', 'Contact', 'Email', 'Phone'];

const CONTACTS_ROWS = [
  // Acme — 2 contacts, Alice has 2 emails (duplicate rows + multi-value)
  { Company: 'Acme Corp', Contact: 'Alice', Email: 'alice@acme.com',     Phone: '111-1000' },
  { Company: 'Acme Corp', Contact: 'Alice', Email: 'alice@acme.com',     Phone: '111-1000' },  // exact duplicate
  { Company: 'Acme Corp', Contact: 'Alice', Email: 'alice_alt@acme.com', Phone: '111-1000' },  // same contact, alt email
  { Company: 'Acme Corp', Contact: 'Bob',   Email: 'bob@acme.com',       Phone: '111-2000' },
  // Beta — single contact
  { Company: 'Beta Inc',  Contact: 'Bob',   Email: 'bob@beta.com',       Phone: '222-1000' },
  // Gamma — duplicate Company key (Carol + Dave)
  { Company: 'Gamma LLC', Contact: 'Carol', Email: 'carol@gamma.com',    Phone: '333-1000' },
  { Company: 'Gamma LLC', Contact: 'Dave',  Email: 'dave@gamma.com',     Phone: '333-2000' },
  // Delta — no match (Orders has Delta Co, Contacts has Delta Ltd)
  { Company: 'Delta Ltd', Contact: 'Dave',  Email: 'dave@delta.com',     Phone: '444-1000' },
  // Echo — blank contact value
  { Company: 'Echo Ltd',  Contact: '',       Email: 'echo@echo.com',     Phone: '555-1000' },
];

// ── Fixture creation helpers ────────────────────────────────────────────────

function makeOrdersTable(sqlDb) {
  sqlDb.run(`CREATE TABLE Orders (${ORDERS_COLS.map(c => quoteId(c)).join(', ')})`);
  const ph = ORDERS_COLS.map(() => '?').join(', ');
  const stmt = sqlDb.prepare(`INSERT INTO Orders VALUES (${ph})`);
  for (const row of ORDERS_ROWS) {
    stmt.run(ORDERS_COLS.map(c => {
      const v = row[c];
      return v === undefined ? null : v;
    }));
  }
  stmt.free();
}

function makeContactsTable(sqlDb) {
  sqlDb.run(`CREATE TABLE Contacts (${CONTACTS_COLS.map(c => quoteId(c)).join(', ')})`);
  const ph = CONTACTS_COLS.map(() => '?').join(', ');
  const stmt = sqlDb.prepare(`INSERT INTO Contacts VALUES (${ph})`);
  for (const row of CONTACTS_ROWS) {
    stmt.run(CONTACTS_COLS.map(c => {
      const v = row[c];
      return v === undefined ? null : v;
    }));
  }
  stmt.free();
}

// Register tables so db.tables mirrors SQLite
function registerTable(tid, name, cols) {
  db.tables[tid] = { id: tid, name, cols: [...cols] };
  db.tableColors[tid] = '#4A90D9';
}

function registerOrdersTable() {
  registerTable('Orders', 'Orders', ORDERS_COLS);
}

function registerContactsTable() {
  registerTable('Contacts', 'Contacts', CONTACTS_COLS);
}

export function setupTwoTableFixture() {
  makeOrdersTable(sqlDb);
  makeContactsTable(sqlDb);
  registerOrdersTable();
  registerContactsTable();
  db.base = 'Orders';
}

export {
  ORDERS_COLS,
  ORDERS_ROWS,
  CONTACTS_COLS,
  CONTACTS_ROWS,
  makeOrdersTable,
  makeContactsTable,
  registerTable,
  registerOrdersTable,
  registerContactsTable,
};
