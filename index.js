require("dotenv").config();
const { ethers } = require("ethers");

const RPC_URL                  = process.env.RPC_URL || "https://mainnet.base.org";
const RAW_KEYS                 = process.env.PRIVATE_KEYS || "";
const TOKEN_ADDR               = process.env.TOKEN_ADDRESS;
const AMOUNT                   = process.env.AMOUNT || "1";
const REPEAT_COUNT             = parseInt(process.env.REPEAT_COUNT) || 1;
const DELAY_BETWEEN_WALLETS_MS = parseInt(process.env.DELAY_BETWEEN_WALLETS_MS) || 1000;
const DELAY_BETWEEN_ROUNDS_MS  = parseInt(process.env.DELAY_BETWEEN_TX_MS) || 1000;

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function now() {
  return new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
}

function shortAddr(addr) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function divider(char = "─", len = 55) {
  return char.repeat(len);
}

function getMsUntilTargetWIB(timeStr) {
  const [h, m]    = timeStr.split(":").map(Number);
  const nowUtc    = new Date();
  const wibOffset = 7 * 60 * 60 * 1000;
  const nowWib    = new Date(nowUtc.getTime() + wibOffset);
  const target    = new Date(nowWib);
  target.setUTCHours(h, m, 0, 0);
  if (nowWib >= target) target.setUTCDate(target.getUTCDate() + 1);
  return target.getTime() - nowWib.getTime();
}

function liveCountdown(msLeft) {
  return new Promise((resolve) => {
    let remaining = Math.floor(msLeft / 1000);
    const tick = () => {
      const hh = String(Math.floor(remaining / 3600)).padStart(2, "0");
      const mm = String(Math.floor((remaining % 3600) / 60)).padStart(2, "0");
      const ss = String(remaining % 60).padStart(2, "0");
      process.stdout.write(`\r   ⏳ Menunggu : ${hh}j ${mm}m ${ss}d  |  ${now()}   `);
    };
    tick();
    const timer = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(timer);
        process.stdout.write("\n");
        resolve();
      } else {
        tick();
      }
    }, 1000);
  });
}

async function sendTx(contract, address, amountWei, nonce) {
  // estimateGas tanpa nonce (hanya untuk simulasi)
  let gasLimit = 100000n;
  try {
    const est = await contract.transfer.estimateGas(address, amountWei);
    gasLimit  = (est * 130n) / 100n;
  } catch {
    // pakai fallback gasLimit 100000
  }

  const tx      = await contract.transfer(address, amountWei, { gasLimit, nonce });
  const receipt = await tx.wait();
  return { tx, receipt };
}

async function runBot() {
  const privateKeys = RAW_KEYS.split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0 && !k.startsWith("ISI_"));

  if (privateKeys.length === 0) {
    console.error("❌ PRIVATE_KEYS kosong di .env!");
    process.exit(1);
  }

  if (!TOKEN_ADDR) {
    console.error("❌ TOKEN_ADDRESS kosong di .env!");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);

  // Setup wallet & contract per key
  const wallets = privateKeys.map((key) => {
    const w = new ethers.Wallet(key, provider);
    const c = new ethers.Contract(TOKEN_ADDR, ERC20_ABI, w);
    return { address: w.address, contract: c };
  });

  // Info token (dari wallet pertama)
  const infoContract = new ethers.Contract(TOKEN_ADDR, ERC20_ABI, provider);
  const [tokenName, symbol, decimals] = await Promise.all([
    infoContract.name(),
    infoContract.symbol(),
    infoContract.decimals(),
  ]);
  const amountWei = ethers.parseUnits(AMOUNT, decimals);

  // Header
  console.log("\n" + divider("═"));
  console.log("   SELF TRANSFER BOT  |  BASE NETWORK  |  MULTI WALLET");
  console.log(divider("═"));
  console.log(`🕐 Waktu       : ${now()}`);
  console.log(`🪙 Token       : ${tokenName} (${symbol})`);
  console.log(`📄 Kontrak     : ${TOKEN_ADDR}`);
  console.log(`💸 Per TX      : ${AMOUNT} ${symbol}`);
  console.log(`🔁 Repeat      : ${REPEAT_COUNT}x`);
  console.log(`👛 Wallet      : ${wallets.length}`);
  console.log(divider("─"));

  // Tampilkan saldo awal
  for (const w of wallets) {
    try {
      const bal = await infoContract.balanceOf(w.address);
      const eth = await provider.getBalance(w.address);
      console.log(`   ${shortAddr(w.address)}  💰 ${ethers.formatUnits(bal, decimals)} ${symbol}  ⛽ ${parseFloat(ethers.formatEther(eth)).toFixed(5)} ETH`);
    } catch {
      console.log(`   ${shortAddr(w.address)}  (gagal baca saldo)`);
    }
    await sleep(300); // jeda kecil antar RPC call
  }
  console.log(divider("═") + "\n");

  // Nonce per wallet
  const nonces = {};
  for (const w of wallets) {
    nonces[w.address] = await provider.getTransactionCount(w.address, "pending");
    await sleep(200);
  }

  let totalOk = 0, totalFail = 0;

  // Ronde
  for (let round = 1; round <= REPEAT_COUNT; round++) {
    console.log(`${divider("─")}`);
    console.log(`🔄 Ronde ${round}/${REPEAT_COUNT}  |  ${now()}`);
    console.log(divider("─"));

    for (let wi = 0; wi < wallets.length; wi++) {
      const { address, contract } = wallets[wi];
      const nonce = nonces[address];

      process.stdout.write(`   [W${wi + 1}] ${shortAddr(address)} mengirim ${AMOUNT} ${symbol}... `);

      try {
        const { tx, receipt } = await sendTx(contract, address, amountWei, nonce);
        nonces[address]++;

        if (receipt.status === 1) {
          console.log(`✅ Block ${receipt.blockNumber} | ${tx.hash.slice(0, 16)}...`);
          totalOk++;
        } else {
          console.log(`❌ Reverted`);
          totalFail++;
        }
      } catch (err) {
        const msg = err.reason || err.shortMessage || err.message || "unknown error";
        console.log(`❌ ${msg}`);
        totalFail++;
      }

      if (wi < wallets.length - 1) await sleep(DELAY_BETWEEN_WALLETS_MS);
    }

    if (round < REPEAT_COUNT) await sleep(DELAY_BETWEEN_ROUNDS_MS);
  }

  console.log(`\n${divider("═")}`);
  console.log(`📊 RINGKASAN AKHIR`);
  console.log(`   👛 Wallet      : ${wallets.length}`);
  console.log(`   🔁 Ronde       : ${REPEAT_COUNT}`);
  console.log(`   ✅ TX Berhasil : ${totalOk} / ${REPEAT_COUNT * wallets.length}`);
  console.log(`   ❌ TX Gagal    : ${totalFail}`);
  console.log(`   🕐 Selesai     : ${now()}`);
  console.log(divider("═"));
}

async function main() {
  const msLeft = getMsUntilTargetWIB("00:00");

  console.log(divider("═"));
  console.log("   SELF TRANSFER BOT  |  MODE TERJADWAL");
  console.log(divider("═"));
  console.log(`🕐 Sekarang    : ${now()}`);
  console.log(`🎯 Eksekusi    : 00:00:00 WIB`);
  console.log(divider("═"));
  console.log("   Bot standby... (Ctrl+C untuk batal)\n");

  await liveCountdown(msLeft);

  console.log(`\n🚀 Waktunya! ${now()} — Menjalankan bot...`);
  await runBot();
}

main().catch((err) => {
  console.error("❌ Fatal:", err.message);
  process.exit(1);
});
