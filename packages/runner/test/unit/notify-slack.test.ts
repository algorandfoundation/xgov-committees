import type { SpawnSyncReturns } from "node:child_process";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { isFailure, getJournalTail, buildMessage, postFailureNotification } from "../../src/slack.ts";

vi.mock("@slack/web-api", () => {
  const mockPostMessage = vi.fn().mockResolvedValue({ ok: true });
  return {
    WebClient: vi.fn().mockImplementation(() => ({
      chat: { postMessage: mockPostMessage },
    })),
  };
});

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn().mockReturnValue({
    stdout: "2025-01-01T00:00:00+00:00 runner[123]: some log line\n",
    status: 0,
    error: null,
  }),
}));

const { WebClient } = await import("@slack/web-api");
const { spawnSync } = await import("node:child_process");
const mockSpawnSync = vi.mocked(spawnSync);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MockWebClient = WebClient as any;

function makeSpawnResult(overrides: Partial<SpawnSyncReturns<string>>): SpawnSyncReturns<string> {
  return { pid: 0, output: [], stdout: "", stderr: "", status: 0, signal: null, error: undefined, ...overrides };
}

const baseArgs = {
  exitStatus: "1",
  serviceResult: "exit-code",
  hostname: "test-host",
  unitName: "runner.service",
  slackBotToken: "xoxb-test",
  slackChannelId: "C12345",
};

describe("isFailure", () => {
  it("returns false for 'success'", () => {
    expect(isFailure("success")).toBe(false);
  });

  it.each(["exit-code", "signal", "timeout", "watchdog"])("returns true for '%s'", (result) => {
    expect(isFailure(result)).toBe(true);
  });
});

describe("buildMessage", () => {
  const msgArgs = {
    exitStatus: "1",
    serviceResult: "exit-code",
    hostname: "test-host",
    journalTail: "some log output",
  };

  it("returns fallback text containing exit status, hostname, and service result", () => {
    const { text } = buildMessage(msgArgs);
    expect(text).toContain("test-host");
    expect(text).toContain("exit-code");
    expect(text).toContain("1");
  });

  it("returns blocks array with header, fields, and journal sections", () => {
    const { blocks } = buildMessage(msgArgs);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toMatchObject({ type: "header" });
    expect(blocks[1]).toMatchObject({ type: "section" });
    expect(blocks[2]).toMatchObject({ type: "section" });
  });

  it("includes journal tail in a code block", () => {
    const { blocks } = buildMessage(msgArgs);
    const journalSection = blocks[2] as { text: { text: string } };
    expect(journalSection.text.text).toContain("```");
    expect(journalSection.text.text).toContain("some log output");
  });

  it("truncates journal tail over 2900 chars", () => {
    const longJournal = "x".repeat(3500);
    const { blocks } = buildMessage({ ...msgArgs, journalTail: longJournal });
    const journalSection = blocks[2] as { text: { text: string } };
    // 2900 chars kept from the end
    expect(journalSection.text.text.length).toBeLessThan(3500);
  });
});

describe("getJournalTail", () => {
  it("returns stdout from journalctl command", () => {
    mockSpawnSync.mockReturnValueOnce(makeSpawnResult({ stdout: "journal output\n", status: 0 }));
    const result = getJournalTail("runner.service");
    expect(result).toBe("journal output\n");
    expect(mockSpawnSync).toHaveBeenCalledWith(
      "journalctl",
      ["-u", "runner.service", "-n", "50", "--no-pager", "-o", "short-iso"],
      { encoding: "utf-8" },
    );
  });

  it("returns fallback with error message if spawnSync has an error", () => {
    mockSpawnSync.mockReturnValueOnce(makeSpawnResult({ error: new Error("not found") }));
    const result = getJournalTail("runner.service");
    expect(result).toContain("Journal unavailable");
    expect(result).toContain("not found");
  });

  it("returns fallback with exit code if spawnSync exits non-zero", () => {
    mockSpawnSync.mockReturnValueOnce(makeSpawnResult({ status: 1 }));
    const result = getJournalTail("runner.service");
    expect(result).toContain("Journal unavailable");
    expect(result).toContain("exit code 1");
  });
});

describe("postFailureNotification", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    MockWebClient.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts to Slack with correct channel and message on failure", async () => {
    const mockPostMsg = vi.fn().mockResolvedValue({ ok: true });
    MockWebClient.mockImplementationOnce(function () {
      return { chat: { postMessage: mockPostMsg } };
    });

    await postFailureNotification(baseArgs);

    expect(MockWebClient).toHaveBeenCalledWith("xoxb-test");
    expect(mockPostMsg).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C12345",
        text: expect.stringContaining("exit-code"),
        blocks: expect.any(Array),
      }),
    );
  });

  it("calls journalctl with correct unit name", async () => {
    const mockPostMsg = vi.fn().mockResolvedValue({ ok: true });
    MockWebClient.mockImplementationOnce(function () {
      return { chat: { postMessage: mockPostMsg } };
    });

    await postFailureNotification(baseArgs);

    expect(mockSpawnSync).toHaveBeenCalledWith(
      "journalctl",
      expect.arrayContaining(["runner.service"]),
      expect.any(Object),
    );
  });

  it("catches and logs to stderr if chat.postMessage throws", async () => {
    const mockPostMsg = vi.fn().mockRejectedValue(new Error("slack down"));
    MockWebClient.mockImplementationOnce(function () {
      return { chat: { postMessage: mockPostMsg } };
    });

    await postFailureNotification(baseArgs);

    expect(vi.mocked(console.error)).toHaveBeenCalledWith("Failed to post Slack notification:", expect.any(Error));
  });

  it("posts with journal unavailable message when spawnSync fails", async () => {
    mockSpawnSync.mockReturnValueOnce(makeSpawnResult({ error: new Error("no journal") }));
    const mockPostMsg = vi.fn().mockResolvedValue({ ok: true });
    MockWebClient.mockImplementationOnce(function () {
      return { chat: { postMessage: mockPostMsg } };
    });

    await postFailureNotification(baseArgs);

    const call = mockPostMsg.mock.calls[0][0];
    const journalSection = call.blocks[2] as { text: { text: string } };
    expect(journalSection.text.text).toContain("Journal unavailable");
  });
});
