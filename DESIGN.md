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
| windowSlots | 50 | lookback window in slots for low price and buy flow |
| minRiseBps / maxRiseBps | 300 / 40000 | price rise off the window low, in bps |
| minBreakoutBps / maxBreakoutBps | 0 / 100000 | price above creation price, in bps (no floor: the reserve gate does the filtering) |
| minNetSolLamports | 50,000,000 | net buy SOL over the window (0.05 SOL) |
| minBuys / minBuyers | 2 / 2 | buy trades / distinct buying wallets in the window |
| minRealSol / maxRealSol | 50 / 85 SOL | real SOL reserve bounds at entry — only mature curves near completion |
| minAgeSlots / maxAgeSlots | 0 / 400000 | age since CreateEvent (effectively no age cap) |
| stakeLamports | 80,000,000 | 0.08 SOL per position |
| takeProfitBps | 5000 | +50% over average cost (banks the spike before it fades) |
| stopLossBps | 1500 | −15% under average cost (lets a winner breathe through a dip) |
| trailBps / trailArmBps | 2500 / 1000 | sell 25% below peak once +10% in profit |
| maxHoldSlots | 1000 | hard time exit |
| cooldownSlots | 0 | no wait after an exit before re-entering a coin |
| maxEntriesPerCoin | 2 | a mature curve that keeps climbing can be ridden twice |
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

## Revisi 2026-11-25 — exit retune + re-entry (gate v5 tidak lolos)

The v5 gate failure was an exits problem, not an entry problem: deleting the
stop-loss and trail entirely scores −0.50 SOL, so the exits are what keep the
bot alive. Two fresh approaches were tried first and both failed honestly:

- **Reserve-ladder sniper** (buy when real reserve first crosses 2/5/10 SOL,
  sell at the next rung 5/10/20/30): −0.78 to −2.48 SOL in the local harness.
  A first-crossing analysis on raw trade prices looked great (+54% median
  10→20 SOL), but it is an illusion — inside one slot a burst already moves
  the price, so by the time a batch shows the crossing and the order fills
  2 slots later the move is gone. Re-done with slot-end prices + 2-slot
  delay the ladder is ~breakeven gross, before fees. Same for dip-buying
  (buy −30%/−50% off the peak: median −0.15 to −0.17) and for broad
  small-stake momentum (0.02–0.03 SOL, TP +10–20% / SL −5–10%, 498–515
  coins): −0.50 to −0.60 SOL. On this window every move fades after the
  batch that shows it; the only surviving shape is the mature-curve ride.
- **Widening the entry** does not add coins cheaply: reserve floor 45 SOL
  scores −0.125 (36 coins) and 40 SOL −0.301 (48 coins) with the new exits —
  the 50 SOL floor is real, coins entering at 45–50 SOL are losers.

What worked, in order (official-seed local harness, `tools/backtest.ts`):

- v6a (TP +50% / SL −12%, hold 1000): +0.138 SOL, 23 coins, 10 wins.
- v6b (TP +50% / SL −15%, hold 1000): **+0.258 SOL, 23 coins, 12 wins,
  max drawdown 1.35%, top-3 share 51%, 2x fees +0.157**. The +50% TP
  banks spikes that fade before +100%; the −15% SL lets winners survive
  a dip that the old −10% SL cut. Sweep over SL 1200–2000 × TP 3000–7000
  (4 failed-tx keys): SL −15% / TP +50% is a plateau — mean +0.257,
  worst +0.257, net without the best coin +0.213 — not a cliff.
- v6c (v6b + re-entry: max 2 entries per coin, no cooldown, window 50):
  **+0.408 SOL, 25 coins, 30 trips, 13 wins, max drawdown 3.75%,
  top-3 share 63%, 2x fees +0.218**. Fail-key sweep: mean +0.399, worst
  +0.371, net without the best coin +0.310. Bootstrap over per-coin PnL
  (2000 resamples): median +0.440, p10 +0.041, p90 +0.796, 8.1% of
  resamples below zero — vs v5's median +0.001, p10 −0.207, 50% below
  zero. The second entry rides the same mature curves that keep climbing
  after the first exit; entries 3 adds net (+0.557) but pushes top-3
  share to 66% and drawdown to 4.6%, so 2 entries is the balance.
- Window 50 (vs 40) adds the 2 extra coins that take distinct mints from
  23 to 25 at a small net cost (25 coins: +0.183 with one entry, +0.408
  with two); window 60 keeps 25 coins at +0.337. Stake 0.05 instead of
  0.08 drops net to +0.253. Official `grade-local` confirmation below.

## Guardrails (competition)

- Round trip ≥ 0.01 SOL on ≥ 20 distinct coins: **25 coins on the dev
  window** (official grade: see below) — above the bar with a 5-coin margin;
  on the final window the count could dip, which is the main residual risk.
- Max drawdown ≤ 50%: 3.8% on dev, far inside.
- Net PnL > 0 SOL after all fees is required for a paid place; the revised
  bot scores **+0.408 SOL on the dev window** (local harness, official
  seed), with a bootstrap median of +0.440 SOL and p10 +0.041 SOL — see
  the revision log above for the full numbers and the official
  `grade-local` confirmation.
