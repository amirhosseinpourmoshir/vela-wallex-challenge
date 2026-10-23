# Local spot execution

Challenge policy: spot only, no leverage or naked shorts. The organizer denylist contains 345 exact pairs in `config/challenge-markets.js`; package restrictions and local restrictions are additional. The current interface retains the requested TMN quote universe. Existing history and rejected orders are preserved.

To use the local engine, select immediate mode, enable best-market selection, choose the local watcher, and start a new explicitly authorized session. Existing sessions are not converted automatically.

`local-multiframe-v1` evaluates closed minute signals plus 5m/15m/hour context, volume participation, adverse evidence, spread, exact net stop/target economics, per-asset exposure and risk-based sizing. It ranks viable candidates deterministically and tries quote validation before choosing. Structural sells are limited to acquired session holdings. The local path does not call the LLM and records zero tokens, inputs, version, reasons and rankings.

Local orders use LIMIT at the fresh ask for buys / bid for sells. Native MARKET requests are also routed to LIMIT before submission when Wallex reports `isMarketTypeEnable=false`. A LIMIT can remain partially or entirely unfilled. In an active automatic session its remainder is cancelled after 120 seconds; partial fills are retained and remain eligible for stop/target monitoring. Stopping the session does not cancel or close exchange orders. Server stop/target monitoring requires an active server and session.

Signals are reviewed at most once per minute. Closed-candle confirmation, execution costs, allocation and session authority remain binding; ranking alone never creates an obligation to trade. ATR-based targets are projections, not observed resistance or promised returns. This algorithm has not been validated as the best or profitable in live markets.
