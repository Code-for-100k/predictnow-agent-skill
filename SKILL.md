---
name: predictnow-trading-agent
description: "Complete guide for building AI trading bots on the PredictNow BTC prediction market. Language-agnostic, wallet-agnostic, framework-agnostic. Covers: PredictNow API, Firebase auth, writing strategies, deploying agents, funding with CBTC. Use when: setting up a trading bot, creating a prediction market agent, deploying to PredictNow, writing a trading strategy, connecting to Canton for trading, agentic trading."
---

# PredictNow AI Trading Agent — Build Guide

Build autonomous trading bots on the PredictNow BTC prediction market. Bet UP or DOWN on BTC price each round. Compete against other agents with real CBTC on the Canton blockchain.

**This guide is:**
- **Language-agnostic** — use TypeScript, Python, Go, Rust, or any language with HTTP + Ed25519
- **Wallet-agnostic** — use Zoro, any Canton SDK, or skip wallets entirely for testing
- **Framework-agnostic** — no required agent framework; just call the API

---

## How It Works

```
1. Agent signs into PredictNow (Firebase email/password → ID token)
2. Agent polls market status every N seconds
3. When a round is active, agent decides UP or DOWN
4. Agent places a bet via POST /api/predict
5. Round settles → winners split the losers' pool proportionally
6. Repeat
```

**Payout formula (fee = 0%):**
```
payout = your_bet + (your_bet / winner_pool) * loser_pool
```
If everyone bet the same direction → bets refunded (no losers).

---

## Part 1: PredictNow API

This is the only thing your agent MUST interact with. Everything else is optional.

### Base URL

Get the current market URL from the team. Examples:
- Production: `https://predictnow.cc`
- Direct: `https://btc-prediction-market-production.up.railway.app`

### 1.1 Public Endpoints (no auth needed)

**GET /api/btc-price**
```json
// Response:
{ "price": 71250.50, "change_24h": 0.48, "last_updated": 1774431677513 }
```
Note: field may be `change_24h` or `change24h` depending on server version. Handle both.

**GET /api/market/status**
```json
// Active round:
{
  "status": "active",
  "round_number": 2756,
  "open_price": 71227.55,
  "window_start_ms": 1774431509439,
  "window_end_ms": 1774431569439,
  "time_remaining_ms": 24527,
  "up_predictions": 2,
  "down_predictions": 1,
  "up_amount": 0.00002,
  "down_amount": 0.00001,
  "fee_percentage": 0
}

// Between rounds:
{ "status": "no_active_round", "next_round": 2757, "next_start_time": 1774431600000 }
```

**GET /api/results/history?limit=20**
```json
{
  "rounds": [
    {
      "round_number": 2755,
      "open_price": 71200.00,
      "close_price": 71250.50,
      "winning_direction": "UP",
      "total_up_amount": 0.00003,
      "total_down_amount": 0.00001,
      "fee_collected": 0,
      "window_start_time": 1774431400000,
      "window_end_time": 1774431460000
    }
  ],
  "total": 2755
}
```

**GET /api/results/:roundNumber** — single round detail

**GET /api/pool-info** — pool wallet address + fee percentage

**GET /api/firebase-config** — public Firebase web config (apiKey, authDomain, projectId)

### 1.2 Authenticated Endpoints

All require header: `Authorization: Bearer <FIREBASE_ID_TOKEN>`

**POST /api/auth/verify** — register or verify account
```json
// Request (new user):
{ "invite_code": "INST-ALPHA" }

// Response:
{ "uid": "abc123", "email": "agent@example.com", "tier": "institutional", "pool_wallet_id": "inst-1" }
```
Invite codes determine which pool your bets settle against:
- Retail codes → retail pool
- Institutional codes (INST-ALPHA, INST-BRAVO, INST-CHARLIE) → institutional pools
- Existing users skip invite code validation

**POST /api/auth/link-party** — link a Canton wallet
```json
// Request:
{ "party_id": "abc123def::1220..." }
// Canton format: contains "::", 20-300 chars
```
Each wallet can only be linked to one account.

**POST /api/auth/set-active-wallet** — switch active wallet
```json
{ "party_id": "abc123def::1220..." }
```

**POST /api/predict** — place a bet
```json
// Request:
{ "direction": "UP", "amount": 0.00001 }

// Response:
{
  "prediction_id": 42,
  "market_round": 2756,
  "direction": "UP",
  "amount": 0.00001,
  "party_id": "abc123def::1220...",
  "remaining_balance": 0.00005
}
```

**GET /api/balance** — your internal CBTC balance
```json
{
  "balance": 0.00006,
  "total_deposited": 0.0001,
  "total_withdrawn": 0,
  "total_won": 0.00002,
  "total_lost": 0.00004
}
```

**GET /api/bets** — your bet history
```json
[
  { "round_number": 2755, "direction": "UP", "amount": 0.00001, "status": "won", "settled": true },
  { "round_number": 2754, "direction": "DOWN", "amount": 0.00001, "status": "lost", "settled": true }
]
```

**POST /api/deposit** — trigger deposit detection (scans Canton for incoming CBTC)

**POST /api/withdraw** — withdraw CBTC to your Canton wallet
```json
{ "amount": 0.00005 }
```

### 1.3 Admin Endpoints

Require header: `X-Admin-Secret: <ADMIN_SECRET>`

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/admin/user?email=...` | GET | View user account data |
| `/admin/credit` | POST | Credit balance: `{ email, amount, reason }` |
| `/admin/delete-user` | POST | Delete user: `{ email }` |
| `/admin/invite-codes` | POST | Generate invite codes: `{ tier, count }` |
| `/admin/invite-codes` | GET | List invite codes |
| `/admin/db-summary` | GET | Database overview |
| `/admin/retry-payout` | POST | Retry failed payout |
| `/admin/approve-withdrawal` | POST | Override anti-fraud block |

### 1.4 Constraints

| Constraint | Value |
|------------|-------|
| Min bet | 0.0000001 CBTC (10 satoshis) |
| Max bet | 21,000,000 CBTC |
| Rate limit | 5 predictions per user per round |
| Rate limit cooldown | 15 minutes |
| Fee | 0% (no platform fee) |
| Party ID format | Contains `::`, 20-300 chars |
| Withdrawal anti-fraud | Blocked if withdrawn > deposited |

### 1.5 Circuit Breaker

The platform monitors on-chain gas costs vs. Canton network rewards. When gas costs exceed reward income, the circuit breaker trips:

- **Auto-payouts pause** — winnings are credited to the internal ledger but not sent on-chain
- **Server-side agents stop** — built-in trading agents are paused
- **Manual withdrawals still work** — `POST /api/withdraw` always works
- **Auto-recovers** — resets automatically when margins improve

**Check circuit breaker state** (poll every 30s, pause trading if tripped):

```javascript
const rewards = await fetch("https://predictnow.cc/api/rewards", {
  headers: { "x-rewards-key": REWARDS_KEY },
}).then(r => r.json());

if (rewards.circuit_breaker.tripped) {
  console.log("Circuit breaker active — auto-payouts paused");
  // Winnings are safe in internal ledger. Use POST /api/withdraw to claim.
}
```

The `circuit_breaker` object in the rewards response:
```json
{
  "tripped": false,
  "tripped_at": null,
  "reason": "",
  "avg_reward": 3.45,
  "avg_gas": 2.86,
  "net_margin": 0.59
}
```

See `examples/` directory for a complete agent implementation with circuit breaker handling.

---

## Part 2: Authentication

Your agent needs a Firebase account. This works from any language.

### 2.1 Create Account

```
POST https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=<FIREBASE_WEB_API_KEY>
Content-Type: application/json

{ "email": "my-agent@example.com", "password": "SecurePass123!", "returnSecureToken": true }

→ { "idToken": "eyJ...", "localId": "uid123", "refreshToken": "AEu4..." }
```

Get `FIREBASE_WEB_API_KEY` from `GET /api/firebase-config` on the market server.

### 2.2 Sign In (returning user)

```
POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<KEY>
Content-Type: application/json

{ "email": "my-agent@example.com", "password": "SecurePass123!", "returnSecureToken": true }

→ { "idToken": "eyJ...", "refreshToken": "AEu4...", "expiresIn": "3600" }
```

### 2.3 Refresh Token (before expiry)

Tokens expire after 1 hour. Refresh before they expire:

```
POST https://securetoken.googleapis.com/v1/token?key=<KEY>
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&refresh_token=<REFRESH_TOKEN>

→ { "id_token": "eyJ...", "refresh_token": "AEu4...", "expires_in": "3600" }
```

### 2.4 Use Token

All authenticated PredictNow API calls:
```
Authorization: Bearer <ID_TOKEN>
```

---

## Part 3: Account Setup

One-time setup per agent:

```bash
# 1. Get Firebase config
curl <MARKET_URL>/api/firebase-config
# → { "apiKey": "AIza...", "authDomain": "...", "projectId": "..." }

# 2. Create Firebase account
curl -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=<API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"email":"my-agent@example.com","password":"SecurePass123!","returnSecureToken":true}'
# → save idToken

# 3. Verify with invite code
curl -X POST "<MARKET_URL>/api/auth/verify" \
  -H "Authorization: Bearer <ID_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"invite_code":"<CODE>"}'

# 4. Link Canton wallet (if you have one)
curl -X POST "<MARKET_URL>/api/auth/link-party" \
  -H "Authorization: Bearer <ID_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"party_id":"<CANTON_PARTY_ID>"}'

# 5. Fund balance (ask admin or deposit CBTC)
curl -X POST "<MARKET_URL>/admin/credit" \
  -H "X-Admin-Secret: <SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"email":"my-agent@example.com","amount":0.0001,"reason":"initial funding"}'
```

---

## Part 4: The Minimal Agent

The smallest possible trading agent. Works in any language.

### Pseudocode

```
token = firebase_sign_in(email, password)
last_bet_round = 0

loop forever:
  if token_expired(): token = refresh_token()

  status = GET /api/market/status
  if status.status != "active": sleep(10); continue
  if status.round_number == last_bet_round: sleep(10); continue

  direction = my_strategy(status)

  response = POST /api/predict { direction, amount: 0.00001 }
    with Authorization: Bearer <token>

  last_bet_round = status.round_number  # even on failure — avoid rate limit burn
  sleep(30)
```

### TypeScript Example

```typescript
const MARKET = process.env.MARKET_URL!;
const FIREBASE_KEY = process.env.FIREBASE_API_KEY!;
const EMAIL = process.env.AGENT_EMAIL!;
const PASSWORD = process.env.AGENT_PASSWORD!;

let token = "";
let refreshToken = "";
let tokenExpiry = 0;
let lastRound = 0;

async function auth() {
  const endpoint = refreshToken
    ? `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_KEY}`
    : `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_KEY}`;
  const body = refreshToken
    ? `grant_type=refresh_token&refresh_token=${refreshToken}`
    : JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true });
  const headers: Record<string, string> = refreshToken
    ? { "Content-Type": "application/x-www-form-urlencoded" }
    : { "Content-Type": "application/json" };

  const res = await fetch(endpoint, { method: "POST", headers, body });
  const data = await res.json() as any;
  token = data.idToken || data.id_token;
  refreshToken = data.refreshToken || data.refresh_token;
  tokenExpiry = Date.now() + parseInt(data.expiresIn || data.expires_in || "3600") * 1000;
}

async function tick() {
  if (Date.now() > tokenExpiry - 60000) await auth();

  const status = await fetch(`${MARKET}/api/market/status`).then(r => r.json()) as any;
  if (status.status !== "active" || status.round_number === lastRound) return;

  // YOUR STRATEGY HERE
  const direction = Math.random() < 0.5 ? "UP" : "DOWN";

  try {
    const res = await fetch(`${MARKET}/api/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ direction, amount: 0.00001 }),
    });
    const data = await res.json() as any;
    console.log(`Round ${status.round_number}: ${direction} → ${res.ok ? "OK" : data.error}`);
  } catch (e) {
    console.error("Bet failed:", e);
  }
  lastRound = status.round_number;
}

await auth();
while (true) { await tick(); await new Promise(r => setTimeout(r, 30000)); }
```

### Python Example

```python
import requests, time, os, random

MARKET = os.environ["MARKET_URL"]
FIREBASE_KEY = os.environ["FIREBASE_API_KEY"]
EMAIL = os.environ["AGENT_EMAIL"]
PASSWORD = os.environ["AGENT_PASSWORD"]

token = refresh_token = ""
token_expiry = 0
last_round = 0

def auth():
    global token, refresh_token, token_expiry
    if refresh_token:
        r = requests.post(f"https://securetoken.googleapis.com/v1/token?key={FIREBASE_KEY}",
            data=f"grant_type=refresh_token&refresh_token={refresh_token}",
            headers={"Content-Type": "application/x-www-form-urlencoded"})
        d = r.json()
        token, refresh_token = d["id_token"], d["refresh_token"]
    else:
        r = requests.post(f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={FIREBASE_KEY}",
            json={"email": EMAIL, "password": PASSWORD, "returnSecureToken": True})
        d = r.json()
        token, refresh_token = d["idToken"], d["refreshToken"]
    token_expiry = time.time() + int(d.get("expiresIn", d.get("expires_in", 3600)))

def tick():
    global last_round
    if time.time() > token_expiry - 60: auth()

    status = requests.get(f"{MARKET}/api/market/status").json()
    if status["status"] != "active" or status.get("round_number") == last_round: return

    direction = random.choice(["UP", "DOWN"])  # YOUR STRATEGY HERE

    r = requests.post(f"{MARKET}/api/predict",
        json={"direction": direction, "amount": 0.00001},
        headers={"Authorization": f"Bearer {token}"})
    print(f"Round {status['round_number']}: {direction} → {'OK' if r.ok else r.json().get('error')}")
    last_round = status.get("round_number", last_round)

auth()
while True:
    try: tick()
    except Exception as e: print(f"Error: {e}")
    time.sleep(30)
```

---

## Part 5: Writing Strategies

A strategy takes market data and returns a direction. How complex you make it is up to you.

### Data Available to Your Strategy

From `GET /api/market/status`:
- `up_amount`, `down_amount` — how much is bet on each side THIS round
- `round_number` — which round we're in
- `time_remaining_ms` — time left to bet

From `GET /api/btc-price`:
- `price` — current BTC price
- `change_24h` — 24h price change %

From `GET /api/results/history`:
- Last N rounds — `winning_direction`, `open_price`, `close_price`, pool sizes

From `GET /api/bets`:
- Your past bets — direction, amount, won/lost

### Example Strategies

**Coin Flip** (baseline — 50/50 random):
```
direction = random(UP, DOWN)
```

**Contrarian** (bet against the crowd):
```
if up_amount > down_amount → bet DOWN
if down_amount > up_amount → bet UP
else → default DOWN
```
Logic: when the crowd piles on one side, the payout ratio for the other side is better.

**Tit-for-Tat** (mirror what worked):
```
if my_last_bet won → repeat same direction
if my_last_bet lost → switch direction
if no history → follow price trend
```

**Mean Reversion** (bet against streaks):
```
if last 3 rounds all UP → bet DOWN
if last 3 rounds all DOWN → bet UP
else → follow price trend
```

**Momentum** (ride the trend):
```
if last 3 rounds all UP → bet UP (trend continues)
if last 3 rounds all DOWN → bet DOWN
else → follow 24h price change
```

### Strategy Tips
- Start with minimum bets (0.00001 CBTC) until your strategy proves profitable
- Track your win rate — if below 50%, the strategy is losing money to fees
- The contrarian strategy works best when other agents herd on one side
- History is your friend — `GET /api/results/history?limit=50` gives you patterns

---

## Part 6: Canton Wallet (Optional)

You only need a Canton wallet if you want to:
- Deposit real CBTC on-chain
- Withdraw winnings to your wallet
- Trade with real blockchain settlement

**For testing, skip this entirely** — use the admin credit endpoint to fund balances.

### What you need from ANY Canton wallet provider:

1. **A party ID** — string format `prefix::hash` (20-300 chars)
2. **Ed25519 key pair** — for signing transactions
3. **Transfer pre-approval** — so incoming CBTC auto-accepts
4. **CC (Amulet) balance** — for gas fees (~3 CC per CBTC transfer)

### Canton Transaction Model (universal)

All Canton providers follow prepare → sign → broadcast:

```
1. POST /prepare/<action>
   → { commandId, command: { preparedTransactionHash } }

2. Ed25519-sign the preparedTransactionHash with your private key
   → base64 signature

3. POST /broadcast
   { signature, publicKey, preparedTransaction: { commandId, command }, partyId }
   → { status, transactionId }
```

### Ed25519 Signing (any language)

**TypeScript** (`@noble/ed25519`):
```typescript
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
ed.etc.sha512Sync = sha512;

function signHash(hashBase64: string, privateKeyBase64: string): string {
  const hash = Buffer.from(hashBase64, "base64");
  const key = Buffer.from(privateKeyBase64, "base64");
  return Buffer.from(ed.sign(hash, key)).toString("base64");
}
```

**Python** (`pynacl`):
```python
import nacl.signing, base64

def sign_hash(hash_b64: str, private_key_b64: str) -> str:
    key = nacl.signing.SigningKey(base64.b64decode(private_key_b64))
    signed = key.sign(base64.b64decode(hash_b64))
    return base64.b64encode(signed.signature).decode()
```

### Wallet Setup Checklist (if using wallets)

1. Generate Ed25519 key pair
2. Onboard party via your Canton provider
3. Set up merge delegation (UTXO management)
4. Enable transfer pre-approval for CC (Amulet) instrument
5. Enable transfer pre-approval for CBTC instrument
6. Fund with CC gas (at least 10 CC)
7. Link party ID to your PredictNow account via `POST /api/auth/link-party`

### Deposit Flow

```
You send CBTC to your agent's Canton wallet
  → auto-accepted (if pre-approval enabled)
  → agent calls POST /api/deposit (authenticated)
  → market server detects incoming CBTC, credits internal balance
  → agent can now bet with that CBTC
```

### Gotchas
- CBTC transfers cost ~3.02 CC in gas (from your CC balance, not CBTC)
- Use full ISO timestamp for expiry: `new Date(Date.now() + 4*3600000).toISOString()`
- Date-only format (`2026-03-26`) causes "lock expires before amulet" errors
- Fresh wallets need CC before they can accept any transfers
- Transfer pre-approval only auto-accepts NEW transfers (not already-pending ones)
- Wait 3s between Canton transactions (0.5 TPS rate limit)

---

## Part 7: Deployment

Your agent needs to run 24/7. Options:

### Railway (recommended)
```bash
# Install CLI
npm install -g @railway/cli && railway login

# Create project
cd my-agent && railway init --name "my-agent"

# Set env vars
railway variable set MARKET_URL="<URL>" FIREBASE_API_KEY="<KEY>" \
  AGENT_EMAIL="agent@example.com" AGENT_PASSWORD="SecurePass!"

# Deploy
railway up --detach

# Monitor
railway service logs -n 30
railway service status
```

**Railway tips:**
- Hobby plan: $5/month, auto-restart on crash
- `railway up` deploys from current directory (no git needed)
- Env var changes auto-redeploy
- Use `railway service redeploy --yes` to restart

### Other options
- **Any VPS** (DigitalOcean, Linode, etc.) — run with `pm2` or `systemd`
- **Docker** — containerize your agent
- **Cloud Functions** — use a cron trigger (but harder to maintain state)
- **Your laptop** — fine for testing, not for 24/7

### Env Vars Your Agent Needs

```bash
# Required
MARKET_URL=<predict_now_url>
FIREBASE_API_KEY=<firebase_web_api_key>
AGENT_EMAIL=<agent_email>
AGENT_PASSWORD=<agent_password>

# Optional
POLL_MS=30000                    # polling interval (default 30s)
PARTY_ID=<canton_party_id>      # if using on-chain deposits/withdrawals
```

---

## Part 8: Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `Invalid amount` | Balance below min bet or bad amount | Fund agent, check min is 0.00001 |
| `Rate limit exceeded` | >5 bets per round | Don't retry on same round — track `lastBetRound` |
| `No active market round` | Between rounds | Normal — wait and retry |
| `Unauthorized` | Token expired or missing | Refresh Firebase token |
| `Invite code required` | New account, no code | Include invite_code in verify call |
| `Canton wallet already linked` | Wallet linked to another account | Delete old account via admin, then re-link |
| `Insufficient balance` | Not enough CBTC | Deposit or admin-credit more |
| `Withdrawal blocked` | Anti-fraud: withdrawn > deposited | Ask admin to approve |

---

## Quick Start Checklist

- [ ] Get invite code and market URL from the team
- [ ] Get Firebase API key: `GET <MARKET_URL>/api/firebase-config`
- [ ] Create Firebase account (sign up API)
- [ ] Verify with invite code (`POST /api/auth/verify`)
- [ ] Get funded (admin credit or on-chain deposit)
- [ ] Write your strategy (start with coin flip)
- [ ] Run locally: test against the market
- [ ] Deploy to Railway (or any host)
- [ ] Monitor performance via logs + API
- [ ] Iterate on your strategy
