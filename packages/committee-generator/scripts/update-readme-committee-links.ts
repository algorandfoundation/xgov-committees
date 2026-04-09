#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ quiet: true, path: process.env.ENV });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CommitteeMetadata {
  fromRound: number;
  toRound: number;
  committeeId: string;
  totalMembers: number;
  totalVotes: number;
}

interface CommitteeIndex {
  committees: Record<string, CommitteeMetadata>;
  lastUpdated: string;
  totalCommittees: number;
}

const NETWORK_PREFIX = 'mainnet-v1.0-wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8_';
const AUTOGEN_START = '<!-- BEGIN COMMITTEE AUTOGEN -->';
const AUTOGEN_END = '<!-- END COMMITTEE AUTOGEN -->';

async function fetchCommitteeIndex(s3PublicUrl: string): Promise<CommitteeIndex> {
  const indexUrl = `${s3PublicUrl}/${NETWORK_PREFIX}/committee/index.json`;
  console.log(`Fetching committee index from: ${indexUrl}`);

  const response = await fetch(indexUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch index.json: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

function generateMarkdownLines(
  committees: Record<string, CommitteeMetadata>,
  s3PublicUrl: string,
): string[] {
  // Sort committees by fromRound (ascending)
  const sorted = Object.values(committees).sort((a, b) => a.fromRound - b.fromRound);

  return sorted.map((committee) => {
    const { fromRound, toRound, committeeId } = committee;
    const committeeUrl = `${s3PublicUrl}/${NETWORK_PREFIX}/committee/${fromRound}-${toRound}.json`;
    return `- ${fromRound}-${toRound}: [${committeeId}](${committeeUrl})`;
  });
}

function updateReadme(readmePath: string, newLines: string[]): void {
  const content = fs.readFileSync(readmePath, 'utf-8');

  const startIdx = content.indexOf(AUTOGEN_START);
  const endIdx = content.indexOf(AUTOGEN_END);

  if (startIdx === -1 || endIdx === -1) {
    throw new Error(
      `Could not find autogen markers in README.md. Looking for:\n${AUTOGEN_START}\n${AUTOGEN_END}`,
    );
  }

  const before = content.substring(0, startIdx + AUTOGEN_START.length);
  const after = content.substring(endIdx);

  const newContent = before + '\n\n' + newLines.join('\n') + '\n\n' + after;

  fs.writeFileSync(readmePath, newContent, 'utf-8');
  console.log(`Updated ${readmePath}`);
}

async function main() {
  const s3PublicUrl = (
    process.env.S3_PUBLIC_URL || 'https://xgov-committees.algorand.tech'
  ).replace(/\/+$/, ''); // Remove trailing slashes

  console.log(`Using S3 public URL: ${s3PublicUrl}\n`);

  // Fetch committee index
  const index = await fetchCommitteeIndex(s3PublicUrl);
  console.log(`Found ${index.totalCommittees} committees (last updated: ${index.lastUpdated})\n`);

  // Generate markdown lines
  const markdownLines = generateMarkdownLines(index.committees, s3PublicUrl);

  console.log('Generated committee links:');
  markdownLines.forEach((line) => console.log(line));
  console.log();

  // Update README.md
  const readmePath = path.join(__dirname, '..', 'README.md');
  updateReadme(readmePath, markdownLines);

  console.log('✅ README.md updated successfully');
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
