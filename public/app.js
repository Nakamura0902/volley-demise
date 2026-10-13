// ── 商品定義 ──
// yakitori / soup は 1つあたりに含まれる本数・杯数（調理・集計用）
const SETS = {
  setSolo:   { name: "ひとりセット",     desc: "焼き鳥3本＋スープ1杯",  price: 300,  regular: 400,  yakitori: 3,  soup: 1 },
  setCoin:   { name: "ワンコインセット", desc: "焼き鳥6本＋スープ1杯",  price: 500,  regular: 700,  yakitori: 6,  soup: 1, badge: "人気No.1" },
  setPair:   { name: "ペアセット",       desc: "焼き鳥8本＋スープ2杯",  price: 700,  regular: 1000, yakitori: 8,  soup: 2 },
  setFamily: { name: "みんなでセット",   desc: "焼き鳥12本＋スープ4杯", price: 1000, regular: 1600, yakitori: 12, soup: 4, badge: "いちばんお得" },
};

const SINGLES = {
  yakitori: { name: "焼き鳥",       desc: "1本", price: 100, yakitori: 1, soup: 0 },
  soup:     { name: "コンソメスープ", desc: "1杯", price: 100, yakitori: 0, soup: 1 },
};

const ITEMS = { ...SETS, ...SINGLES };
const TICKET_STORAGE_KEY = "lastTicket";

// ── カート状態 ──
const cart = Object.fromEntries(Object.keys(ITEMS).map(key => [key, 0]));

// ── メニュー描画 ──
function renderMenuItem(key) {
  const item = ITEMS[key];
  const isSet = key in SETS;
  const saving = isSet ? item.regular - item.price : 0;
  return `
    <div class="menu-item ${isSet ? "menu-item--set" : ""}">
      <div class="menu-info">
        <span class="menu-name">${item.name}${item.badge ? ` <span class="set-badge">${item.badge}</span>` : ""}</span>
        <span class="menu-label">${item.desc}</span>
        <span class="menu-price">
          ${isSet ? `<s class="menu-regular">¥${item.regular.toLocaleString()}</s>` : ""}
          ¥${item.price.toLocaleString()}
          ${isSet ? `<span class="set-saving">¥${saving}お得</span>` : ""}
        </span>
      </div>
      <div class="counter">
        <button class="counter-btn" onclick="change('${key}', -1)">−</button>
        <span class="counter-val" id="qty-${key}">0</span>
        <button class="counter-btn" onclick="change('${key}', 1)">＋</button>
      </div>
    </div>`;
}

function renderMenu() {
  document.getElementById("set-list").innerHTML = Object.keys(SETS).map(renderMenuItem).join("");
  document.getElementById("single-list").innerHTML = Object.keys(SINGLES).map(renderMenuItem).join("");
}

// ── 数量変更 ──
function change(key, delta) {
  cart[key] = Math.max(0, cart[key] + delta);
  updateMenuUI();
}

// ── メニュー画面の表示更新 ──
function updateMenuUI() {
  for (const key in cart) {
    document.getElementById("qty-" + key).textContent = cart[key];
  }
  const total = calcTotal();
  document.getElementById("menu-total").textContent = "¥" + total.toLocaleString();
  document.getElementById("btn-order").disabled = total === 0;
}

// ── 合計計算 ──
function calcTotal() {
  return Object.keys(cart).reduce((sum, key) => sum + cart[key] * ITEMS[key].price, 0);
}

// ── 注文データを配列で返す ──
function buildOrderItems() {
  return Object.keys(cart)
    .filter(key => cart[key] > 0)
    .map(key => ({
      key,
      name: ITEMS[key].name,
      unit: ITEMS[key].desc,
      qty: cart[key],
      price: ITEMS[key].price,
      subtotal: cart[key] * ITEMS[key].price,
      yakitori: ITEMS[key].yakitori,
      soup: ITEMS[key].soup,
    }));
}

// ── 注文内容 HTML を生成 ──
function buildOrderSummaryHTML(items) {
  return items
    .map(i => `<li>
      <span>${i.name}（${i.unit}）× ${i.qty}</span>
      <span class="item-price">¥${i.subtotal.toLocaleString()}</span>
    </li>`)
    .join("");
}

// ── 名前入力イベント ──
function onNameInput() {
  const hasName = document.getElementById("customer-name").value.trim().length > 0;
  document.getElementById("btn-issue").disabled = !hasName;
}

// ── 画面切り替え ──
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(el => el.classList.remove("active"));
  document.getElementById("screen-" + id).classList.add("active");
  window.scrollTo(0, 0);
}

// ── ② 確認画面へ ──
function goToConfirmScreen() {
  document.getElementById("confirm-order-list").innerHTML = buildOrderSummaryHTML(buildOrderItems());
  document.getElementById("confirm-total").textContent = "¥" + calcTotal().toLocaleString();
  document.getElementById("customer-name").value = "";
  document.getElementById("btn-issue").disabled = true;
  document.getElementById("issue-error").style.display = "none";
  showScreen("confirm");
}

// ── 注文を確定（保存して注文番号を受け取る） ──
async function issueTicket() {
  const btn = document.getElementById("btn-issue");
  btn.disabled = true;
  document.getElementById("issue-error").style.display = "none";
  try {
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName: document.getElementById("customer-name").value.trim(),
        items: buildOrderItems(),
        total: calcTotal(),
      }),
    });
    if (!res.ok) throw new Error();
    const order = await res.json();
    try { localStorage.setItem(TICKET_STORAGE_KEY, JSON.stringify(order)); } catch {}
    showTicket(order);
  } catch {
    // 注文番号が必要なので、保存失敗時は再試行してもらう
    document.getElementById("issue-error").style.display = "block";
    btn.disabled = false;
  }
}

// ── ③ 注文番号表示 ──
function showTicket(order) {
  document.getElementById("ticket-number").textContent = order.id;
  document.getElementById("ticket-name").textContent = `${order.customer_name} 様`;
  document.getElementById("ticket-order-list").innerHTML = buildOrderSummaryHTML(order.items);
  document.getElementById("ticket-total").textContent = "¥" + Number(order.total).toLocaleString();
  showScreen("ticket");
}

// ── 新しく注文する ──
function startNewOrder() {
  try { localStorage.removeItem(TICKET_STORAGE_KEY); } catch {}
  for (const key in cart) cart[key] = 0;
  updateMenuUI();
  showScreen("menu");
}

// ── 初期化 ──
renderMenu();
updateMenuUI();

// 再読み込みしても注文番号を表示し続ける
try {
  const saved = JSON.parse(localStorage.getItem(TICKET_STORAGE_KEY));
  if (saved) showTicket(saved);
} catch {}
