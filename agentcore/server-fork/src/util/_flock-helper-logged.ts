/**
 * _flock-helper-logged.ts — blocking flock holder with console.log markers for test IPC.
 * Usage: bun run _flock-helper-logged.ts <lockpath> <name>
 */
import { withFlock } from "./posix-flock";

const path = process.argv[2];
const name = process.argv[3] || "HOLDER";

if (!path) {
  console.error("Usage: bun run _flock-helper-logged.ts <lockpath> <name>");
  process.exit(1);
}

withFlock(path, () => {
  console.log(`${name}_START`);
  Bun.sleepSync(50);
  console.log(`${name}_END`);
});
