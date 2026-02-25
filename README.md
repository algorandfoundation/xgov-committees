# xgov-committees

A monorepo for Algorand xGov committee generation and validation tools.

## Overview

This repository contains tools for producing xGov committee files for Algorand governance cohorts using archival node data.

## Repository Structure

```
xgov-committees/
├── packages/
│   └── committee-generator/          # Main committee generation package
│       ├── src/
│       │   ├── algod.ts              # Algod node interactions
│       │   ├── blocks.ts             # Block header fetching
│       │   ├── proposers.ts          # Proposer data aggregation
│       │   ├── candidate-committee.ts # Candidate committee generation
│       │   ├── subscribed-xgovs.ts   # xGov subscription queries
│       │   ├── committee.ts          # Committee file generation
│       │   ├── config.ts             # Configuration handling
│       │   └── cache/                # Caching utilities (S3 & local)
│       ├── test/                     # Test files (vitest)
│       ├── package.json
│       ├── tsconfig.json
│       └── run.sh                    # CLI entry point
├── package.json                      # Root workspace config
├── tsconfig.json                     # Root TypeScript config
└── .gitignore
```

## Workspace Setup

This is an npm workspaces monorepo. All packages are located in the `packages/` directory.

### Install Dependencies

```bash
npm install
```

### Build

```bash
npm run build
```

### Test

```bash
npm run test
```

## Key Packages

### committee-generator

Main package for:

- Fetching block headers from archival nodes
- Aggregating proposer data
- Generating candidate committees
- Querying subscribed xGov members
- Creating and validating committee files

See `packages/committee-generator/README.md` for detailed usage.
