// Writes its PID to PID_FILE, ignores SIGTERM, hangs.
// Used to test SIGKILL escalation: runner sends SIGTERM, child ignores it,
// runner must SIGKILL after GENERATOR_SIGTERM_GRACE_MS.
import { writeFileSync } from "node:fs";
process.on("SIGTERM", () => {}); // intentionally ignore
writeFileSync(process.env.PID_FILE, String(process.pid));
setTimeout(() => process.exit(0), 120_000);
