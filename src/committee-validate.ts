import { decodeAddress } from "algosdk";
import { Committee } from "./committee";
import { isEqual } from "./utils";

export function validateCommitteeString(committeeStr: string): Committee {
  // no whitespace in committee
  if (/\s/.test(committeeStr))
    throw new Error(`Committee JSON included whitespace`);

  let committee: Committee;
  try {
    committee = JSON.parse(committeeStr);
  } catch (e) {
    throw new Error(`Committee JSON was invalid: ${(e as Error).message}`);
  }

  // validate overall schema
  // validate(data, committeeSchema)

  // validate xGov array is sorted lex by address
  const xgovAddress = committee.xGovs.map(({ address }) => address);
  const sortedXgovAddress = [...xgovAddress].sort(
    (a, b) => (a < b ? -1 : 1)
  );
  if (!isEqual(xgovAddress, sortedXgovAddress)) {
    throw new Error(`Committee JSON xGov array was not sorted`);
  }

  // validate top level key order is sorted lex
  const topKeys = Object.keys(committee);
  const sortedTopKeys = [...topKeys].sort((a, b) => (a < b ? -1 : 1));
  if (!isEqual(topKeys, sortedTopKeys)) {
    throw new Error(`Committee JSON top level fields were not sorted`);
  }

  let expectedTotalVotes = 0
  // validate addresses in xGov array + uniqueness
  const xGovs = new Set<string>()
  for(const { address, votes } of committee.xGovs) {
    try {
        decodeAddress(address)
    } catch(e) {
        throw new Error(`Committee JSON included invalid address: ${address}`)
    }
    if (xGovs.has(address)) {
        throw new Error(`Committee JSON included duplicate address: ${address}`)
    }
    xGovs.add(address)
    expectedTotalVotes += votes
  }

  // validate totals
  if (committee.totalVotes !== expectedTotalVotes) {
    throw new Error(`Committee JSON total votes (${committee.totalVotes}) did not match expected (${expectedTotalVotes})`)
  }
  if (committee.totalMembers !== committee.xGovs.length) {
    throw new Error(`Committee JSON total members (${committee.totalMembers}) did not match expected (${committee.xGovs.length})`)
  }

  // validate start < end
  if (committee.periodStart >= committee.periodEnd) {
    throw new Error(`Committee JSON periodEnd was not after periodStart`)
  }

  return committee
}
