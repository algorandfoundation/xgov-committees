import "dotenv/config";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { config } from "./config.ts";
import { isFailure, postFailureNotification } from "./slack.ts";

const argv = await yargs(hideBin(process.argv))
  .option("exit-status", { type: "string", demandOption: true })
  .option("service-result", { type: "string", demandOption: true })
  .option("hostname", { type: "string", demandOption: true })
  .strict()
  .parse();

if (!isFailure(argv.serviceResult)) process.exit(0);

try {
  await postFailureNotification({
    exitStatus: argv.exitStatus,
    serviceResult: argv.serviceResult,
    hostname: argv.hostname,
    unitName: "runner.service",
    slackBotToken: config.slackBotToken,
    slackChannelId: config.slackChannelId,
  });
  console.log("notify-slack: notification posted");
} catch (error) {
  console.error("notify-slack failed:", error);
  process.exit(1);
}
