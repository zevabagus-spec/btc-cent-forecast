// btc-cent-forecast-01 entry (Node 22, standard library only): a damped
// 24-hour-median reversion forecast of Bitcoin's price 240 minutes ahead.
//
// The guess is a shrunk step from the checkpoint close toward the median of
// the last 24 hours of 1-minute closes:
//
//   guess = last + BETA * (median(last 1440 closes) - last),  BETA = 0.15
//
// Why: absolute error is scored, so the guess should be the conditional
// median of the price 4 hours out. On the kit's practice history (merged
// into one 5,520-minute series and backtested on 128 rolling checkpoints
// 30 minutes apart), the 4-hour return is mildly mean-reverting: regressing
// it on the past 4-hour return, the deviation from the 24-hour median and
// the past 24-hour return all give negative coefficients, and shrinking the
// checkpoint close 15% of the way toward the 24-hour median cuts the mean
// absolute error by about 2.7% against persistence, in both halves of the
// window. The shrinkage is deliberately small: in a trending window the
// reversion step costs, so a large step would be a bet on one regime, while
// a small one keeps most of the gain if mean reversion holds and bounds the
// loss if it does not. The median (not the mean) anchors the level because
// this pool's price moves in cents with occasional one-minute jumps, and a
// median over a full day is not dragged by a single spike. Nothing here is
// fitted to a price level: the only constants are the window (one day) and
// the shrinkage (0.15), both chosen on the rolling backtest, and the program
// uses only the prices in the case it is given — no lookahead, no network.
//
// What an entry must do:
//   - read every <id>.in in the input directory (the grader runs one case at
//     a time, with only that case's file there), canonical JSON
//     {"schema":"makefun/btc-cent-case/v1","competition","case","at",
//     "horizon_minutes","markets":[{"id","name","start","prices"}]}, where
//     `prices` holds one close a minute in US dollars per whole BTC from
//     `start` to `at` inclusive, so the last one is the close at the
//     checkpoint;
//   - write <id>.out to the output directory:
//     {"forecasts":[{"case":"<the case's id>","price":<number>}]}, exactly one
//     row naming the case and no other key, its price a finite number greater
//     than 0 and less than 10,000,000, at most 1 MiB. Anything else is an
//     invalid case, scored as if the guess were the checkpoint's own close,
//     and an entry with any invalid case ranks below every valid one and
//     takes no prize.
// It runs offline, with no network, under the case's time cap: everything it
// knows is in the case's prices.
//
// Outside the grader's container, MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR
// stand in for /input and /output:
//   mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The smallest positive price on the grid: one unit of its 5 decimals. */
const MIN_PRICE = 0.00001;
/** The largest grid price below the scorer's exclusive 10,000,000-dollar cap. */
const MAX_PRICE = 9_999_999.99999;

/** Minutes of closes the median anchor looks back: one full day. */
const MEDIAN_WINDOW = 1440;
/** How far the guess steps from the checkpoint close toward the median. */
const REVERSION = 0.15;

interface CaseMarket {
  id: string;
  prices: number[];
}

interface Case {
  markets: CaseMarket[];
}

/** x kept on the grid's 5 decimals and inside the scorer's (0, 10,000,000). */
const price5 = (x: number): number => Math.round(Math.min(MAX_PRICE, Math.max(MIN_PRICE, x)) * 1e5) / 1e5;

/** The median of a non-empty list of numbers, via a sorted copy. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * The forecast for one market: the checkpoint close moved REVERSION of the
 * way toward the median of the last MEDIAN_WINDOW closes (or all closes,
 * when the case holds fewer). A convex combination of two prices from the
 * case, so it is always finite and positive when they are. Non-finite values
 * are ignored rather than trusted: a single corrupt close must not sink the
 * case, and the grader's clean data is unaffected.
 */
function forecast(m: CaseMarket): number {
  if (!Array.isArray(m.prices) || m.prices.length === 0) throw new Error(`market ${m.id} has no prices`);
  const finite = m.prices.filter((p) => typeof p === 'number' && Number.isFinite(p));
  if (finite.length === 0) throw new Error(`market ${m.id} has no finite prices`);
  const last = finite[finite.length - 1] as number;
  const anchor = median(finite.slice(-MEDIAN_WINDOW));
  return price5(last + REVERSION * (anchor - last));
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (!Array.isArray(c.markets) || c.markets.length !== 1) throw new Error(`${file} does not hold exactly one market`);
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ forecasts: [{ case: id, price: forecast(c.markets[0] as CaseMarket) }] })}\n`);
}
