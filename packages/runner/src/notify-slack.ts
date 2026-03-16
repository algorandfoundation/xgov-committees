import "dotenv/config";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { isFailure, postFailureNotification } from "./slack.ts";

const argv = await yargs(hideBin(process.argv))
  .option("exit-status", { type: "string", demandOption: true })
  .option("service-result", { type: "string", demandOption: true })
  .option("hostname", { type: "string", demandOption: true })
  .strict()
  .parse();

if (!isFailure(argv.serviceResult)) process.exit(0);

const slackBotToken = process.env.SLACK_BOT_TOKEN;
const slackChannelId = process.env.SLACK_CHANNEL_ID;

if (!slackBotToken || !slackChannelId) {
  console.error("notify-slack: SLACK_BOT_TOKEN and SLACK_CHANNEL_ID are not set — skipping notification");
  process.exit(0);
}

try {
  await postFailureNotification({
    exitStatus: argv.exitStatus,
    serviceResult: argv.serviceResult,
    hostname: argv.hostname,
    unitName: "runner.service",
    slackBotToken,
    slackChannelId,
  });
} catch (error) {
  console.error("notify-slack failed:", error);
  process.exit(1);
}
