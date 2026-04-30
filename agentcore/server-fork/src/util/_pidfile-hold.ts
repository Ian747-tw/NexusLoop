import { acquire, release } from "./pidfile";

const path = process.argv[2];
const holdMs = Number(process.argv[3] ?? "1000");

if (!path) {
  process.stderr.write("lock path missing\n");
  process.exit(1);
}

const handle = acquire(path);
if (!handle) {
  process.stderr.write("failed to acquire\n");
  process.exit(1);
}

process.stdout.write("holding\n");
setTimeout(() => {
  release(handle);
  process.exit(0);
}, holdMs);
