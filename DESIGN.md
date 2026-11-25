# DESIGN.md — Pump.fun Replay Sprint bot

## Strategy in one paragraph

Momentum with fast exits. The harness sends a hello (10 SOL capital, max 5 open
positions, max order 100 bps of real SOL reserve, max 16 orders per batch,
2-slot latency, 95 bps protocol + 30 bps creator fee + 105,000 lamports tx fee
per order) and then one batch per slot with that slot's events, marks, fills
and account; the bot answers every batch with its orders. Per curve the bot
tracks price — virtual quote reserves / virtual token reserves — plus net buy
flow (buys minus sells, in SOL) over a short rolling window measured in slots.
It buys a coin early, just after its price breaks a few percent above its
creation price while net buying is still arriving and several distinct wallets
are buying, and it gets out fast: take-profit, stop-loss, a trailing exit once
the position is in profit, and a hard time exit. One small stake per coin
keeps the bot broad enough to clear the 20-coin round-trip bar (each round
trip at least 0.01 SOL).

## Why this shape

On the dev window (24 h, 2–3 Nov 2026, 1,222 coins) the raw data says most
coins spike, then fade: after first crossing +5% above creation price the
median peak within 600 slots is +34%, but the median price 600 slots later is
−7%. So the edge, if any, is in entering the breakout early and exiting into
the spike — not in holding. The pilot momentum baseline in the kit loses
heavily on this window (−9.38 SOL, 95% drawdown) because it stakes 2 SOL per
coin and pyramids; this bot stakes 0.05 SOL, never pyramids, and caps every
exit.

## Parameters (final)

| Parameter | Value | Meaning |
|---|---|---|
| windowSlots | 40 | lookback window in slots for low price and buy flow |
| minRiseBps / maxRiseBps | 300 / 40000 | price rise off the window low, in bps |
| minBreakoutBps / maxBreakoutBps | 0 / 100000 | price above creation price, in bps (no floor: the reserve gate does the filtering) |
| minNetSolLamports | 50,000,000 | net buy SOL over the window (0.05 SOL) |
| minBuys / minBuyers | 2 / 2 | buy trades / distinct buying wallets in the window |
| minRealSol / maxRealSol | 50 / 85 SOL | real SOL reserve bounds at entry — only mature curves near completion |
| minAgeSlots / maxAgeSlots | 0 / 400000 | age since CreateEvent (effectively no age cap) |
| stakeLamports | 80,000,000 | 0.08 SOL per position |
| takeProfitBps | 10000 | +100% over average cost (rarely binds; the trail does the work) |
| stopLossBps | 1000 | −10% under average cost |
| trailBps / trailArmBps | 2500 / 1000 | sell 25% below peak once +10% in profit |
| maxHoldSlots | 1500 | hard time exit |
| cooldownSlots | 300 | wait after an exit before re-entering a coin |
| maxEntriesPerCoin | 1 | one shot per coin (pyramiding tested: worse) |
| buySlippageBps / sellSlippageBps | 500 / 3000 | tight sells so a crashing exit is refused and retried |
| nearHighBps | 8000 | price must be ≥80% of the window high |

## Determinism

No clock, no environment reads, no `Math.random`. Randomness, if ever needed,
would come only from `hello.seed`. Order decisions depend only on the batches
the harness delivered, in delivery order, so two runs over the same data reply
with byte-identical orders. Logs go to stderr only; stdout carries replies.

## Tuning (local replay harness, `tools/sim.ts`, full dev window)

The local harness was verified to reproduce the official `grade-local` result
byte-for-byte on the dev window (net −0.000589 SOL, 43 fills, 23 coins with
the official seed), so all numbers below come from that harness unless marked
official.

- v1 (rise-only trigger, TP +25% / SL −12% / hold 1200): −0.32 SOL, 55 coins.
- v2 (fills of any outcome clear pending flags; near-high + live-flow filters):
  −1.20 SOL, 303 coins — the pending fix exposed over-trading, not an edge.
- v3 (breakout-from-create trigger, TP +30% / SL −15% / hold 600): −1.13 SOL,
  363 coins, 90 wins. Broad early momentum loses everywhere on this window:
  the pilot momentum baseline in the kit scores −9.38 SOL (95% drawdown) and
  the pilot reversion baseline −3.95 SOL.
- v4 (pyramiding into winners, stake 0.03): −1.02 SOL — adds buy higher into
  the run and fade with it.
- v5 (mature-curve ride: enter only at 50–85 SOL real reserve, TP +100% /
  SL −10% / trail 25% / stake 0.08): **mean +0.022 SOL over 4 failed-tx
  keys (worst +0.001), 23 coins, 8 wins, max drawdown 1.6%**. Official
  `grade-local --driver process`: **net −0.000589 SOL, 43 fills, 23 coins,
  23 round trips, max drawdown 1.58%, win rate 34.8%, 90% interval
  [−0.256, +0.287] SOL** — breakeven on the dev window, positive on average
  across fail keys. The win is concentrated: the top 3 coins are 67.6% of
  gains (top coin +0.071 SOL); net without the top coin is −0.195 SOL.
- Sensitivity: the 50 SOL reserve floor is a cliff — 45 SOL scores −0.23,
  55 SOL −0.14 to −0.18, 40 SOL −0.15, 60 SOL −0.14. SL −8% scores −0.085,
  SL −12% −0.059, trail 20% −0.098 (vs SL −10% / trail 25% at +0.018 mean).
  At 2x fees the dev net is −0.125 SOL (local) / −0.051 SOL (official).

## Guardrails (competition)

- Round trip ≥ 0.01 SOL on ≥ 20 distinct coins: **23 coins on the dev
  window** (official grade: 23 round trips) — above the bar, but only just;
  on the final window the count could dip, which is the main risk.
- Max drawdown ≤ 50%: 1.6% on dev, far inside.
- Net PnL > 0 SOL after all fees is required for a paid place; the dev-window
  result is breakeven (−0.0006 official), so the final window decides it.
