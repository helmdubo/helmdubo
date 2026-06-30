# SQLite WASM + OPFS spike — findings

Status: validated in a real Chromium browser (Playwright-driven Chromium 141,
headless), against `npm run dev` (Vite 6) with the project's COOP/COEP
headers from `vite.config.ts`.

## Chosen architecture: SQLite must run in a dedicated Worker

`createSyncAccessHandle()` (the API the OPFS-backed VFS depends on for
synchronous file I/O) is **only exposed on `FileSystemFileHandle.prototype`
inside a dedicated Worker**, not on the main/window thread. This was
confirmed empirically in this spike, not assumed:

```js
// main thread
'createSyncAccessHandle' in FileSystemFileHandle.prototype // → false

// inside a dedicated Worker
'createSyncAccessHandle' in FileSystemFileHandle.prototype // → true
```

This matches `@sqlite.org/sqlite-wasm`'s own README ("Only the worker
versions allow you to use the origin private file system (OPFS) storage
back-end") — an earlier attempt at running `sqlite3.installOpfsSAHPoolVfs()`
directly on the main thread failed with `Missing required OPFS APIs.` for
exactly this reason. **Any future StorageAdapter implementation must run
SQLite inside a Worker and talk to it over `postMessage`.**

## VFS path chosen: OPFS SAH Pool VFS, run inside a Worker

Two OPFS-backed VFS options exist in `@sqlite.org/sqlite-wasm`:

1. **OPFS VFS** (`sqlite3.oo1.OpfsDb`) — async/sync split across a proxy
   Worker, coordinated via `SharedArrayBuffer` + `Atomics.wait()`. Requires
   `crossOriginIsolated` (COOP/COEP headers) and cannot run on the main
   thread at all (`"The OPFS sqlite3_vfs cannot run in the main thread"`).
2. **OPFS SAH Pool VFS** (`sqlite3.installOpfsSAHPoolVfs()` →
   `poolUtil.OpfsSAHPoolDb`) — pre-opens a pool of `SyncAccessHandle`s up
   front, then does fully synchronous I/O against that pool. No
   `Atomics.wait()`, no `SharedArrayBuffer` requirement.

This spike uses **option 2 (SAH Pool VFS)**, run from inside
`spike/sqlite-worker.ts` (a dedicated Worker), with the main thread talking
to it via a small hand-rolled `postMessage` RPC (`spike/sqlite-opfs.ts`).
Rationale:

- It is simpler to reason about (no `Atomics`/`SharedArrayBuffer`
  coordination to get wrong).
- It still benefits from running in a Worker, which keeps SQLite I/O off
  the UI thread regardless of VFS choice.
- The project already sets COOP/COEP headers (§3.1/T0.2), so option 1
  remains available later if a reason to switch arises (e.g. multi-tab
  contention behavior), but is not required for SAH Pool VFS to work.

## Dev/prod headers

`vite.config.ts` sets, for both `server.headers` and `preview.headers`:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Confirmed present on both `npm run dev` and `npm run preview` responses via
`curl -I`. `self.crossOriginIsolated` reads `true` in the browser as a
result. Not strictly required for the SAH Pool VFS, but kept because (a) it
costs nothing, (b) it's needed if a future milestone switches to the
proxied OPFS VFS, and (c) cross-origin isolation is good practice for an app
that will eventually load WASM-heavy work (graph layout engines, etc., per
brief §15).

## Required Vite config: `optimizeDeps.exclude`

Without `optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] }`, Vite's dev
dependency pre-bundling serves the package's `sqlite3.wasm` asset with the
wrong MIME type, and `WebAssembly.instantiate()` fails with
`CompileError: ... expected magic word 00 61 73 6d, found 3c 21 64 6f`
(i.e. it received an HTML 404 page instead of the wasm binary). This is the
fix documented in the package's own README under "Usage with vite" and is
applied in `vite.config.ts`.

## What was actually verified (write → reload → read)

Driven via Playwright against a real `npm run dev` server:

1. Loaded `/spike/`, worker initialized, diagnostics rendered:
   `isCrossOriginIsolated: true`, `opfsAvailable: true`,
   `persistenceMode: "opfs"`, `foreignKeysEnabled: true`,
   `sqliteVersion: "3.53.0"`.
2. Clicked "Write note" → row inserted, visible immediately.
3. Reloaded the page (full navigation, new worker instance) → the
   previously written row was still present, read back from OPFS. Confirms
   persistence survives a reload, not just an in-memory session.
4. Ran the invariant checks button, all three passed:
   - `[PASS] transaction rollback — count before=1, after=1`
   - `[PASS] PRAGMA foreign_keys=ON — foreign_keys=1`
   - `[PASS] ON DELETE CASCADE — remaining children=0`

## Known limitations / things future work must account for

- **One VFS instance per directory name.** `installOpfsSAHPoolVfs({ name })`
  claims an OPFS directory; only one VFS instance may use a given directory
  concurrently. The real app (T0.4) should pick one fixed name/directory and
  not let multiple tabs/instances fight over it without locking
  considerations.
- **Multi-tab access is not addressed by this spike.** SAH Pool VFS opens a
  fixed-size pool of sync access handles at startup; concurrent access from
  two tabs to the same OPFS directory is a known sharp edge for OPFS-backed
  SQLite in general and needs an explicit decision later (e.g. BroadcastChannel
  lock, single-tab-owns-write convention) — out of scope for M0.
  Multi-device sync is explicitly out of scope per brief §13 regardless.
- **Worker boundary means all storage access is inherently async.** This is
  actually a good fit for the `StorageAdapter` contract in brief §7, which
  is already async-only (`exec(): Promise<void>`, `query(): Promise<T[]>`,
  `transaction<T>(fn): Promise<T>`) — no redesign needed for T0.4.
  `BEGIN`/`COMMIT`/`ROLLBACK` were driven over the same RPC channel here and
  worked correctly because the worker processes one message at a time in
  the order received and the client only sends the next call after the
  previous one's promise resolves.
- **`@sqlite.org/sqlite-wasm` requires `optimizeDeps.exclude`** in Vite, as
  above — this must be carried forward into the real app's `vite.config.ts`
  (it already is, since T0.2 and this spike share the same config).
- Spike code (`spike/sqlite-worker.ts`, `spike/sqlite-opfs.ts`,
  `spike/main.ts`) is throwaway per the brief; T0.4's `SqliteWasmOpfsAdapter`
  should follow the same Worker + SAH-Pool-VFS shape but is implemented
  fresh against the `StorageAdapter` interface rather than reusing this
  code directly.
- **A held-open sync access handle across a same-tab reload is a real risk,
  not just a multi-tab one.** Found while building T0.9's debug harness: if
  the page navigates/reloads while a worker's `OpfsSAHPoolDb` is still open,
  the *next* worker can momentarily fail to reacquire the same handles
  (`NoModificationAllowedError`), and the SAH Pool VFS's recovery path can
  make the database look empty until that contention clears. Any code that
  keeps an adapter open for the page's lifetime (T0.9's `seed.ts`, and later
  the real app shell) should call `adapter.close()` on `pagehide` as cheap
  insurance. This narrows the window but isn't a hard guarantee — the
  `close()` RPC round-trip can still lose the race against an abrupt
  reload. In repeated real-browser testing this was reliable in practice for
  normal navigation; treat it as a mitigation, not a proof, and revisit if
  M1+ sees real data loss reports.
