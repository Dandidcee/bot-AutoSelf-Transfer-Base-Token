require("dotenv").config();
const { ethers } = require("ethers");

const RPC_URL                  = process.env.RPC_URL || "https://mainnet.base.org";
const RAW_KEYS                 = process.env.PRIVATE_KEYS || "";
const TOKEN_ADDR               = process.env.TOKEN_ADDRESS || "0x53cd9Bf2bE680bf7192A2317f95BA8716ee49B07";
const AMOUNT                   = process.env.AMOUNT || "1";
const REPEAT_COUNT             = parseInt(process.env.REPEAT_COUNT) || 1;
const DELAY_BETWEEN_TX_MS      = parseInt(process.env.DELAY_BETWEEN_TX_MS) || 1000;
const DELAY_BETWEEN_WALLETS_MS = parseInt(process.env.DELAY_BETWEEN_WALLETS_MS) || 1000;
const TEST_MODE                = process.env.TEST_MODE === "true";
const TEST_TIME                = process.env.TEST_TIME || "22:20";

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function now() {
  return new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
}

function shortAddr(addr) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function divider(char = "─", len = 55) {
  return char.repeat(len);
}

function getMsUntilMidnightWIB() {
  const nowUtc    = new Date();
  const wibOffset = 7 * 60 * 60 * 1000;
  const nowWib    = new Date(nowUtc.getTime() + wibOffset);

  const nextMidnight = new Date(nowWib);
  nextMidnight.setUTCHours(0, 0, 0, 0);
  if (nowWib >= nextMidnight) {
    nextMidnight.setUTCDate(nextMidnight.getUTCDate() + 1);
  }

  return nextMidnight.getTime() - nowWib.getTime();
}

function getMsUntilTargetWIB(timeStr) {
  const [targetH, targetM] = timeStr.split(":").map(Number);
  const nowUtc    = new Date();
  const wibOffset = 7 * 60 * 60 * 1000;
  const nowWib    = new Date(nowUtc.getTime() + wibOffset);

  const target = new Date(nowWib);
  target.setUTCHours(targetH, targetM, 0, 0);
  if (nowWib >= target) {
    target.setUTCDate(target.getUTCDate() + 1);
  }

  return target.getTime() - nowWib.getTime();
}

async function transferOneWallet(provider, privateKey, token, decimals, symbol, walletIndex, totalWallets) {
  const wallet        = new ethers.Wallet(privateKey, provider);
  const address       = wallet.address;
  const tokenContract = token.connect(wallet);
  const amountWei     = ethers.parseUnits(AMOUNT, decimals);

  console.log(`\n[Wallet ${walletIndex}/${totalWallets}] 👛 ${shortAddr(address)} (${address})`);

  const balance = await tokenContract.balanceOf(address);
  const balFmt  = ethers.formatUnits(balance, decimals);
  const ethBal  = await provider.getBalance(address);
  const ethFmt  = parseFloat(ethers.formatEther(ethBal)).toFixed(6);

  console.log(`   💰 Saldo Token : ${balFmt} ${symbol}`);
  console.log(`   ⛽ ETH Gas     : ${ethFmt} ETH`);

  if (balance < amountWei) {
    console.log(`   ⚠️  Saldo tidak cukup (perlu ${AMOUNT}, punya ${balFmt}). Dilewati.`);
    return { address, ok: 0, skip: 1, fail: 0 };
  }
  if (ethBal === 0n) {
    console.log(`   ⚠️  Tidak ada ETH untuk gas. Dilewati.`);
    return { address, ok: 0, skip: 1, fail: 0 };
  }

  let ok = 0, fail = 0;

  for (let i = 1; i <= REPEAT_COUNT; i++) {
    process.stdout.write(`   [${i}/${REPEAT_COUNT}] Mengirim ${AMOUNT} ${symbol}... `);
    try {
      const gasEst  = await tokenContract.transfer.estimateGas(address, amountWei);
      const tx      = await tokenContract.transfer(address, amountWei, {
        gasLimit: (gasEst * 120n) / 100n,
      });
      const receipt = await tx.wait();
      if (receipt.status === 1) {
        console.log(`✅ Block ${receipt.blockNumber} | ${tx.hash.slice(0, 16)}...`);
        ok++;
      } else {
        console.log(`❌ Reverted`);
        fail++;
      }
    } catch (err) {
      console.log(`❌ ${err.reason || err.shortMessage || err.message}`);
      fail++;
    }
    if (i < REPEAT_COUNT) await sleep(DELAY_BETWEEN_TX_MS);
  }

  console.log(`   📊 Hasil: ✅ ${ok} berhasil, ❌ ${fail} gagal`);
  return { address, ok, skip: 0, fail };
}

async function runBot() {
  const privateKeys = RAW_KEYS.split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0 && !k.startsWith("ISI_"));

  if (privateKeys.length === 0) {
    console.error("❌ Tidak ada PRIVATE_KEYS yang valid di .env!");
    process.exit(1);
  }

  const provider    = new ethers.JsonRpcProvider(RPC_URL);
  const dummyWallet = new ethers.Wallet(privateKeys[0], provider);
  const token       = new ethers.Contract(TOKEN_ADDR, ERC20_ABI, dummyWallet);

  let tokenName, symbol, decimals;
  try {
    [tokenName, symbol, decimals] = await Promise.all([
      token.name(), token.symbol(), token.decimals(),
    ]);
  } catch (err) {
    console.error("❌ Gagal membaca kontrak token:", err.message);
    process.exit(1);
  }

  console.log("\n" + divider("═"));
  console.log("   SELF TRANSFER BOT  |  BASE NETWORK  |  MULTI WALLET");
  console.log(divider("═"));
  console.log(`🕐 Waktu       : ${now()}`);
  console.log(`🪙 Token       : ${tokenName} (${symbol})`);
  console.log(`📄 Kontrak     : ${TOKEN_ADDR}`);
  console.log(`💸 Per TX      : ${AMOUNT} ${symbol}`);
  console.log(`🔁 Repeat      : ${REPEAT_COUNT}x per wallet`);
  console.log(`👛 Wallet      : ${privateKeys.length} wallet`);
  console.log(`⏱  Delay TX    : ${DELAY_BETWEEN_TX_MS}ms`);
  console.log(`⏱  Delay Wallet: ${DELAY_BETWEEN_WALLETS_MS}ms`);
  console.log(divider("═") + "\n");

  const results = [];

  for (let i = 0; i < privateKeys.length; i++) {
    const result = await transferOneWallet(
      provider, privateKeys[i], token, decimals, symbol, i + 1, privateKeys.length
    );
    results.push(result);
    if (i < privateKeys.length - 1) {
      console.log(`\n   ⏳ Jeda ${DELAY_BETWEEN_WALLETS_MS}ms sebelum wallet berikutnya...`);
      await sleep(DELAY_BETWEEN_WALLETS_MS);
    }
  }

  const totalOk   = results.reduce((s, r) => s + r.ok, 0);
  const totalSkip = results.reduce((s, r) => s + r.skip, 0);
  const totalFail = results.reduce((s, r) => s + r.fail, 0);

  console.log(`\n${divider("═")}`);
  console.log(`📊 RINGKASAN AKHIR`);
  console.log(`   👛 Wallet      : ${privateKeys.length}`);
  console.log(`   🔁 Repeat      : ${REPEAT_COUNT}x`);
  console.log(`   ✅ TX Berhasil : ${totalOk}`);
  console.log(`   ⚠️  Dilewati    : ${totalSkip}`);
  console.log(`   ❌ TX Gagal    : ${totalFail}`);
  console.log(`   🕐 Selesai     : ${now()}`);
  console.log(divider("═"));
}

function liveCountdown(msLeft, targetLabel) {
  return new Promise((resolve) => {
    let remaining = Math.floor(msLeft / 1000);

    function tick() {
      const h = Math.floor(remaining / 3600);
      const m = Math.floor((remaining % 3600) / 60);
      const s = remaining % 60;
      const hh = String(h).padStart(2, "0");
      const mm = String(m).padStart(2, "0");
      const ss = String(s).padStart(2, "0");
      process.stdout.write(`\r   ⏳ Menunggu : ${hh}j ${mm}m ${ss}d  →  ${now()}   `);
    }

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

async function main() {
  let msLeft, targetLabel;

  if (TEST_MODE) {
    msLeft      = getMsUntilTargetWIB(TEST_TIME);
    targetLabel = `${TEST_TIME}:00 WIB (TEST)`;
  } else {
    msLeft      = getMsUntilMidnightWIB();
    targetLabel = `00:00:00 WIB`;
  }

  console.log(divider("═"));
  console.log("   SELF TRANSFER BOT  |  MODE TERJADWAL");
  console.log(divider("═"));
  console.log(`🕐 Sekarang    : ${now()}`);
  console.log(`🎯 Eksekusi    : ${targetLabel}`);
  console.log(divider("═"));
  console.log("   Bot standby... (Ctrl+C untuk batal)\n");

  await liveCountdown(msLeft, targetLabel);

  console.log(`\n🚀 Waktunya! ${now()} — Menjalankan bot...`);
  await runBot();
}

main().catch((err) => {
  console.error("❌ Fatal:", err.message);
  process.exit(1);
});
