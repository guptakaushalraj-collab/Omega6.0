import '@testing-library/jest-dom/vitest';
// A real IndexedDB implementation in Node, so the offline layer is exercised
// end to end rather than mocked away — the storage semantics (key paths,
// transactions, clear-then-repopulate) are exactly what these tests are for.
import 'fake-indexeddb/auto';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
