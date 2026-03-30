import { spawnSync } from "node:child_process";
import { WebClient } from "@slack/web-api";

// Slack section block text field max: https://docs.slack.dev/reference/block-kit/blocks/section-block
const SLACK_BLOCK_CHAR_LIMIT = 3000;
// Journal tail char limit w/ room for code block markup
const JOURNAL_CHAR_LIMIT = SLACK_BLOCK_CHAR_LIMIT - 100;

interface ExecStopPostArgs {
  exitStatus: string;
  serviceResult: string;
  hostname: string;
}

interface BuildMessageArgs extends ExecStopPostArgs {
  journalTail: string;
}

interface PostFailureNotificationArgs extends ExecStopPostArgs {
  unitName: string;
  slackBotToken: string;
  slackChannelId: string;
}

export function isFailure(serviceResult: string): boolean {
  return serviceResult !== "success" && serviceResult !== "timeout";
}

export function getJournalTail(unitName: string): string {
  const result = spawnSync("journalctl", ["-u", unitName, "-n", "50", "--no-pager", "-o", "short-iso"], {
    encoding: "utf-8",
  });
  if (result.error) return `Journal unavailable: ${result.error.message}`;
  if (result.status !== 0) return `Journal unavailable: exit code ${result.status}`;
  return result.stdout;
}

/** Builds a Block Kit message for a runner failure. Truncates journal tail to fit Slack's 3000-char section limit. */
export function buildMessage(args: BuildMessageArgs): { text: string; blocks: object[] } {
  const { exitStatus, serviceResult, hostname, journalTail } = args;
  const timestamp = new Date().toISOString();

  const text = `Runner failure on ${hostname}: service_result=${serviceResult}, exit_status=${exitStatus}`;

  const truncatedJournal =
    journalTail.length > JOURNAL_CHAR_LIMIT ? journalTail.slice(-JOURNAL_CHAR_LIMIT) : journalTail;

  const journalBlock = `\`\`\`\n${truncatedJournal}\n\`\`\``;

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "🚨 xGov Committees Runner Service Failure",
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Service Result:*\n${serviceResult}` },
        { type: "mrkdwn", text: `*Exit Status:*\n${exitStatus}` },
        { type: "mrkdwn", text: `*Hostname:*\n${hostname}` },
        { type: "mrkdwn", text: `*Time:*\n${timestamp}` },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Journal tail (last 50 lines):*\n${journalBlock}`,
      },
    },
  ];

  return { text, blocks };
}

/**
 * Posts a failure notification to Slack. Throws on Slack API error, callers (notify-slack) must handle it.
 * Does not perform any check on args.serviceResult; as its name implies, the function assumes already a "failure"
 * scenario (handled by isFailure).
 */
export async function postFailureNotification(args: PostFailureNotificationArgs): Promise<void> {
  const { unitName, slackBotToken, slackChannelId } = args;

  const journalTail = getJournalTail(unitName);
  const { text, blocks } = buildMessage({ ...args, journalTail });

  const client = new WebClient(slackBotToken);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await client.chat.postMessage({ channel: slackChannelId, text, blocks: blocks as any[] });
}
