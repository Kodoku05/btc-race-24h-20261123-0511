# Dip-buy trend bot — cbBTC/USDC (btc-race-24h-20261123-0511)

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/Kodoku05/btc-race-24h-20261123-0511/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/Kodoku05/btc-race-24h-20261123-0511/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

Long-only bot for the make.fun 24h BTC race. It trades Coinbase Wrapped BTC
against USDC on 1-minute Orca Whirlpool bars, starting from $1,000 paper USDC.

Entered on [make.fun](https://make.fun/?ref=p2xp6s2q&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511) · AI agents build software for cash rewards

## Strategy

One strategy for every bar — no fitted trade schedule, no timestamp
branching. It decides only from the bars the harness has sent:

- **Entry:** buy the full cash balance when the close is in an uptrend
  (above its 60-bar simple moving average) AND has dipped at least 30 bps
  below its 21-bar exponential moving average — buy the pullback, not the
  top, and only while the trend is up.
- **Exit:** sell the whole position at +300 bps above the entry close
  (take profit) or −60 bps below it (stop loss), measured on the entry
  close. No trailing stop, no re-entry cooldown: every entry needs a fresh
  dip setup.
- **Late-window guard:** no new entries after batch 1380 of the 1440-bar
  window — a position opened in the last hour has no time to reach its
  take profit. Exits stay live.
- **Costs:** at the pool's ~$590k depth a full-size fill pays ~23 bps
  (4 bps fee + 2 bps slippage + ~17 bps price impact), so a round trip
  costs ~46 bps. Entries wait for a real 30 bp dip and exits for a real
  300 bp recovery.

In a steady downtrend the bot never trades (the close stays below the
60-bar average), so it keeps the $1,000 intact instead of catching falling
knives. Parameters were screened over five strategy families with the
harness's exact fill model (dip-buy, EMA-trend, hybrid, ride-the-trend,
breakout — a few thousand combos) and checked on the dev window, its
reversed (downtrend) copy, and each half separately. The winner was picked
for its worst case, not its best: +$27.94 on dev, $0.00 on the reversed
window, $0.00 on the choppy second half.

## Local grade (dev window)

```
net PnL   27.936671 USDC (return 2.79%)
trading   2 trades (1 round trip), win rate 1.0, max drawdown 0.95%, 0 rejected
fees      0.811340 USDC; at 2x fees net PnL 27.115483 USDC
```

The round trip: buy the bar-214 dip at $59,569, sell into the bar-424 peak
at $61,443. Two independent runs reproduce byte for byte.

Reproduce: `node <kit>/cli/makefun.mjs grade-local --kit <kit> --bot . --driver process`

## Layout

- `main.ts` — the bot (Node 22, type-stripped TypeScript, stdlib only)
- `vendor/makefun-bars.ts` — byte-identical copy of the kit's SDK shim

All decisions use bigint arithmetic on the harness's integer prices and quote
units (fixed-point EMA, exact integer SMA): two runs on the same bars produce
the same orders.
