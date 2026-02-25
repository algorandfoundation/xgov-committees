import { config } from "./config.ts";
import { notifySystemd, startWatchdog } from "./watchdog.ts";

console.log("xGov committee runner starting...");
console.log(`  algod:      ${config.algodServer}:${config.algodPort}`);
console.log(`  registry:   ${config.registryAppId}`);
console.log("Runner started successfully.");

notifySystemd("READY=1");

const watchdogHandle = startWatchdog();

// Service logic goes here.

clearInterval(watchdogHandle);
notifySystemd("STOPPING=1");
process.exit(0);
