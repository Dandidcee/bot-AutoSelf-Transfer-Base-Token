# Self Transfer Bot - Base Network

Bot Node.js untuk self-transfer token ERC-20 di jaringan ETH Base (multi-wallet).

## Setup

```bash
npm install
```

Buat file `.env` (lihat contoh di `.env.example`):

```env
PRIVATE_KEYS=key1,key2,key3
TOKEN_ADDRESS=0x53cd9Bf2bE680bf7192A2317f95BA8716ee49B07
AMOUNT=1
REPEAT_COUNT=5
DELAY_BETWEEN_TX_MS=1000
DELAY_BETWEEN_WALLETS_MS=1000
TEST_MODE=true
TEST_TIME=22:20
```

## Jalankan

```bash
node index.js
```

- `TEST_MODE=true` → jadwalkan di `TEST_TIME` (untuk testing)
- `TEST_MODE=false` → jadwalkan di **00:00 WIB** (produksi)
