/*
 * The one place where the test environment gets the writer lock (plan 1.4): a LockManager that grants every request at
 * once and never excludes, so tests that write to the store behave as they did before the lock existed. The guard in
 * src/lib/writerLock.ts is the real one; tests/writer-lock*.test.ts replace this manager with tests/helpers/fakeTabs.ts.
 */
const permissive = {
  request: (...args: unknown[]) => {
    const callback = args[args.length - 1] as (lock: unknown) => unknown;
    return Promise.resolve(callback({ name: 'ogs-writer', mode: 'exclusive' }));
  },
  // The real code takes the callback's promise as the lock's life; here the callback runs synchronously on request.
};
const nav = (globalThis as { navigator?: object }).navigator ?? Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true }).navigator;
Object.defineProperty(nav, 'locks', { value: permissive, configurable: true });
