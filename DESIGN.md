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
| minRiseBps / maxRiseBps | 800 / 40000 | price rise off the window low, in bps |
| minBreakoutBps / maxBreakoutBps | 300 / 15000 | price above creation price, in bps |
| minNetSolLamports | 100,000,000 | net buy SOL over the window (0.10 SOL) |
| minBuys / minBuyers | 3 / 2 | buy trades / distinct buying wallets in the window |
| minRealSol / maxRealSol | 1.5 / 80 SOL | real SOL reserve bounds at entry |
| minAgeSlots / maxAgeSlots | 0 / 3000 | age since CreateEvent for a first entry |
| stakeLamports | 50,000,000 | 0.05 SOL per position |
| takeProfitBps | 3000 | +30% over average cost |
| stopLossBps | 1500 | −15% under average cost |
| trailBps / trailArmBps | 2000 / 1000 | sell 20% below peak once +10% in profit |
| maxHoldSlots | 600 | hard time exit |
| cooldownSlots | 300 | wait after an exit before re-entering a coin |
| maxEntriesPerCoin | 1 | one shot per coin |
| buySlippageBps / sellSlippageBps | 1000 / 10000 | sells go out wide so exits always fill |

## Determinism

No clock, no environment reads, no `Math.random`. Randomness, if ever needed,
would come only from `hello.seed`. Order decisions depend only on the batches
the harness delivered, in delivery order, so two runs over the same data reply
with byte-identical orders. Logs go to stderr only; stdout carries replies.

## Tuning (local replay harness, `tools/sim.ts`, full dev window)

- v1 (rise-only trigger, TP +25% / SL −12% / hold 1200): −0.32 SOL, 55 coins.
- v2 (fills of any outcome clear pending flags; near-high + live-flow filters):
  −1.20 SOL, 303 coins — the pending fix exposed over-trading, not an edge.
- v3 (breakout-from-create trigger, TP +30% / SL −15% / hold 600): −1.13 SOL,
  363 coins, 90 wins.
- Parameter sweep (TP × SL × trail × arm × hold × breakout, mean over 4
  failed-tx keys): best setting TBD — see tuning log in the repo history.

## Guardrails (competition)

- Round trip ≥ 0.01 SOL on ≥ 20 distinct coins: stake 0.05 SOL, one entry per
  coin, hundreds of coins traded on the dev window.
- Max drawdown ≤ 50%: local runs stay well under (worst seen ~13%).
- Net PnL > 0 SOL after all fees is required for a paid place; the dev-window
  result above is the honest local number and the final window is a fresh
  24 h of data, so the ranking there is what counts.
