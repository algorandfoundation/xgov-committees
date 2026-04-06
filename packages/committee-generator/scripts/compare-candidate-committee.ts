import { loadCandidateCommittee } from '../src/candidate-committee.ts';

async function compareCandidateCommittees(fromBlock: number, toBlock: number): Promise<void> {
  const localCommittee = await loadCandidateCommittee(fromBlock, toBlock, 'local');
  if (!localCommittee) {
    console.error(`No candidate committee found locally for block range ${fromBlock}-${toBlock}`);
    process.exit(1);
  }
  const s3Committee = await loadCandidateCommittee(fromBlock, toBlock, 's3');
  if (!s3Committee) {
    console.error(`No candidate committee found in S3 for block range ${fromBlock}-${toBlock}`);
    process.exit(1);
  }

  const missingInS3: string[] = [];
  const missingInLocal: string[] = [];
  const mismatches: { key: string; local: number; s3: number }[] = [];

  for (const [key, value] of Object.entries(localCommittee)) {
    if (!(key in s3Committee)) {
      missingInS3.push(key);
      continue;
    }

    if (s3Committee[key] !== value) {
      mismatches.push({ key, local: value, s3: s3Committee[key] });
    }
  }

  for (const key of Object.keys(s3Committee)) {
    if (!(key in localCommittee)) {
      missingInLocal.push(key);
    }
  }

  console.log('Missing in S3:', missingInS3.length);
  console.log('Missing in Local:', missingInLocal.length);
  console.log('Value mismatches:', mismatches.length);

  if (missingInS3.length) {
    console.log('Missing in S3 keys:', JSON.stringify(missingInS3, null, 2));
  }

  if (missingInLocal.length) {
    console.log('Missing in Local keys:', JSON.stringify(missingInLocal, null, 2));
  }

  if (mismatches.length) {
    console.log('Value mismatches detail:', JSON.stringify(mismatches, null, 2));
  }
  if (missingInS3.length || missingInLocal.length || mismatches.length) {
    process.exit(1);
  }

  console.log('✅ Files match');
}

const [fromBlockStr, toBlockStr] = process.argv.slice(2);

if (!fromBlockStr || !toBlockStr) {
  console.error('Usage: tsx compare-candidate-committee.ts <fromBlock> <toBlock>');
  process.exit(1);
}

const fromBlock = parseInt(fromBlockStr, 10);
const toBlock = parseInt(toBlockStr, 10);

compareCandidateCommittees(fromBlock, toBlock).catch((error) => {
  console.error('Error comparing candidate committees:', error);
  process.exit(1);
});
