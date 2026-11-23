// Dip-buy trend bot for btc-race-24h-20261123-0511.
//
// Long-only bot trading CBBTC/USDC on 1-minute Orca Whirlpool bars, from
// $1,000 paper USDC. One strategy for every bar, decided only from the bars
// the harness has sent: no wall clock, no network, no files, no randomness.
//
// Strategy (screened on the frozen dev window with the harness's own fill
// model, exact to the micro-USDC against grade-local):
//   - ENTRY (full cash): the close is in an uptrend (close above its
//     60-bar simple moving average) AND has dipped at least 30 bps below
//     its 21-bar exponential moving average — buy the pullback, not the top.
//   - EXIT (whole position): take profit at +300 bps above the entry close,
//     or stop loss at -60 bps below it. No trailing stop, no re-entry
//     cooldown: a fresh dip setup is required for every entry.
//   - No new entries after batch 1380 of the 1440-bar window (an entry in
//     the last hour has no time to reach its take profit). Exits stay live.
//   - On the dev window this makes ONE round trip: buy the bar-214 dip at
//     $59,569, sell into the bar-424 peak at $61,443 — net +$27.94, 2 trades,
//     max drawdown 0.95%. In a steady downtrend it never trades (close stays
//     below the 60-bar average), so it keeps the $1,000 intact.
//
// All arithmetic is integer (bigint) on the harness's integer prices and
// quote units: two runs on the same bars produce byte-identical orders.
// The EMA is fixed-point (scaled by 1,000,000); the SMA is an exact integer
// sum, compared without division.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const SMA_N = 60;
const EMA_N = 21;
const DIP_BPS = 30;
const TP_BPS = 300;
const SL_BPS = 60;
const LATE_SEQ = 1380;
const MAX_SLIPPAGE_BPS = 500;
const EMA_SCALE = 1_000_000n;
// EMA alpha = 2 / (EMA_N + 1) = 1 / 11: e = (close + 10 * ePrev) / 11.
const EMA_DEN = BigInt((EMA_N + 1) / 2); // 11
const EMA_NUM = EMA_DEN - 1n; // 10

// Running state, all derived from bars the harness has sent.
let emaScaled: bigint | null = null; // EMA(21) * EMA_SCALE, or null before bar 0
const closes: bigint[] = []; // last SMA_N closes, oldest first
let entryClose: bigint | null = null; // close of the bar the buy was decided on

function latestBar(batch: Batch) {
  for (const b of batch.bars) {
    if (b.symbol === SYMBOL) return b;
  }
  return null;
}

await runBars({
  onBatch(state: BarsState, batch: Batch) {
    // No fresh bar for our symbol this minute: decide nothing on stale data.
    const bar = latestBar(batch);
    if (bar === null || state.warmingUp) return [];
    const close = BigInt(bar.c);

    // Update indicators from this bar's close.
    if (emaScaled === null) {
      emaScaled = close * EMA_SCALE;
    } else {
      emaScaled = (close * EMA_SCALE + EMA_NUM * emaScaled) / EMA_DEN;
    }
    closes.push(close);
    if (closes.length > SMA_N) closes.shift();

    const held = state.positions.get(SYMBOL);
    const qty = held === undefined ? 0n : held.qty;

    if (qty === 0n) {
      // No position: a buy decided earlier that was rejected leaves no
      // position, so any stored entry close is stale.
      entryClose = null;
      if (state.seq >= LATE_SEQ) return [];
      if (closes.length < SMA_N || emaScaled === null) return [];
      let smaSum = 0n;
      for (const c of closes) smaSum += c;
      // Uptrend: close above the 60-bar average.
      if (close * BigInt(SMA_N) <= smaSum) return [];
      // Dip: close at least DIP_BPS below EMA(21).
      // close <= ema * (10000 - DIP) / 10000, in integers.
      if (close * 10_000n * EMA_SCALE > emaScaled * BigInt(10_000 - DIP_BPS)) return [];
      if (state.cash < 1_000_000n) return [];
      entryClose = close;
      return [
        {
          side: 'buy',
          symbol: SYMBOL,
          notional_quote_units: state.cash,
          max_slippage_bps: MAX_SLIPPAGE_BPS,
        },
      ];
    }

    // Holding: exit on take profit or stop loss, measured on the entry close.
    if (entryClose === null) {
      // Position without a recorded entry (cannot happen through our own
      // orders): anchor exits to the current close so nothing exits spuriously.
      entryClose = close;
      return [];
    }
    const hitTp = close * 10_000n >= entryClose * BigInt(10_000 + TP_BPS);
    const hitSl = close * 10_000n <= entryClose * BigInt(10_000 - SL_BPS);
    if (!hitTp && !hitSl) return [];
    return [
      {
        side: 'sell',
        symbol: SYMBOL,
        qty,
        max_slippage_bps: MAX_SLIPPAGE_BPS,
      },
    ];
  },
});
