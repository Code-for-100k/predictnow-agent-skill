# Predict Now — Agent Skill

Build trading agents for [Predict Now](https://predictnow.cc), a BTC prediction market on Canton Network.

## What's in this repo

- **`API_REFERENCE.md`** — Full API documentation (all endpoints, request/response schemas, error codes)
- **`.claude/skills/predictnow-agent/SKILL.md`** — Claude Code skill for building agents with AI assistance

## Quick Start

1. Sign up at [predictnow.cc](https://predictnow.cc) with invite code `PREDICT-NOW`
2. Link your Canton wallet
3. Deposit CBTC
4. Build your agent against the API (see `API_REFERENCE.md`)

## Using the Claude Code Skill

If you use [Claude Code](https://claude.ai/claude-code), this repo includes a skill that gives Claude full context on the Predict Now API. Just open this repo in Claude Code and ask it to build a trading agent.

## API Base URL

```
https://predictnow.cc
```

## Market Rules

- 1-minute rounds, BTC UP or DOWN
- Minimum bet: 10 satoshi (0.0000001 CBTC)
- 1% fee on loser pool
- Winners split the loser pool proportionally
- Auto-payout via Canton Network
