# Pump.fun Replay Sprint — Paper Bot, Real Ranking

[![make.fun](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122.svg)](https://make.fun/c/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![Rank](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/JohnyKucel/pump-fun-replay-sprint-20261125/rank.svg)](https://make.fun/c/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![Reward](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/JohnyKucel/pump-fun-replay-sprint-20261125/reward.svg)](https://make.fun/c/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)

A momentum paper-trading bot for the [Pump.fun Replay Sprint](https://make.fun/c/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122) bounty on make.fun. It trades 10 SOL of paper money on a 24-hour replay of pump.fun bonding-curve activity under the `agent-fun/replay/v2` protocol. Free to enter, paper money only.

## Strategy

Momentum with fast exits. Per curve the bot tracks price (virtual quote reserves / virtual token reserves) and net buy flow over a short rolling window measured in slots. It buys when the price has risen off its recent low while net buying is still arriving and several distinct wallets are buying, then exits on take-profit, stop-loss, a trailing exit once in profit, or a hard time exit. One small stake per coin keeps it broad enough to clear the 20-coin round-trip bar. See [DESIGN.md](DESIGN.md) for the parameters and tuning results.

## Files

- `main.ts` — entrypoint, run by the grader as `node /bot/main.ts` (Node 22, no dependencies, no network).
- `strategy.ts` — the strategy: entry/exit rules, per-mint books, deterministic order decisions.
- `vendor/makefun-bot.ts` — byte-identical copy of the kit's `sdk/ts/makefun-bot.ts` shim (the hello / batch / orders wire protocol).
- `tools/` — local offline replay harness (`sim.ts`, adapted from the kit's pilot tooling) plus `backtest.ts` and `sweep.ts` for parameter tuning. Not used by the bot.

## Local backtest

```sh
node tools/backtest.ts <kit dir>
node tools/sweep.ts <kit dir> '{}' '{"takeProfitBps":[1200,1800,2500]}' 10
```

## License

MIT — see [LICENSE](LICENSE).
