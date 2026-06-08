export const ORDERS_COLS = ['OrderId', 'Company', 'Contact', 'Status', 'Amount', 'OrderDate', 'Region'];

export const ORDERS_ROWS = [
  { OrderId: 'ORD-001', Company: 'Acme Corp', Contact: 'Alice', Status: 'Open', Amount: 150.00, OrderDate: '2025-01-15', Region: 'North' },
  { OrderId: 'ORD-002', Company: 'Beta Inc', Contact: 'Bob', Status: 'Shipped', Amount: 275.00, OrderDate: '2025-02-01', Region: 'South' },
  { OrderId: 'ORD-003', Company: 'Acme Corp', Contact: 'Alice', Status: 'Open', Amount: 99.50, OrderDate: '2025-03-10', Region: 'North' },
  { OrderId: 'ORD-004', Company: 'Gamma LLC', Contact: 'Carol', Status: 'Closed', Amount: 500.00, OrderDate: '2024-11-20', Region: 'East' },
  { OrderId: 'ORD-005', Company: 'Delta Co', Contact: 'Dave', Status: 'Open', Amount: 0.00, OrderDate: '2025-01-01', Region: 'West' },
  { OrderId: 'ORD-006', Company: 'Beta Inc', Contact: 'Bob', Status: 'Shipped', Amount: null, OrderDate: '2025-04-05', Region: 'South' },
  { OrderId: 'ORD-007', Company: 'Echo Ltd', Contact: 'Eve', Status: 'Open', Amount: 820.00, OrderDate: '2025-05-12', Region: 'East' },
  { OrderId: 'ORD-008', Company: 'Acme Corp', Contact: 'Alice', Status: 'Pending', Amount: 310.00, OrderDate: '2025-06-01', Region: 'North' },
];

export const CONTACTS_COLS = ['Company', 'Contact', 'Email', 'Phone'];

export const CONTACTS_ROWS = [
  { Company: 'Acme Corp', Contact: 'Alice', Email: 'alice@acme.com', Phone: '111-1000' },
  { Company: 'Acme Corp', Contact: 'Alice', Email: 'alice_alt@acme.com', Phone: '111-1000' },
  { Company: 'Acme Corp', Contact: 'Bob', Email: 'bob@acme.com', Phone: '111-2000' },
  { Company: 'Beta Inc', Contact: 'Bob', Email: 'bob@beta.com', Phone: '222-1000' },
  { Company: 'Gamma LLC', Contact: 'Carol', Email: 'carol@gamma.com', Phone: '333-1000' },
  { Company: 'Gamma LLC', Contact: 'Dave', Email: 'dave@gamma.com', Phone: '333-2000' },
  { Company: 'Delta Ltd', Contact: 'Dave', Email: 'dave@delta.com', Phone: '444-1000' },
  { Company: 'Echo Ltd', Contact: '', Email: 'echo@echo.com', Phone: '555-1000' },
];

export function makeOrdersTable(database: any): void {
  database.run(`CREATE TABLE Orders ("_rowno" INTEGER PRIMARY KEY, ${ORDERS_COLS.map(c => `"${c}"`).join(', ')})`);
  const ph = ORDERS_COLS.map(() => '?').join(', ');
  const stmt = database.prepare(`INSERT INTO Orders ("_rowno", ${ORDERS_COLS.map(c => `"${c}"`).join(', ')}) VALUES (?, ${ph})`);
  for (let i = 0; i < ORDERS_ROWS.length; i++) {
    const row = ORDERS_ROWS[i];
    stmt.run([i, ...ORDERS_COLS.map(c => row[c as keyof typeof row] ?? null)]);
  }
  stmt.free();
}

export function makeContactsTable(database: any): void {
  database.run(`CREATE TABLE Contacts ("_rowno" INTEGER PRIMARY KEY, ${CONTACTS_COLS.map(c => `"${c}"`).join(', ')})`);
  const ph = CONTACTS_COLS.map(() => '?').join(', ');
  const stmt = database.prepare(`INSERT INTO Contacts ("_rowno", ${CONTACTS_COLS.map(c => `"${c}"`).join(', ')}) VALUES (?, ${ph})`);
  for (let i = 0; i < CONTACTS_ROWS.length; i++) {
    const row = CONTACTS_ROWS[i];
    stmt.run([i, ...CONTACTS_COLS.map(c => row[c as keyof typeof row] ?? null)]);
  }
  stmt.free();
}

export function registerTable(db: any, tid: string, name: string, cols: string[]): void {
  db.tables[tid] = { id: tid, name, cols: [...cols], rowCount: 0 };
  db.tableColors[tid] = '#4A90D9';
}

export function registerOrdersTable(db: any): void {
  registerTable(db, 'Orders', 'Orders', ORDERS_COLS);
}

export function registerContactsTable(db: any): void {
  registerTable(db, 'Contacts', 'Contacts', CONTACTS_COLS);
}

export function setupTwoTableFixture(db: any, sqlDb: any): void {
  makeOrdersTable(sqlDb);
  makeContactsTable(sqlDb);
  registerOrdersTable(db);
  registerContactsTable(db);
  db.base = 'Orders';
}
