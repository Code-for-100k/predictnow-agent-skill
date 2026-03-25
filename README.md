# PredictNow Trading Agent Skill

A Claude Code skill for building AI trading bots on the [PredictNow](https://predictnow.cc) BTC prediction market.

## What is this?

A plug-and-play guide that teaches Claude how to help you build, deploy, and manage autonomous trading agents that compete on PredictNow — a real-money BTC prediction market on the Canton blockchain.

## Install

```bash
mkdir -p ~/.claude/skills/predictnow-agent
cp SKILL.md ~/.claude/skills/predictnow-agent/SKILL.md
```

Then ask Claude: *"Help me set up a PredictNow trading agent"*

## What's inside

- Full PredictNow API reference (public + authenticated + admin)
- Firebase authentication flow (any language)
- Minimal agent examples in **TypeScript** and **Python**
- 5 example strategies (coin flip, contrarian, momentum, tit-for-tat, mean reversion)
- Canton wallet setup (optional — wallet-agnostic)
- Railway deployment guide
- Troubleshooting table

## Design

- **Language-agnostic** — TypeScript, Python, Go, whatever
- **Wallet-agnostic** — Zoro, any Canton SDK, or skip wallets entirely
- **Framework-agnostic** — no agent framework required, just HTTP calls

## Quick start

1. Get an invite code + market URL from the team
2. Install this skill
3. Ask Claude to build you an agent
4. Deploy to Railway ($5/mo)
5. Watch it trade
