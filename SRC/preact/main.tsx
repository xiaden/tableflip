/**
 * React application entry point — initializes database, store, and renders the App.
 *
 * Replaces the old Preact entry point (preact/app.ts). Bootstraps the application by:
 * 1. Initializing the SQLite WASM runtime
 * 2. Creating the reactive state store
 * 3. Mounting the React App component via createRoot inside a MUI ThemeProvider
 *
 * The MUI theme (theme.ts) provides a dark palette matching the app's CSS custom
 * properties and compact component sizing. CssBaseline applies a consistent baseline.
 */

import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { initDb } from './core/sqldb';
import { initStore } from './core/store';
import { App } from './ui/app';
import theme from './ui/theme';

/**
 * Bootstrap the application.
 * Initializes the database and store, then mounts the React App.
 */
async function main(): Promise<void> {
  // 1. Initialize SQLite WASM runtime
  await initDb();

  // 2. Initialize the reactive state store
  initStore();

  // 3. Mount the root App component inside MUI ThemeProvider with CssBaseline
  const container = document.getElementById('app');
  if (!container) {
    throw new Error('Root element #app not found in document');
  }
  const root = createRoot(container);
  root.render(
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>,
  );

  // 4. Remove loading overlay if present
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) {
    overlay.style.display = 'none';
  }
}

main().catch((err: unknown) => {
  console.error('[main] Failed to initialize:', err);
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) {
    overlay.innerHTML = `
      <div style="font-size:2rem">\u26A0\uFE0F</div>
      <div style="font-size:1rem;font-weight:600">Failed to load</div>
      <div style="font-size:0.8rem;color:var(--muted)">${String((err as Error).message || err)}</div>
    `;
  }
});
