// ── 設定（デプロイ前にここを書き換えてください）──
const CONFIG = {
  paypayLink: "https://qr.paypay.ne.jp/p2p01_XXXXXXXXXXXXXXXX", // PayPay個人送金リンク
  paypayId:   "your-paypay-id",                                  // 表示用PayPay ID
};

// ── 商品定義 ──
const ITEMS = {
  yakitori:        { name: "焼き鳥",       unit: "1本",        price: 100 },
  chocoBananaFull: { name: "チョコバナナ", unit: "1本",        price: 500 },
  chocoBananaHalf: { name: "チョコバナナ", unit: "半分",       price: 300 },
  soup:            { name: "スープ",       unit: "紙コップ1杯", price: 200 },
};

// ── カート状態 ──
const cart = { yakitori: 0, chocoBananaFull: 0, chocoBananaHalf: 0, soup: 0 };

// ── 数量変更 ──
function change(key, delta) {
  cart[key] = Math.max(0, cart[key] + delta);
  updateMenuUI();
}

// ── メニュー画面の表示更新 ──
function updateMenuUI() {
  let total = 0;
  for (const key in cart) {
    document.getElementById("qty-" + key).textContent = cart[key];
    total += cart[key] * ITEMS[key].price;
  }
  document.getElementById("menu-total").textContent = "¥" + total.toLocaleString();
  document.getElementById("btn-order").disabled = total === 0;
}

// ── 合計計算 ──
function calcTotal() {
  return Object.keys(cart).reduce((sum, key) => sum + cart[key] * ITEMS[key].price, 0);
}

// ── 注文内容 HTML を生成 ──
function buildOrderSummaryHTML() {
  return Object.keys(cart)
    .filter(key => cart[key] > 0)
    .map(key => {
      const item = ITEMS[key];
      const subtotal = cart[key] * item.price;
      return `<li>
        <span>${item.name}（${item.unit}）× ${cart[key]}</span>
        <span class="item-price">¥${subtotal.toLocaleString()}</span>
      </li>`;
    })
    .join("");
}

// ── 注文データを配列で返す ──
function buildOrderItems() {
  return Object.keys(cart)
    .filter(key => cart[key] > 0)
    .map(key => ({
      key,
      name: ITEMS[key].name,
      unit: ITEMS[key].unit,
      qty: cart[key],
      price: ITEMS[key].price,
      subtotal: cart[key] * ITEMS[key].price,
    }));
}

// ── API: 注文を保存 ──
async function saveOrder(paymentMethod) {
  const name = document.getElementById("customer-name").value.trim();
  try {
    await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName: name,
        items: buildOrderItems(),
        total: calcTotal(),
        paymentMethod,
      }),
    });
  } catch {
    // 保存失敗しても注文フローは継続
  }
}

// ── 名前入力イベント ──
function onNameInput() {
  const hasName = document.getElementById("customer-name").value.trim().length > 0;
  document.getElementById("btn-cash").disabled = !hasName;
  document.getElementById("btn-paypay").disabled = !hasName;
}

// ── 画面切り替え ──
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(el => el.classList.remove("active"));
  document.getElementById("screen-" + id).classList.add("active");
  window.scrollTo(0, 0);
}

// ── ② 支払い選択へ ──
function goToPaymentScreen() {
  const total = calcTotal();
  document.getElementById("payment-order-list").innerHTML = buildOrderSummaryHTML();
  document.getElementById("payment-total").textContent = "¥" + total.toLocaleString();
  document.getElementById("customer-name").value = "";
  document.getElementById("btn-cash").disabled = true;
  document.getElementById("btn-paypay").disabled = true;
  showScreen("payment");
}

// ── ③ 現金確認へ ──
async function goToCashScreen() {
  const name = document.getElementById("customer-name").value.trim();
  await saveOrder("cash");
  document.getElementById("cash-customer-name").textContent = `${name} 様`;
  document.getElementById("cash-order-list").innerHTML = buildOrderSummaryHTML();
  document.getElementById("cash-total").textContent = "¥" + calcTotal().toLocaleString();
  document.getElementById("cash-soup-note").style.display = cart.soup > 0 ? "block" : "none";
  showScreen("cash");
}

// ── ④ PayPay送金へ ──
async function goToPayPayScreen() {
  const name = document.getElementById("customer-name").value.trim();
  await saveOrder("paypay");
  const total = calcTotal();
  document.getElementById("paypay-amount").textContent = "¥" + total.toLocaleString();
  document.getElementById("paypay-id").textContent = CONFIG.paypayId;
  document.getElementById("paypay-link").href = CONFIG.paypayLink;
  document.getElementById("paypay-customer-name").textContent = `${name} 様`;
  document.getElementById("paypay-order-list").innerHTML = buildOrderSummaryHTML();
  document.getElementById("paypay-soup-note").style.display = cart.soup > 0 ? "block" : "none";
  showScreen("paypay");
}

// ── 最初に戻る ──
function resetOrder() {
  for (const key in cart) cart[key] = 0;
  updateMenuUI();
  showScreen("menu");
}

// ── 初期化 ──
updateMenuUI();
