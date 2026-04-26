declare module 'proper-lockfile' {
  export interface LockOptions {
    retries?: {
      retries?: number;
      factor?: number;
      minTimeout?: number;
      maxTimeout?: number;
    };
  }
  // lock() returns a Promise<release> where release is () => Promise<void>
  export function lock(path: string, options?: LockOptions): Promise<() => Promise<void>>;
}