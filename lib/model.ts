// Token Radar's model (radar-2): one sealed snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never the ceiling) and every
// other pre-token protocol that could plausibly issue a token of its own: the early rows the radar
// exists to find. A protocol is pre-token when its record carries no token (no market cap, no
// CoinGecko id, no symbol). It is rankable when it is pre-token and not a product of a token that
// already trades: no exchange, no bridge, no liquid staking or restaking product, no wrapped or
// staked name, no versioned pool, no exchange-prefixed name. The live-token protocols are kept apart
// and shown with the market's own values, never mixed into the ranked board; the set-aside protocols
// are shown with the reason each one was left out.
//
// Implied value follows only from the snapshot's own figures. No protocol name is ever special-cased:
// the same functions score every row, and the category multiple is derived at run time from the
// snapshot's own live-token peers, never typed in by hand:
//
//   peerMultiple  = median(mcap_usd / tvl_usd) over live peers in the same category (3+ peers),
//                   else the median over every live protocol; clamped to [0.05, 1.5]
//   growthMult    = 1 + clamp(change_7d, -60, 120) / 100 * 0.5
//   maturityMult  = 0.6 + min(age_days, 1095) / 1095 * 0.4   (age unknown: 365 days)
//   likelihood    = the category's stated prior for ever issuing a token (0.7 to 1.0)
//   breadthMult   = 1 + 0.02 * min(chains, 10)
//   implied       = max(1, round(tvl_usd * peerMultiple * growthMult * maturityMult * likelihood * breadthMult))
//
// Momentum is the early signal: seven-day growth weighted toward young protocols, so a protocol
// growing fast in its first year outranks an old one growing at the same rate.
//
// Farm plans are derived from the protocol's own record (category, chains, TVL, age): the action
// follows the category, the gas follows the chain, the capital follows the size, the hold follows
// the age. Every step states what it costs and how long it takes.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  multiple_floor: number;
  multiple_cap: number;
  multiple_min_peers: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  multiple_floor: 0.05,
  multiple_cap: 1.5,
  multiple_min_peers: 3,
  breadth_per_chain: 0.02,
  breadth_max_chains: 10,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 40;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  momentum: number;
  model: {
    peer_multiple: number;
    peer_count: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    likelihood: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one row: the board's row whole, farm plan included. */
export type RadarRow = BoardRow;

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** A pre-token protocol left out of the ranking, with the reason in one line. */
export interface SetAsideRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  reason: string;
}

/** Everything the dashboard needs: the board, the live set, the set-aside list, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  multiples: Record<string, { multiple: number; peers: number }>;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  set_aside_size: number;
  total_implied_usd: number;
  rows: RadarRow[];
  live: LiveRow[];
  /** Every live-token protocol, compact: the dashboard derives the peer multiples from these. */
  live_all: { category: string | null; tvl_usd: number; mcap_usd: number | null }[];
  set_aside: SetAsideRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list of numbers; null when empty. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that move or wrap another protocol's token instead of issuing one of their own. */
const EXCLUDED_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);

/** Exchange names a wrapped or staked product's name begins with. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Why a pre-token protocol is left out of the ranking, or null when it is rankable. */
export function exclusionReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) {
    if (p.category === 'CEX') return 'An exchange: it lists tokens, it does not launch one of its own.';
    if (p.category.includes('Bridge')) return 'A bridge: it moves other protocols\u2019 assets between chains.';
    return 'A staking product: it wraps a token that already trades.';
  }
  if (VERSIONED.test(p.name)) return 'A versioned pool of another protocol (V2, 2.0 and the like).';
  const words = p.name.toLowerCase().match(/[a-z]+/g) ?? [];
  if (words.includes('wrapped') || words.includes('staked') || words.includes('staking')) {
    return 'A wrapped or staked product of a token that already trades.';
  }
  if (EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e))) return 'An exchange product, named for its exchange.';
  return null;
}

/** Whether a protocol is one the board may rank: pre-token and not a product of a traded token. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && exclusionReason(p) === null;
}

/**
 * The category's stated prior for ever issuing a token of its own. Vault curators and capital
 * allocators manage other protocols' assets, so their own token is less certain than a DEX's or a
 * lender's; an uncategorised protocol gets the cautious value. Stated here, in the open, and shown
 * in the dashboard's method: a prior, not a pick.
 */
export function tokenLikelihood(p: SnapshotProtocol): number {
  const c = p.category;
  if (c === null) return 0.7;
  if (c === 'Risk Curators' || c === 'Onchain Capital Allocator') return 0.8;
  if (c === 'Chain' || c === 'Staking Pool') return 0.9;
  return 1.0;
}

/** The market's own multiple for one category: the median mcap/TVL of its live peers. */
export interface PeerMultiples {
  byCategory: Map<string, { multiple: number; peers: number }>;
  global: number;
}

/** Derive every category's multiple from the snapshot's live-token protocols. */
export function peerMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): PeerMultiples {
  const byCat = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    if (p.category !== null) {
      const list = byCat.get(p.category) ?? [];
      list.push(ratio);
      byCat.set(p.category, list);
    }
  }
  const clamp = (v: number): number => Math.min(model.multiple_cap, Math.max(model.multiple_floor, v));
  const global = clamp(median(all) ?? 0.25);
  const byCategory = new Map<string, { multiple: number; peers: number }>();
  for (const [cat, ratios] of byCat) {
    if (ratios.length < model.multiple_min_peers) continue;
    const m = median(ratios);
    if (m !== null) byCategory.set(cat, { multiple: clamp(m), peers: ratios.length });
  }
  return { byCategory, global };
}

/** The multiple one protocol's category gets: its peers' median, else the market-wide median. */
export function multipleFor(p: SnapshotProtocol, peers: PeerMultiples): { multiple: number; peerCount: number } {
  if (p.category !== null) {
    const hit = peers.byCategory.get(p.category);
    if (hit !== undefined) return { multiple: hit.multiple, peerCount: hit.peers };
  }
  return { multiple: peers.global, peerCount: 0 };
}

/** The five multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  peers: PeerMultiples,
  model: ModelConstants = MODEL,
): {
  implied: number;
  peerMultiple: number;
  peerCount: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  likelihood: number;
  breadthMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple, peerCount } = multipleFor(protocol, peers);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const likelihood = tokenLikelihood(protocol);
  const breadthMult = 1 + model.breadth_per_chain * Math.min(protocol.chains.length, model.breadth_max_chains);
  const implied = Math.max(
    1,
    Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult * likelihood * breadthMult),
  );
  return { implied, peerMultiple: multiple, peerCount, growthPct, growthMult, maturityMult, likelihood, breadthMult, age };
}

/**
 * The early signal: seven-day growth weighted toward young protocols. A protocol growing fast in its
 * first year scores above an old one growing at the same rate, because the radar exists to find
 * launches early. Unknown age scores no youth bonus.
 */
export function momentumOf(protocol: SnapshotProtocol, asOf: string, model: ModelConstants = MODEL): number {
  const age = ageDays(asOf, protocol.listed_at);
  const growth = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(protocol.change_7d, 0)));
  const youth = age === null ? 1 : 1 + (Math.max(0, 365 - age) / 365) * 0.5;
  return round2(growth * youth);
}

// ---------------------------------------------------------------- farm plans

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs on a chain, in dollars; null when it varies too much to state. */
function gasUsd(chain: string): number | null {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 12;
  if (c === 'solana') return 0.1;
  if (c === 'bitcoin') return null;
  if (
    ['arbitrum', 'optimism', 'base', 'blast', 'linea', 'scroll', 'zksync', 'polygon', 'binance', 'avalanche',
     'fantom', 'gnosis', 'celo', 'mantle', 'mode', 'starknet', 'sei', 'sui', 'aptos', 'near', 'tron', 'cronos',
     'kava', 'moonbeam', 'aurora', 'harmony', 'manta', 'fraxtal', 'berachain', 'monad', 'hyperliquid',
     'abstract', 'soneium', 'unichain', 'ink', 'worldchain', 'zora', 'bob', 'corn', 'plasma', 'tac',
     'polygon zkevm', 'redstone', 'oasys', 'astar', 'immutable', 'telos', 'fuse', 'meter'].includes(c)
  ) {
    return 1;
  }
  return 2;
}

/** A gas cost in words: "about $12 of gas", "under $0.10 of gas", or "the network fee, which varies". */
function gasWords(chain: string): string {
  const g = gasUsd(chain);
  if (g === null) return 'the network fee, which varies by chain';
  if (g < 1) return 'under $0.10 of gas';
  return `about $${g} of gas`;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's first action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('cdp')) return `Deposit $${capital} of collateral into ${name} on ${chain} and mint its stable asset against it.`;
  if (c.includes('dex')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('leveraged farm')) return `Open a $${capital} leveraged farm on ${name} on ${chain} at the lowest leverage it offers.`;
  if (c.includes('yield aggregator')) return `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and keep the shares.`;
  if (c.includes('yield')) return `Deposit $${capital} of USDC into ${name}'s top yield vault on ${chain} and keep the shares.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('basis')) return `Deposit $${capital} into ${name}'s basis vault on ${chain} and keep the position open.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('synthetic') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC to ${chain} through ${name}'s own route and use a native app there.`;
  if (c.includes('staking pool') || c.includes('stak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('stable') || c.includes('reserve')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('index')) return `Buy $${capital} of ${name}'s index token on ${chain} and hold it.`;
  if (c.includes('privacy')) return `Deposit $${capital} into ${name}'s shielded pool on ${chain} and keep the note.`;
  if (c.includes('launchpad')) return `Stake $${capital} through ${name} on ${chain} to qualify for its next allocation.`;
  if (c.includes('gaming') || c.includes('nft') || c.includes('social')) return `Use ${name}'s app on ${chain} with $${capital} and hold the asset it gives you.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's second qualifying action: a different move, so the farm is not one transaction. */
function secondActionFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('collateral')) return `Borrow $20 against the supply on ${name}, hold it a week, then repay it in full.`;
  if (c.includes('cdp')) return `Repay a small part of the minted stable asset, then mint it again, so the position shows two-way use.`;
  if (c.includes('dex')) return `Swap $25 in the pool's pair on ${name} once, so the wallet shows trading as well as liquidity.`;
  if (c.includes('leveraged farm')) return `Close and reopen the farm once at the same size, so the position shows a second entry.`;
  if (c.includes('yield') || c.includes('curator') || c.includes('allocator') || c.includes('basis')) return `Claim or compound the vault's rewards once, then leave the rest to accrue.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('synthetic') || c.includes('options')) return `Close the hedge after a week and open a fresh one, so the account shows two trades.`;
  if (c.includes('prediction')) return `Let the first position resolve, then place a second one on a different market.`;
  if (c.includes('rwa')) return `Check the asset's redemption window on ${name} and confirm the holding is still earning.`;
  if (c.includes('chain')) return `Make one more transaction on ${chain} through a second native app, so the wallet is not one-app only.`;
  if (c.includes('staking pool') || c.includes('stak')) return `Restake the first staking rewards through ${name} instead of withdrawing them.`;
  if (c.includes('stable') || c.includes('reserve')) return `Use the stable asset once in a pool on ${chain}, then bring it back to ${name}.`;
  if (c.includes('insurance')) return `Read the policy's claim terms on ${name} and note the cover's expiry date.`;
  if (c.includes('index')) return `Check the index's next rebalance date on ${name} and hold through it.`;
  if (c.includes('privacy')) return `Withdraw a small part of the shielded deposit to a fresh address, then redeposit it.`;
  if (c.includes('launchpad')) return `Join ${name}'s next sale with a small ticket and hold the allocation.`;
  if (c.includes('gaming') || c.includes('nft') || c.includes('social')) return `Complete one more in-app action on ${name} a week after the first.`;
  return `Make a second, smaller deposit into ${name} a week after the first.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names. Costs follow the chain's gas, capital follows the protocol's size, the hold follows its age.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasWords(chain);
  return [
    {
      text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      cost: gas === 'the network fee, which varies by chain' ? 'the network fee for the first transaction' : `${gas} for the first transaction`,
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: secondActionFor(p, chain),
      cost: gas,
      time: '10 minutes',
    },
    {
      text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.',
      cost: `${gas} a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: 'Write the wallet, the dates and every transaction in a farm log, and unwind in the reverse order you entered.',
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

// ---------------------------------------------------------------- the board

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const peers = peerMultiples(snapshot, model);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable protocol, at any size. No TVL cut: the radar exists to
  // find launches early, and a small protocol growing fast is the earliest signal there is.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, peers, model);
    return { p, v, momentum: momentumOf(p, snapshot.as_of, model) };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    watchlist: snapshot.watchlist.includes(s.p.slug),
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    momentum: s.momentum,
    model: {
      peer_multiple: round4(s.v.peerMultiple),
      peer_count: s.v.peerCount,
      growth_pct: round2(s.v.growthPct),
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      likelihood: s.v.likelihood,
      breadth_multiplier: round4(s.v.breadthMult),
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Every pre-token protocol left out of the ranking, with its reason, largest first. */
export function setAsideRows(snapshot: Snapshot): SetAsideRow[] {
  return snapshot.protocols
    .filter((p) => isPreToken(p) && !isRankable(p))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      reason: exclusionReason(p) ?? 'Left out of the ranking.',
    }))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const peers = peerMultiples(snapshot, model);
  const live = liveRows(snapshot);
  const liveAll = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.tvl_usd > 0)
    .map((p) => ({ category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd }))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0));
  const setAside = setAsideRows(snapshot);
  const early = board.filter((r) => !r.watchlist).length;
  const multiples: Record<string, { multiple: number; peers: number }> = {};
  for (const [cat, v] of [...peers.byCategory.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    multiples[cat] = { multiple: round4(v.multiple), peers: v.peers };
  }
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_multiple: round4(peers.global),
    multiples,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    set_aside_size: setAside.length,
    total_implied_usd: board.reduce((n, r) => n + r.implied_value_usd, 0),
    rows: board,
    live,
    live_all: liveAll,
    set_aside: setAside,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
