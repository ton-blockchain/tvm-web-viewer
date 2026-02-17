# TVM Retracer

<img width="600px" src="https://github.com/user-attachments/assets/23bbea7a-f2c8-40e3-b185-b1ae3c0f0913"/>

`TVM Retracer` is a browser-based stack tracer for debugging TON smart contract transactions.

Live app: https://retracer.ton.org/

## What it does

- Replays a transaction and shows TVM compute steps
- Shows stack state per step with previous/next navigation
- Displays execution metadata (fees, balances, exit code, VM steps)
- Parses C5 actions
- Shows executor logs
- Links to multiple explorers for the same transaction
- Includes opcode docs lookup (loaded from `ton-community/tvm-spec`)
- Supports both mainnet and testnet

## Quick start (local development)

### Prerequisites

- Node.js `20.19+` (required by Vite 7)
- Yarn `1.x` (`packageManager` is pinned to Yarn classic)

### Install and run

```bash
yarn install
yarn dev
```

Open the local URL printed by Vite (usually `http://localhost:5173`).

### Build and preview

```bash
yarn build
yarn preview
```

### Lint

```bash
yarn lint
```

## Usage

1. Paste a transaction reference into the input.
2. Press `Enter` or click `Emulate`.
3. Inspect execution steps, stack changes, logs, and C5 actions.

Keyboard shortcuts:

- `ArrowLeft`: previous compute step
- `ArrowRight`: next compute step

## Supported transaction input formats

You can paste any of the following:

- `ton.cx` transaction links
- `tonviewer.com` transaction links
- `tonscan.org` transaction links
- `explorer.toncoin.org` transaction links
- `dton.io` transaction links
- `lt:hash` (with hex hash)
- Bare hash:
  - hex (64 chars)
  - base64 (auto-detected when it ends with `=`)

If a bare hash or `lt:hash` is provided without explicit network info, Retracer tries mainnet first, then testnet.

## URL query parameters

The app supports deep links through query params:

- `tx`: pre-fills transaction input
- `testnet=true`: forces testnet mode

Examples:

- `https://retracer.ton.org/?testnet=true`
- `https://retracer.ton.org/?tx=4df182d84e9e1bbe76d9cfe35bd023c244c55b03cbd118457769868aa2e85bf4`
- `https://retracer.ton.org/?testnet=true&tx=22552863000001%3A9332cb256b820e4d7a980980bbb280419c1e0e5747f562a0a7a6f4ee16c3d879`

## Data sources

To reconstruct and emulate transactions, the app queries:

- Toncenter API v3 (`/transactions`, `/blocks`)
- Toncenter API v2 (`getConfigAll`, JSON-RPC)
- Tonhub API v4 (`mainnet-v4.tonhubapi.com`, `sandbox-v4.tonhubapi.com`)
- dton GraphQL (`get_lib` for library cells)
- TVM opcode metadata from:
  - `https://raw.githubusercontent.com/ton-community/tvm-spec/refs/heads/master/cp0.json`

## Deployment notes

- `yarn deploy` publishes `dist/` using `gh-pages`.
- `vite.config.ts` uses a special base path (`/tvm-viewer/`) when `GH_PAGES` is set.

For GitHub Pages builds, use:

```bash
GH_PAGES=true yarn build
```

## License

[GPL-3.0](./LICENSE)
