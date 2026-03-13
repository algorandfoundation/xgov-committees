// Writes its PID to PID_FILE then hangs for 60s.
// Used to test SIGTERM graceful shutdown: the test sends SIGTERM while this is running
// and verifies the runner exits cleanly without orphaning this process.
import { writeFileSync } from "node:fs";

if (process.env.PID_FILE) writeFileSync(process.env.PID_FILE, String(process.pid));
setTimeout(() => process.exit(0), 60_000);
