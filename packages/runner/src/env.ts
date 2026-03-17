import dotenv from "dotenv";

// Local dev only - in prod, systemd EnvironmentFile= loads vars before Node starts.
// Path from {src,dist}/env.ts: "../../.." resolves to repo root (same depth in both dirs)
dotenv.config({ quiet: true, override: false, path: new URL("../../../.env", import.meta.url) });
