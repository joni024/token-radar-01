# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/joni024/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/joni024/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Entry for the [make.fun](https://make.fun/bounty/token-radar-01) competition
`token-radar-01`: build the best token launch radar — a program and the web
dashboard it writes, ranking pre-token protocols by implied value with a farm
plan for each.

New to make.fun? [Sign up with my referral link](https://make.fun/r/yvgdez31)
(code `yvgdez31`).

## What it does

`main.ts` (Node 22, standard library only) reads the sealed DefiLlama protocol
snapshot, scores every pre-token protocol that could plausibly issue a token of
its own, and writes:

- `board.json` — the ranked board: all 40 watchlist protocols plus every other
  rankable pre-token protocol, each with its implied value, its model
  breakdown, a momentum score and a seven-step farm plan.
- `data.js` — the dashboard's dataset, beside the page.
- `dashboard/` — a static page (no network, no framework): a sortable,
  filterable board, a detail view per protocol with the value breakdown and
  farm plan, a live-token view, a set-aside view with the reason for each
  exclusion, and the method itself with a sandbox that re-runs the model.
- `screenshots/` — three screenshots of the dashboard (the board, a detail
  view, a filtered view), decoded at run time from the one-line base64 text
  files in `screenshots_b64/`, so the repository holds no binary file.
- `dossier.json` — the judge's dossier, written with the kit's
  `vendor/makefun-board.ts`.

## The value model (radar-2)

```
implied = round( tvl_usd × peer multiple × growth × maturity × likelihood × breadth )
```

- **Peer multiple**: the median mcap/TVL of the live-token peers in the
  protocol's own category, derived from the snapshot at run time (3+ peers),
  else the market-wide median — never a typed-in number.
- **Growth**: seven-day TVL change, clamped to [-60, +120]%, weighted 0.5.
- **Maturity**: 0.6 + up to 0.4 for up to three years listed with no token.
- **Likelihood**: a stated category prior (vault curators 0.8, chains and
  staking pools 0.9, uncategorised 0.7, everything else 1.0).
- **Breadth**: +2% per chain, up to ten chains.

Momentum — the early signal — is seven-day growth weighted toward young
protocols, so a protocol growing fast in its first year outranks an old one
growing at the same rate.

Farm plans are derived from each protocol's own record: the action follows the
category, the gas follows the chain (about $12 on Ethereum, about $1 on the
low-fee chains, under $0.10 on Solana), the capital follows the protocol's size
($50–$250), and the hold follows its age (30–60 days). Every step states what
it costs and how long it takes.

## Run it locally

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
# then open out/dashboard/index.html in a browser (it reads ../data.js)
```

The run is deterministic: the same snapshot in gives the same bytes out.
