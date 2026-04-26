/**
 * _flock-helper.ts — simple blocking flock holder for test IPC.
 * Usage: bun run _flock-helper.ts <lockpath>
 * Holds the lock for ~200ms then releases.
 */
import { withFlock } from "./posix-flock";

const path = process.argv[2];
if (!path) {
  console.error("Usage: bun run _flock-helper.ts <lockpath>");
  process.exit(1);
}

withFlock(path, () => {
  Bun.sleepSync(200);
});
