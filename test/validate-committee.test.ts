import { describe, it, expect } from "vitest";
import { validateCommitteeString } from "../src/committee-validate";
import { userInfo } from "os";
import { register } from "module";
import { Committee } from "../src/committee";

function getCommitteeFixture(): Committee {
  return {
    networkGenesisHash: "kUt08LxeVAAGHnh4JoAoAMM9ql/hBwSoiFtlnKNeOxA=",

    periodEnd: 2,
    periodStart: 1,
    registryId: 3,

    totalMembers: 2,
    totalVotes: 4,

    xGovs: [
      {
        address: "ROBOTMMVHPOETOTAX3J26UXYKVZX6QB7FHHYGBC44JNBUXMTABD5I3CODE",
        votes: 2,
      },
      {
        address: "ZOMBILANDSIUYQWIUYNKUYZVMCYY6IIT5IBAVNJYYWTVMQVZRBORLOP37E",
        votes: 2,
      },
    ],
  };
}

describe("Committee validator", () => {
  it("Should pass a valid committee", () => {
    const str = JSON.stringify(getCommitteeFixture());
    const output = validateCommitteeString(str);
    expect(output).toEqual(getCommitteeFixture());
  });

  it("Should fail with committee with whitespace committee", () => {
    const str = JSON.stringify(getCommitteeFixture(), null, 2);
    expect(() => validateCommitteeString(str)).toThrow(
      /Committee JSON included whitespace/
    );
  });

  it("Should fail with out of order xGovs", () => {
    const unsortedXgovs = getCommitteeFixture();
    unsortedXgovs.xGovs = [...unsortedXgovs.xGovs].reverse();
    expect(() =>
      validateCommitteeString(JSON.stringify(unsortedXgovs))
    ).toThrow(/Committee JSON xGov array was not sorted/);
  });

  it("Should fail with out of order keys", () => {
    let unsortedKeys = getCommitteeFixture();
    // @ts-ignore
    delete unsortedKeys.registryId;
    unsortedKeys.registryId = getCommitteeFixture().registryId + 100;
    expect(() => validateCommitteeString(JSON.stringify(unsortedKeys))).toThrow(
      /Committee JSON top level fields were not sorted/
    );
  });

  it("Should fail with invalid address", () => {
    const testCommittee = getCommitteeFixture()
    const invalid = `A${testCommittee.xGovs[0].address.slice(1)}`;
    testCommittee.xGovs[0].address = invalid;
    expect(() =>
      validateCommitteeString(JSON.stringify(testCommittee))
    ).toThrow(`Committee JSON included invalid address: ${invalid}`);
  });

  it("Should fail with duplicate address", () => {
    const testCommittee = getCommitteeFixture()
    testCommittee.xGovs[0].address = testCommittee.xGovs[1].address;
    expect(() =>
      validateCommitteeString(JSON.stringify(testCommittee))
    ).toThrow(
      `Committee JSON included duplicate address: ${testCommittee.xGovs[0].address}`
    );
  });

  it("Should fail without correct total members", () => {
    const testCommittee = getCommitteeFixture();
    testCommittee.totalMembers++
    expect(() =>
      validateCommitteeString(JSON.stringify(testCommittee))
    ).toThrow(
      `Committee JSON total members (${testCommittee.totalMembers}) did not match expected (${testCommittee.xGovs.length})`
    );
  });

  it("Should fail without correct total votes", () => {
    const testCommittee = getCommitteeFixture();
    testCommittee.totalVotes++
    expect(() =>
      validateCommitteeString(JSON.stringify(testCommittee))
    ).toThrow(
      `Committee JSON total votes (${testCommittee.totalVotes}) did not match expected (${testCommittee.totalVotes - 1})`
    );
  });

  it("Should fail without period start == period end", () => {
    const testCommittee = getCommitteeFixture();
    testCommittee.periodEnd = testCommittee.periodStart
    expect(() =>
      validateCommitteeString(JSON.stringify(testCommittee))
    ).toThrow(
      `Committee JSON periodEnd was not after periodStart`
    );
  });


  it("Should fail without missing required keys", () => {
    const testCommittee = getCommitteeFixture();
    // @ts-ignore
    delete testCommittee.networkGenesisHash
    expect(() =>
      validateCommitteeString(JSON.stringify(testCommittee))
    ).toThrow(
      `Committee JSON did not pass schema validation`
    );
  });
});
