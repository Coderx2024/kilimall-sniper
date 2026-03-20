// ============================================
// KILIMALL SNIPER — RAILWAY EDITION v2.0
// No external dependencies — Node 18 native
// ============================================

const https = require('https');
const querystring = require('querystring');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONFIG FROM ENVIRONMENT VARIABLES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const CONFIG = {
  addressId:      process.env.ADDRESS_ID,
  mpesaPhone:     process.env.MPESA_PHONE,
  flashSessionId: process.env.FLASH_SESSION_ID,
  cookies:        process.env.COOKIES,
  buyAll:         process.env.BUY_ALL === 'true',
  pollInterval:   parseInt(process.env.POLL_INTERVAL) || 200,
  saleHour:       parseInt(process.env.SALE_HOUR),
  saleMinute:     parseInt(process.env.SALE_MINUTE),
  saleSecond:     parseInt(process.env.SALE_SECOND) || 0,
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
// HTTP REQUEST WRAPPER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function httpRequest(hostname, path, method, headers, postData = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      path,
      method,
      headers,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);

    req.setTimeout(8000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (postData) req.write(postData);
    req.end();
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 1: POLL FLASH SALE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function pollFlashSale() {
  const path = `/fs-session/${CONFIG.flashSessionId}/skus?lastId=-1&limit=18&categoryId=0&skip=0`;

  async function doFetch() {
    const result = await httpRequest(
      'mall-api.kilimall.com',
      path,
      'GET',
      getHeaders()
    );

    console.log(`📡 Poll status: ${result.status}`);

    if (result.status === 429) {
      console.warn(`⚠️ Rate limited — backing off...`);
      await new Promise(r => setTimeout(r, 1000));
      return [];
    }

    if (result.status !== 200) {
      console.warn(`⚠️ Bad response: ${result.status} →`, result.body);
      return [];
    }

    if (result.body.code !== 0) {
      console.warn(`⚠️ API code: ${result.body.code} | ${result.body.msg}`);
      return [];
    }

    const skus = result.body.data?.skus || [];

    skus.forEach(sku => {
      console.log(`   → [${sku.inventoryStatus}] ${String(sku.title).substring(0, 40)} | KSh ${sku.salePrice} | stock: ${sku.inventory} | promised: ${sku.promiseStock}`);
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

  const postData = querystring.stringify({
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
    const result = await httpRequest(
      'mall-api.kilimall.com',
      '/v2/place-order',
      'POST',
      getHeaders({
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(postData),
      }),
      postData
    );

    console.log(`📦 Order response:`, result.body);

    if (result.body.code === 0 || result.status === 201) {
      return result.body.data;
    } else {
      console.error(`❌ Order failed: ${result.body.msg}`);
      return null;
    }
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

  const postData = querystring.stringify({
    billId: String(billId),
    payChannel: "5",
    phone: CONFIG.mpesaPhone,
    payType: "1"
  });

  try {
    const result = await httpRequest(
      'mall-api.kilimall.com',
      '/v2/pay',
      'POST',
      getHeaders({
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(postData),
      }),
      postData
    );

    console.log(`💳 Payment response:`, result.body);

    if (result.body.code === 0) {
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`🎉 M-PESA STK PUSH SENT!`);
      console.log(`🛍️  Item: ${label}`);
      console.log(`📱 CHECK YOUR PHONE NOW!`);
      console.log(`⏰ ENTER PIN — 60 SECONDS!`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    } else {
      console.warn(`⚠️ STK issue: ${result.body.msg}`);
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
    process.stdout.write(`\r⏳ ${getCountdown()} | Watching ${CONFIG.targets.length} target(s)...   `);
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
      console.log(`📋 Order Code: ${orderData.code}`);
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
console.log("💀 KILIMALL SNIPER — RAILWAY EDITION v2.0");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
CONFIG.targets.forEach((t, i) => {
  console.log(`   ${i + 1}. ${t.label} (max KSh ${t.maxPrice})`);
});
console.log(`⏰ Sale: ${CONFIG.saleHour}:${String(CONFIG.saleMinute).padStart(2,"0")}`);
console.log(`📡 Session: ${CONFIG.flashSessionId}`);
console.log(`🏠 Address: ${CONFIG.addressId}`);
console.log(`📱 M-Pesa: ${CONFIG.mpesaPhone}`);
console.log(`⚡ Poll: every ${CONFIG.pollInterval}ms`);
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("🔕 Watching... Phone unlocked. Wait for PIN.");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

setInterval(mainLoop, CONFIG.pollInterval);
