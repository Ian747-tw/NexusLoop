declare module 'proper-lockfile' {
  export interface LockOptions {
    retries?: {
      retries?: number;
      factor?: number;
      minTimeout?: number;
      maxTimeout?: number;
    };
    /** Age in ms after which a lock is considered stale (default 10000). */
    stale?: number;
    /** Update lock file mtime when opening (helps avoid stale detection races). */
    updateAgeWhenOpening?: boolean;
  }
  // lock() returns a Promise<release> where release is () => Promise<void>
  export function lock(path: string, options?: LockOptions): Promise<() => Promise<void>>;
}