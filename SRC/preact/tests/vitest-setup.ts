import { beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initStore } from '../core/store';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let sqlDb: SqlJsDatabase;

beforeAll(async () => {
  // 1. Initialize SQLite WASM (local binary for test reliability)
  const wasmPath = path.join(__dirname, '../../js/wasm/sql-wasm.wasm');
  const wasmBinary = fs.readFileSync(wasmPath);
  const initSqlJsModule = await import(path.join(__dirname, '../../js/wasm/sql-wasm.js'));
  const initSqlJsFn = initSqlJsModule.default || initSqlJsModule;
  const SQL = await initSqlJsFn({ wasmBinary });
  sqlDb = new SQL.Database();

  // 2. Set globals required by sqldb.ts and UI layer modules
  (globalThis as any).sqlDb = sqlDb;
  (window as any).sqlDb = sqlDb;

  // 3. Initialize the store with default state
  initStore();

  // 4. Create Orders table (used by sqldb tests)
  sqlDb.run(`CREATE TABLE Orders (
    "OrderId" TEXT, "Company" TEXT, "Contact" TEXT, "Status" TEXT,
    "Amount" REAL, "OrderDate" TEXT, "Region" TEXT
  )`);

  const ordersData = [
    ['ORD-001', 'Acme Corp', 'Alice', 'Open', 150.00, '2025-01-15', 'North'],
    ['ORD-002', 'Beta Inc', 'Bob', 'Shipped', 275.00, '2025-02-01', 'South'],
    ['ORD-003', 'Acme Corp', 'Alice', 'Open', 99.50, '2025-03-10', 'North'],
    ['ORD-004', 'Gamma LLC', 'Carol', 'Closed', 500.00, '2024-11-20', 'East'],
    ['ORD-005', 'Delta Co', 'Dave', 'Open', 0.00, '2025-01-01', 'West'],
    ['ORD-006', 'Beta Inc', 'Bob', 'Shipped', null, '2025-04-05', 'South'],
    ['ORD-007', 'Echo Ltd', 'Eve', 'Open', 820.00, '2025-05-12', 'East'],
    ['ORD-008', 'Acme Corp', 'Alice', 'Pending', 310.00, '2025-06-01', 'North'],
  ];
  const stmt = sqlDb.prepare(
    `INSERT INTO Orders ("OrderId","Company","Contact","Status","Amount","OrderDate","Region") VALUES (?,?,?,?,?,?,?)`
  );
  for (const row of ordersData) {
    stmt.run(row);
  }
  stmt.free();
});

afterAll(() => {
  if (sqlDb) sqlDb.close();
});
