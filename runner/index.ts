import { config } from "./config.ts";

console.log("xGov committee runner starting...");
console.log(`  algod:      ${config.algodServer}:${config.algodPort}`);
console.log(`  registry:   ${config.registryAppId}`);
console.log("Runner started successfully.");

process.exit(0);
