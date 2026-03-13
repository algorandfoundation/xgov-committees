// Default fake generator: sleeps 10s then exits 0.
// The delay lets the chain advance so the runner's re-loop sees a fresh round.
setTimeout(() => process.exit(0), 10_000);
