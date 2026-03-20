// ============================================
// KILIMALL SNIPER — RAILWAY EDITION
// ============================================

const fetch = require('node-fetch');
const querystring = require('querystring');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONFIG FROM ENVIRONMENT VARIABLES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const CONFIG = {
  addressId:       process.env.ADDRESS_ID,
  mpesaPhone:      process.env.MPESA_PHONE,
  flashSessionId:  process.env.FLASH_SESSION_ID,
  cookies:         process.env.COOKIES,
  buyAll:          process.env.BUY_ALL === 'true',
  pollInterval:    parseInt(process.env.POLL_INTERVAL) || 200,
  saleHour:        parseInt(process.env.SALE_HOUR),
  saleMinute:      parseInt(process.env.SALE_MINUTE),
  saleSecond:      parseInt(process.env.SALE_SECOND) || 0,
  targets: (process.env.TARGETS || '').split(',').map(t => {
    const [keyword, maxPrice] = t.split(':');
    return { keyword, maxPrice: parseInt(maxPrice), label: keyword };
  }),
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STATE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
let done = false;
let tick = 0;
const purchased = [];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function getHeaders(extra = {}) {
  return {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Referer": "https://www.kilimall.co.ke/",
    "Origin": "https://www.kilimall.co.ke",
    "Cookie": CONFIG.cookies,
    "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
    ...extra
  };
}

function getCountdown() {
  const now = new Date();
  const target = new Date();
  target.setHours(CONFIG.saleHour, CONFIG.saleMinute, CONFIG.saleSecond, 0);
  const diff = target - now;
  if (diff <= 0) return "🔥 LIVE";
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  const ms = diff % 1000;
  return `${h}h ${m}m ${s}s ${ms}ms`;
}

function isAtSaleTime() {
  const now = new Date();
  const target = new Date();
  target.setHours(CONFIG.saleHour, CONFIG.saleMinute, CONFIG.saleSecond, 0);
  return (target - now) <= 0;
}

function alreadyBought(skuId) {
  return purchased.includes(String(skuId));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 1: POLL FLASH SALE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function pollFlashSale() {
  const url = `https://mall-api.kilimall.com/fs-session/${CONFIG.flashSessionId}/skus?lastId=-1&limit=18&categoryId=0&skip=0`;

  async function doFetch() {
    const res = await fetch(url, {
      method: 'GET',
      headers: getHeaders(),
    });

    console.log(`📡 Poll status: ${res.status}`);

    if (!res.ok) {
      const txt = await res.text();
      console.warn(`⚠️ Bad response: ${res.status} → ${txt}`);
      return [];
    }

    const json = await res.json();

    if (json.code !== 0) {
      console.warn(`⚠️ API code: ${json.code} | ${json.msg}`);
      return [];
    }

    const skus = json.data?.skus || [];
    skus.forEach(sku => {
      console.log(`   → [${sku.inventoryStatus}] ${sku.title?.substring(0,40)} | KSh ${sku.salePrice} | stock: ${sku.inventory} | promised: ${sku.promiseStock}`);
    });

    return skus;
  }

  try {
    return await doFetch();
  } catch (err) {
    console.warn(`🌐 Hiccup: ${err.message} — retrying...`);
    try {
      return await doFetch();
    } catch (e) {
      console.error(`❌ Retry failed: ${e.message}`);
      return [];
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 2: MATCH TARGETS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function matchTargets(skus) {
  const matches = [];
  for (let target of CONFIG.targets) {
    for (let sku of skus) {
      if (!sku.title) continue;
      const titleMatch = sku.title.toUpperCase().includes(target.keyword.toUpperCase());
      const isLive = sku.inventoryStatus === 1 && sku.inventory > 0;
      const priceOk = sku.salePrice <= target.maxPrice;
      const notBought = !alreadyBought(sku.skuId);
      if (titleMatch) {
        console.log(`🔍 ${target.keyword}: live=${isLive} | priceOk=${priceOk} | status=${sku.inventoryStatus} | stock=${sku.inventory}`);
      }
      if (titleMatch && isLive && priceOk && notBought) {
        matches.push({ sku, target });
        break;
      }
    }
  }
  return matches;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 3: PLACE ORDER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function placeOrder(sku) {
  console.log(`🛒 Placing order: ${sku.title}`);

  const skuItems = JSON.stringify([{
    skuId: String(sku.skuId),
    count: 1,
    externalLastTrafficSourceType: "organic",
    externalLastTrafficSourceChannel: "PC",
    externalLastTrafficValue: "",
    internalLatestTrafficSourceModule: "",
    internalLatestTrafficSourceType: "",
    insideLatestTrafficSourceValue: "",
    isAd: false,
    activityId: sku.activityId,
    activityType: 1
  }]);

  const body = querystring.stringify({
    addressId: CONFIG.addressId,
    preOrderId: "1",
    skuItems,
    payment: "1",
    source: "2",
    timeSelected: "0",
    redeem: "0",
    useCoins: "0",
    payChannel: "5"
  });

  try {
    const res = await fetch("https://mall-api.kilimall.com/v2/place-order", {
      method: 'POST',
      headers: getHeaders({ "Content-Type": "application/x-www-form-urlencoded" }),
      body,
    });
    const json = await res.json();
    console.log(`📦 Order response:`, json);
    if (json.code === 0 || res.status === 201) return json.data;
    console.error(`❌ Order failed: ${json.msg}`);
    return null;
  } catch (err) {
    console.error(`❌ Order error: ${err.message}`);
    return null;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 4: TRIGGER M-PESA
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function triggerMpesa(billId, label) {
  console.log(`📱 Triggering M-Pesa | Bill: ${billId}`);
  const body = querystring.stringify({
    billId: String(billId),
    payChannel: "5",
    phone: CONFIG.mpesaPhone,
    payType: "1"
  });
  try {
    const res = await fetch("https://mall-api.kilimall.com/v2/pay", {
      method: 'POST',
      headers: getHeaders({ "Content-Type": "application/x-www-form-urlencoded" }),
      body,
    });
    const json = await res.json();
    console.log(`💳 Payment response:`, json);
    if (json.code === 0) {
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`🎉 M-PESA STK PUSH SENT!`);
      console.log(`🛍️  Item: ${label}`);
      console.log(`📱 CHECK YOUR PHONE NOW!`);
      console.log(`⏰ ENTER PIN — 60 SECONDS!`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    } else {
      console.warn(`⚠️ STK issue: ${json.msg}`);
      console.log(`👉 Pay manually at kilimall.co.ke/orders`);
    }
  } catch (err) {
    console.error(`❌ M-Pesa error: ${err.message}`);
    console.log(`👉 Pay manually at kilimall.co.ke/orders`);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN LOOP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function mainLoop() {
  if (done) return;
  tick++;

  if (tick % 5 === 0) {
    process.stdout.write(`\r⏳ ${getCountdown()} | Watching ${CONFIG.targets.length} target(s)...`);
  }

  if (!isAtSaleTime()) return;

  const skus = await pollFlashSale();
  if (!skus.length) return;

  const matches = matchTargets(skus);
  if (!matches.length) {
    console.log(`\n🔍 No matching live targets yet...`);
    return;
  }

  const toBuy = CONFIG.buyAll ? matches : [matches[0]];

  for (let { sku, target } of toBuy) {
    if (alreadyBought(sku.skuId)) continue;
    console.log(`\n🎯 TARGET ACQUIRED: ${target.label}`);
    console.log(`💰 Price: KSh ${sku.salePrice}`);
    console.log(`📦 Stock: ${sku.inventory}`);
    const orderData = await placeOrder(sku);
    if (orderData?.billId) {
      purchased.push(String(sku.skuId));
      console.log(`✅ ORDER CONFIRMED: ${target.label}`);
      console.log(`📋 Bill ID: ${orderData.billId}`);
      await triggerMpesa(orderData.billId, target.label);
    }
    if (CONFIG.buyAll) await new Promise(r => setTimeout(r, 300));
  }

  if (!CONFIG.buyAll && purchased.length > 0) {
    done = true;
    console.log(`\n🏁 Mission complete!`);
    process.exit(0);
  }

  if (CONFIG.buyAll && purchased.length >= CONFIG.targets.length) {
    done = true;
    console.log(`\n🏁 All targets acquired!`);
    process.exit(0);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ARM
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("💀 KILIMALL SNIPER — RAILWAY EDITION");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
CONFIG.targets.forEach((t, i) => {
  console.log(`   ${i + 1}. ${t.label} (max KSh ${t.maxPrice})`);
});
console.log(`⏰ Sale: ${CONFIG.saleHour}:${String(CONFIG.saleMinute).padStart(2,"0")}`);
console.log(`📡 Session: ${CONFIG.flashSessionId}`);
console.log(`🏠 Address: ${CONFIG.addressId}`);
console.log(`📱 M-Pesa: ${CONFIG.mpesaPhone}`);
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

setInterval(mainLoop, CONFIG.pollInterval);
```

---

**Step 3 — Push to GitHub**

1. Go to `github.com` → New repository → name it `kilimall-sniper` → Public → Create
2. Upload your 3 files by dragging them into the repo page
3. Click "Commit changes"

---

**Step 4 — Deploy on Railway**

1. Go to `railway.app` → New Project
2. Click **"Deploy from GitHub repo"**
3. Select `kilimall-sniper`
4. Railway auto-detects Node.js and deploys

---

**Step 5 — Set environment variables on Railway**

1. Click your project → **Variables** tab
2. Add each variable from your `.env` file one by one
3. Most important ones to set before each sale:
```
FLASH_SESSION_ID = fresh ID from Network tab
SALE_HOUR = 10
SALE_MINUTE = 0
COOKIES = your fresh cookies
```

---

**Step 6 — Get your cookies**

1. Go to kilimall.co.ke — make sure you're logged in
2. F12 → Application → Cookies → `https://www.kilimall.co.ke`
3. Copy `HWWAFSESID` and `HWWAFSESTIME` values
4. Paste into Railway Variables as:
```
COOKIES = HWWAFSESID=abc123; HWWAFSESTIME=xyz456