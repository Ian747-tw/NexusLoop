import { acquire, release } from "./pidfile";

const path = process.argv[2];
if (!path) {
  process.stderr.write("lock path missing\n");
  process.exit(1);
}

const handle = acquire(path);
if (!handle) {
  process.stdout.write("acquire_failed\n");
  process.exit(0);
}

process.stdout.write("acquire_succeeded\n");
release(handle);
