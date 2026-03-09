# xgov-committees

Repo to produce the [xGov](https://xgov.algorand.co) [committee file](https://arc.algorand.foundation/ARCs/arc-0086#representation) for a given cohort using an archival node.

The data used to create the committee is provided for your convenience, but you can also recreate all of it by specifying a new cache directory.

## Committee Files

Links to Mainnet committee files. `{period start round}-{period end round}: {committee ID}`

<!-- BEGIN COMMITTEE AUTOGEN -->

- 50000000-53000000: [YdwWoYDvsAd4F2Ws/dXSt4sTqUwOelMLxcT3R0jlrFE=](https://raw.githubusercontent.com/algorandfoundation/xgov-committees/refs/heads/main/data/mainnet-v1.0-wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8_/committee/50000000-53000000.json)
- 51000000-54000000: [Uk0nkuGWyT2b2zlsRSwZGl8Sp6tflAwWEuFo0Ouc3H4=](https://raw.githubusercontent.com/algorandfoundation/xgov-committees/refs/heads/main/data/mainnet-v1.0-wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8_/committee/51000000-54000000.json)
- 52000000-55000000: [VfCa8q9E/gw9tKfVrlCOrmtOrXi4FimPF9v2sD1nlAA=](https://raw.githubusercontent.com/algorandfoundation/xgov-committees/refs/heads/main/data/mainnet-v1.0-wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8_/committee/52000000-55000000.json)
- 53000000-56000000: [RRkptkcDDa5miKXHtJHo55JY4I4lg8xKZN85FuxF8K0=](https://raw.githubusercontent.com/algorandfoundation/xgov-committees/refs/heads/main/data/mainnet-v1.0-wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8_/committee/53000000-56000000.json)
- 54000000-57000000: [efqI2KyJAXQbD+WqSkSiqEmnepXNVhWT2dIIX0OJzvg=](https://raw.githubusercontent.com/algorandfoundation/xgov-committees/refs/heads/main/data/mainnet-v1.0-wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8_/committee/54000000-57000000.json)
- 55000000-58000000: [4ffYWWJh6jouRH0x6Re9oEbmWu40K9F8ukhRQ1teCpQ=](https://raw.githubusercontent.com/algorandfoundation/xgov-committees/refs/heads/main/data/mainnet-v1.0-wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8_/committee/55000000-58000000.json)
- 56000000-59000000: [TxVlMnPRq4AhJyyiVvaf6jkZcDC0TcPPjAa2YXKZ0OM=](https://raw.githubusercontent.com/algorandfoundation/xgov-committees/refs/heads/main/data/mainnet-v1.0-wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8_/committee/56000000-59000000.json)

<!-- END COMMITTEE AUTOGEN -->

## Setup

Requirements:

- **Git-LFs**
  - This repo utilizes Git-LFS to distribute the data/ directory containing block headers, intermediate data and the committee files. See [git-lfs.com](https://git-lfs.com/) for installation instructions.
  - If you have cloned the repo before installing LFS, you can run `git lfs install` and `git lfs pull` to hydrate the data directory.
- nodejs v18+

Install npm package requirements:

```bash
npm i
```

## Run

You can pass runtime arguments either as command line flags, or as environment variables/files.

From- and to- blocks are required. The least arguments you can provide are:

```bash
./run.sh --from-block 50000000 --to-block 53000000
```

To run with an environment configuration file (here: `.env.mainnet.1`):

```bash
# ENV=.env.mainnet.1 ./run.sh
```

Assuming you have git-lfs installed, you should see this terse output as the cached committee file is loaded and validated:

```bash
Using cached committee file: data/mainnet-v1.0-wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8_/committee/50000000-53000000.json
Committee file is valid
Committee ID: YdwWoYDvsAd4F2Ws/dXSt4sTqUwOelMLxcT3R0jlrFE=
```

To recreate the data from an archival node, you can specify a cache directory override with `-d`:

```
# ENV=.env.mainnet.1 ./run.sh -d verify-data
Creating verify-data/mainnet-v1.0-wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8_/blocks
Network:        mainnet-v1.0                                                  
Registry app:   3147789458
Node:           https://mainnet-api.4160.nodely.dev
Token:          No 
First block:    50000000
Last block:     53000000
--
Total blocks:   3000000
Existing:       316
Remaining:      2999684
--
Fetching block:	50001809 1818/3000000 0.06% 46.72 rnd/sec ETA 17h 49m
```

After 1000 blocks have been fetched, the script will periodically report the speed in rounds per second, as well as a rough time estimate.

> ⚠️ **Warning**: The default node configuration uses the Nodely free tier archival services, but due to the number of requests involved in fetching all 3 million block headers, the free tier quota will be reached several times during this process, and the script will exit. We recommend running with an archival node you have unlimited access to.

After all blocks are fetched:

- the proposer data will be aggregated
- the candidate committee data will be generated
- eligible xGovs will be queried from the registry contract
- the committee file will be generated
- the committee ID will be calculated and displayed

Sample output (during proposer data aggregation)

```
Block proposer:	50230999 743000/3000000 24.77% 
```

Sample output, successful exit:

```
Proposer data:  3000000 OK                                                    
Writing proposers to verify-data/mainnet-v1.0-wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8_/proposers/50000000-53000000.jsons
Writing candidate committee to verify-data/mainnet-v1.0-wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8_/candidate-committee/50000000-53000000.json
Found XX xGovs. Querying subscription rounds. Cutoff_block=53000000 
Ignoring Y xGov(s) that subscribed after the cutoff round (53000000)
Found XY xGovs subscribed before cutoff round 53000000
Writing subscribed xGovs to verify-data/mainnet-v1.0-wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8_/subscribed-xGovs/50000000-53000000.json
Writing committee to verify-data/mainnet-v1.0-wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8_/committee/50000000-53000000.json
Committee ID: YdwWoYDvsAd4F2Ws/dXSt4sTqUwOelMLxcT3R0jlrFE=
```

You can then find the committee file at the path specified by the second to last line - `Writing committee to ...`

## Configuration

The following command line arguments are supported:

```
# ./run.sh --help
Options:
      --version          Show version number                           [boolean]
  -a, --registry-app-id  xGov Registry App ID     [number] [default: 3147789458]
  -f, --from-block       first block to process              [number] [required]
  -t, --to-block         last block to process               [number] [required]
  -C, --concurrency      number of concurrent requests to maintain
                                                           [number] [default: 1]
  -s, --algod-server     algod server hostname
                       [string] [default: "https://mainnet-api.4160.nodely.dev"]
  -p, --algod-port       algod server port               [number] [default: 443]
  -T, --algod-token      algod server token               [string] [default: ""]
  -d, --data-path        path to cache block responses
                                                     [string] [default: "data/"]
  -v, --verbose          verbose mode                 [boolean] [default: false]
      --help             Show help                                     [boolean]
```

Most flags have sensible defaults pointing to Mainnet registry & nodes.

If your progress is too slow, consider tweaking the `--concurrency` argument, which controls how many requests are made in parallel to fetch block headers.

The first Mainnet xGov cohort (rounds [50M - 53M)) can be run with the provided environment file `.env.mainnet.1` as such:

```bash
# ENV=.env.mainnet.1 ./run.sh
```

Subsequent cohorts will be provided as environment files as well, e.g. `.env.mainnet.2` etc.

The environment file has the following configuration for cohort 1:

```
REGISTRY_APP_ID=3147789458
FIRST_BLOCK=50000000
LAST_BLOCK=53000000
DATA_PATH=data
CONCURRENCY=5
ALGOD_SERVER=https://mainnet-api.4160.nodely.dev
ALGOD_PORT=443
ALGOD_TOKEN=
```

This would be equivalent to running with explicit command line arguments:

```bash
./run.sh --registry-app-id 3147789458 --from-block 50000000 --to-block 53000000 --data-path data --concurrency 5 --algod-server https://mainnet-api.4160.nodely.dev --algod-port 443
```

## Cached data

Cached data is separated by network. The default mainnet data directory is:

`data/mainnet-v1.0-wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8_`

The following cache directories are available:

```
blocks
proposers
candidate-committee
subscribed-xGovs
committee
```

### blocks/

The blocks directory stores block headers in chunks of 1000, e.g. `blocks/50000000.json` would store headers from `50000000` until `50000999`.

The payload is a JSON object with the round number as keys, and a JSON-stringified representation of the block header as the values.

```json
{
  "50000000": "{\"rnd\":50000000,\"prev\":\"blk-6YMKPLZZQC7EKKTWC4GH33TSRATT5P6JMFA27R6RZNKTWV3KZFBA\",\"seed\":\"KgQw23wQQCdfs+XCbIHI1W4v59mUxQQNyPfM686TSpA=\",\"txn\":\"G/+XRK5QNG6B4D2Nzg1pk6IfCiV6waAW+DVhmF5RNdw=\",\"txn256\":\"imm57duv5GGkQPxnbdsJVxBXu5/Ae02I5i1NhNeKriM=\",\"ts\":1747449435,\"gen\":\"mainnet-v1.0\",\"gh\":\"wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=\",\"prp\":\"4TPMQLUIBMQ6ILR4FSBEWJACEOYJVYZ7PWL333KL47DHVT6TJHH55E5WWE\",\"fc\":75123,\"bi\":9605960,\"pp\":9643521,\"fees\":\"Y76M3MSY6DKBRHBL7C3NNDXGS5IIMQVQVUAB6MP4XEMMGVF2QWNPL226CA\",\"rwd\":\"737777777777777777777777777777777777777777777777777UFEJ2CI\",\"earn\":218288,\"frac\":6886250026,\"rwcalr\":50500000,\"proto\":\"https://github.com/algorandfoundation/specs/tree/236dcc18c9c507d794813ab768e467ea42d1b4d9\",\"tc\":3000113378,\"spt\":{\"0\":{\"n\":49999872}}}",
...
}
```

### proposers/

The proposers directory stores aggregated proposed blocks per proposer for a given cohort.

The payload is a JSON _stream_ file, with one record per row corresponding to a unique proposer over the block range, with the proposed blocks as an array of numbers.

The first cohort's proposers would be stored under `proposers/50000000-53000000.jsons`

This example line shows a proposer `DZX..` having produced one block (51910100):

```
{"DZX4ZSE7QWTD3OPW47GEWE57OXTGXUVOATQKIIKM2DFJSLUHQXNNIH2QBQ":[51910100]}
```

### candidate-committee/

This directory stores the candidate committee members' voting power for a given cohort.

The payload is a JSON file, with the proposers as keys and the number of blocks produced as values.

The first cohort's proposers would be stored under `candidate-committee/50000000-53000000.json`

This excerpt shows a proposer having produced one block, corresponding to 1 unit of potential xGov voting power.

```
  "DZX4ZSE7QWTD3OPW47GEWE57OXTGXUVOATQKIIKM2DFJSLUHQXNNIH2QBQ":1,
```

### subscribed-xGovs/

This directory stores the candidate-committee addresses that had subscribed to become xGovs before the cohort end block (a.k.a. `--to-block` in arguments)

The payload is a JSON file, with subscribed xGovs as keys and their subscription round numbers as values.

xGovs that subscribed _after_ the end block are not eligible for the cohort, and not stored in the cache file.

The first cohort's proposers would be stored under `subscribed-xGovs/50000000-53000000.json`

This excerpt shows a subscribed xGov having subscribed at round 52423310.

```
  "ICXFIHCHNLKT3NU5OYBDSTQWWYPRGJDUYBQ3AZR7GJVLMXY62IWIHE6U7I": 52423310
```

### committee/

This directory stores the committee file for a given cohort.

The payload schema is specified in [ARC-86](https://arc.algorand.foundation/ARCs/arc-0086#representation) under "Representation".
