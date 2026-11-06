/* Star Citizen Trading (mobile) - user interface. Created by Mossy. */
"use strict";

const S = SCT.settings;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const app = { market: null, ships: [], ship: null, loading: false, page: "home", routeMode: "one", routes: [],
  lastLoad: 0, error: null, filters: { system: S.system, sort: "profit", cross: false, illegal: false, dock: false,
  showAll: false, ignoreBoxes: false, timed: false, from: "", to: "", commodity: "", legs: 3, oneWay: false, cargo: "" },
  stockSide: "buy", stockLevel: "low", sellResult: null };

/* ------------------------------------------------------------------ helpers */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => (n == null || isNaN(n) ? "–" : Math.round(n).toLocaleString("en-US"));
const short = (n) => n == null ? "–" : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(Math.abs(n) >= 1e7 ? 1 : 2).replace(/\.?0+$/, "") + "M" : Math.abs(n) >= 1e3 ? Math.round(n / 1e3) + "k" : money(n);
const pct = (n) => (n == null ? "–" : n.toFixed(1) + "%");
const mins = (m) => (m == null ? "–" : m < 60 ? Math.round(m) + " min" : Math.floor(m / 60) + " h " + Math.round(m % 60) + " m");
function ago(sec) {
  if (sec == null) return "unknown";
  if (sec < 60) return "just now";
  if (sec < 3600) return Math.round(sec / 60) + " min ago";
  if (sec < 86400) return Math.round(sec / 3600) + " h ago";
  return Math.round(sec / 86400) + " d ago";
}
const ageText = (s) => s == null ? "?" : s < 3600 ? Math.max(1, Math.round(s / 60)) + "m" : s < 86400 ? Math.round(s / 3600) + "h" : Math.round(s / 86400) + "d";
const ageBadge = (sec) => `<span class="age ${SCT.freshness(sec)}">${ageText(sec)}</span>`;
const level = (code, name) => name ? `<span class="badge lv${code ?? "x"}">${esc(name)}</span>` : "";
const lvl = (p, side) => level(side === "buy" ? p.sb : p.ss, SCT.statusName(app.market, side === "buy" ? p.sb : p.ss));
const illegal = (x) => (x ? '<span class="tag illegal">ILLEGAL</span>' : "");
const planText = (plan) => (plan || []).map(([s, n]) => `${n}×${s}`).join(" + ");
const parseAuec = (v) => { const m = String(v || "").trim().toLowerCase().replace(/[, ]/g, "").match(/^([\d.]+)([km]?)/); return m ? Math.round(parseFloat(m[1]) * (m[2] === "m" ? 1e6 : m[2] === "k" ? 1e3 : 1)) || 0 : 0; };
const empty = (t, s = "") => `<div class="empty"><b>${esc(t)}</b>${esc(s)}</div>`;
const skel = (n = 4) => Array(n).fill('<div class="skel"></div>').join("");
const sw = (id, on) => `<label class="sw"><input type="checkbox" id="${id}" ${on ? "checked" : ""}><span></span></label>`;
const toggleRow = (id, title, sub, on) => `<div class="toggle"><div><b>${title}</b>${sub ? `<span>${sub}</span>` : ""}</div>${sw(id, on)}</div>`;
let toastT;
function toast(msg, err = false) {
  const t = $("#toast"); t.textContent = msg; t.className = "toast on" + (err ? " err" : "");
  clearTimeout(toastT); toastT = setTimeout(() => (t.className = "toast"), 3600);
}
const store = SCT.store;
const list = (k) => store.get(k, []);
const uid = () => Math.random().toString(36).slice(2, 10);

/* ------------------------------------------------------------------ sound */
let audioCtx;
function audio() {
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === "suspended") audioCtx.resume(); } catch { return null; }
  return audioCtx;
}
document.addEventListener("pointerdown", () => audio(), { once: true });
function chime(vol) {
  if (vol == null) { if (!S.sound) return; vol = S.volume; }
  const ctx = audio(); if (!ctx || vol <= 0) return;
  const t0 = ctx.currentTime;
  [[880, 0], [1318.5, .14], [1760, .28]].forEach(([f, at]) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = f; g.gain.setValueAtTime(0, t0 + at);
    g.gain.linearRampToValueAtTime(.35 * vol, t0 + at + .02); g.gain.exponentialRampToValueAtTime(.0001, t0 + at + .6);
    o.connect(g).connect(ctx.destination); o.start(t0 + at); o.stop(t0 + at + .65);
  });
}
async function notify(title, body) {
  chime();
  if (S.vibrate && navigator.vibrate) navigator.vibrate([90, 60, 90]);
  toast(body);
  try {
    if ("Notification" in window && Notification.permission === "granted" && navigator.serviceWorker) {
      const reg = await navigator.serviceWorker.ready;
      reg.showNotification(title, { body, icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: title });
    }
  } catch { /* ignore */ }
}

/* ------------------------------------------------------------- navigation */
const TITLES = { home: "Star Citizen Trading", routes: "Trade Routes", sell: "Sell Cargo", ships: "Ships", more: "More",
  commodities: "Commodities", stock: "Stock Levels", terminal: "Terminals", log: "Trade Log", alerts: "Price Alerts",
  settings: "Settings", about: "About & Connection" };
const TABS = ["home", "routes", "sell", "ships", "more"];
const SUB_OF = { commodities: "more", stock: "more", terminal: "more", log: "more", alerts: "more", settings: "more", about: "more" };

function go(page, push = true) {
  if (!TITLES[page]) page = "home";
  app.page = page;
  $$(".page").forEach((p) => p.classList.toggle("on", p.id === "p-" + page));
  const tab = SUB_OF[page] || page;
  $$("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.go === tab));
  $("#title").textContent = TITLES[page];
  $("#back").hidden = !SUB_OF[page];
  $("#logo").hidden = !!SUB_OF[page];
  if (push && location.hash.slice(1) !== page) history.pushState({ page }, "", "#" + page);
  window.scrollTo(0, 0);
  render(page);
}
$$("#tabs button").forEach((b) => b.onclick = () => go(b.dataset.go));
$("#back").onclick = () => history.back();
window.addEventListener("popstate", () => {
  if (app.ignorePop) { app.ignorePop = false; return; }
  if (sheetOpen()) { closeSheet(false); return; }
  const p = location.hash.slice(1) || "home";
  go(p, false);
});

/* ------------------------------------------------------------------ sheet */
const sheetOpen = () => $("#sheet").classList.contains("on");
function openSheet(html, after) {
  $("#sheet-body").innerHTML = html;
  $("#sheet").classList.add("on"); $("#sheet-bg").classList.add("on");
  $("#sheet").scrollTop = 0;
  if (!history.state || !history.state.sheet) history.pushState({ sheet: 1, page: app.page }, "", location.hash || "#" + app.page);
  if (after) after($("#sheet-body"));
}
function closeSheet(popHistory = true) {
  $("#sheet").classList.remove("on"); $("#sheet-bg").classList.remove("on");
  if (popHistory && history.state && history.state.sheet) { app.ignorePop = true; history.back(); }
}
$("#sheet-bg").onclick = () => closeSheet();

/* --------------------------------------------------------------- data load */
async function load(force = false) {
  if (app.loading) return;
  app.loading = true;
  $("#refresh").classList.add("spin");
  $("#age-label").textContent = "Updating…";
  try {
    const { market, ships, events } = await SCT.loadAll(force);
    app.market = market; app.ships = ships; app.error = null;
    app.ship = ships.find((s) => s.name === S.activeShip) || null;
    app.lastLoad = Date.now();
    fillDatalists();
    checkAlerts(events);
    for (const e of events) await notify(e.title, e.msg);
    if (force && !events.length) toast("Prices updated");
  } catch (e) {
    app.error = e;
    SCT.status.uex = { state: e.blocked ? "error" : "warn", msg: e.blocked ? "Blocked from this phone - relay needed" : "Couldn't connect" };
    if (!app.market) toast(e.blocked ? "Can't reach UEX from this phone - see More › About & Connection" : e.message, true);
    else toast("Couldn't update - showing saved data", true);
  } finally {
    app.loading = false;
    $("#refresh").classList.remove("spin");
    header();
    render(app.page);
  }
}
$("#refresh").onclick = () => { audio(); load(true); };

function header() {
  const s = app.ship;
  $("#ship-label").innerHTML = s ? `${esc(s.name)} <small>${money(s.effCargo)} SCU · ≤${s.maxBox || "?"}</small>` : "Choose ship";
  $("#budget-label").innerHTML = S.budget ? `Invest <small>${short(S.budget)}</small>` : "Invest <small>no limit</small>";
  const live = $("#chip-live");
  live.hidden = !(app.market && app.market.live);
  if (!live.hidden) live.textContent = "Live " + app.market.live;
  const a = app.market && app.market.savedAt ? Date.now() / 1000 - app.market.savedAt : null;
  $("#age-label").textContent = app.market ? `Prices ${ago(a)}` : app.error ? "No data" : "Loading…";
  $("#chip-age").classList.toggle("warn", !!app.error);
  const hits = list("alerts").filter((x) => x.hit).length;
  $("#more-badge").hidden = !hits; $("#more-badge").textContent = hits;
}
function fillDatalists() {
  const m = app.market;
  $("#dl-commodities").innerHTML = [...new Set([...m.commodities.values()].map((c) => c.name))].sort().map((n) => `<option value="${esc(n)}">`).join("");
  $("#dl-terminals").innerHTML = [...m.terminals.values()].filter((t) => t.available).map((t) => t.name).sort().map((n) => `<option value="${esc(n)}">`).join("");
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && S.autoRefreshMin && Date.now() - app.lastLoad > S.autoRefreshMin * 60000) load(true);
});
setInterval(() => { if (document.visibilityState === "visible" && S.autoRefreshMin && Date.now() - app.lastLoad > S.autoRefreshMin * 60000) load(true); }, 60000);

/* ------------------------------------------------------------- ship/budget */
$("#chip-ship").onclick = () => shipPicker();
function shipPicker() {
  const ships = app.ships.filter((s) => s.effCargo > 0 && (!s.concept || s.name === S.activeShip));
  openSheet(`<h3>Your ship</h3><div class="lead">Cargo and box sizes everywhere come from this ship.</div>
    <input id="sp-q" placeholder="Search ships…" autocomplete="off">
    <div class="card flush" style="margin-top:12px"><div class="list" id="sp-list"></div></div>`, (el) => {
    const draw = () => {
      const q = $("#sp-q", el).value.toLowerCase();
      const rows = ships.filter((s) => !q || (s.name + " " + s.maker).toLowerCase().includes(q));
      $("#sp-list", el).innerHTML = rows.length ? rows.map((s) => `<div class="item tap" data-n="${esc(s.name)}">
        <div class="t">${esc(s.name)}${s.isNew ? '<span class="tag new">NEW</span>' : ""}${s.name === S.activeShip ? '<span class="tag fly">FLYING</span>' : ""}<div class="sub">${esc(s.maker)}</div></div>
        <div class="val">${money(s.effCargo)}<small>SCU · box ≤${s.maxBox || "?"}</small></div></div>`).join("")
        : empty(app.market ? "No ships match" : "Ships load with the price data");
      $$("[data-n]", el).forEach((r) => r.onclick = () => setShip(r.dataset.n));
    };
    $("#sp-q", el).oninput = draw; draw();
  });
}
function setShip(name) {
  SCT.saveSettings({ activeShip: name });
  app.ship = app.ships.find((s) => s.name === name) || null;
  closeSheet(); header(); render(app.page);
  if (app.ship) toast(`Flying ${app.ship.name}: ${money(app.ship.effCargo)} SCU, boxes up to ${app.ship.maxBox || "?"} SCU`);
}
$("#chip-budget").onclick = () => openSheet(`<h3>Investment per run</h3>
  <div class="lead">How much aUEC to put into a run. Every list plans with this.</div>
  <input id="bg-in" inputmode="decimal" placeholder="No limit - e.g. 1m, 250k" value="${S.budget ? money(S.budget) : ""}">
  <div class="r-foot" style="margin-top:12px">${["100k", "250k", "500k", "1m", "2.5m", "5m"].map((v) => `<button class="btn small" data-v="${v}">${v}</button>`).join("")}<button class="btn small ghost" data-v="">No limit</button></div>
  <button class="btn primary block" id="bg-save" style="margin-top:16px">Save</button>`, (el) => {
  $$("[data-v]", el).forEach((b) => b.onclick = () => { $("#bg-in", el).value = b.dataset.v; });
  $("#bg-save", el).onclick = () => { SCT.saveSettings({ budget: parseAuec($("#bg-in", el).value) }); closeSheet(); header(); render(app.page); toast(S.budget ? `Investing up to ${money(S.budget)} aUEC` : "No investment limit"); };
});

/* ----------------------------------------------------------------- render */
function render(page) {
  const el = $("#p-" + page);
  if (!el) return;
  const needsData = !["more", "settings", "about", "log", "alerts"].includes(page);
  if (needsData && !app.market) {
    el.innerHTML = app.error ? `<div class="banner err"><b>Can't load trade data.</b><br>${esc(app.error.message)}</div>
      <button class="btn primary block" onclick="go('about')">Fix the connection</button>` : skel(5);
    return;
  }
  ({ home, routes, sell, ships, more, commodities, stock, terminal, log: tradeLog, alerts, settings, about }[page])(el);
}
function filtersFor(o = {}) {
  const F = app.filters, m = app.market;
  const ids = (txt) => { if (!txt) return null; const ts = SCT.findTerminals(m, txt); return new Set(ts.length ? ts.map((t) => t.id) : [-1]); };
  let commodities = null;
  if (F.commodity) { const c = SCT.findCommodity(m, F.commodity); commodities = new Set([c ? c.id : -1]); }
  return SCT.makeFilters({ ship: app.ship, system: F.system, cross: F.cross, illegal: F.illegal, dockOnly: F.dock,
    showAll: F.showAll, ignoreBoxes: F.ignoreBoxes, cargo: +F.cargo || null, origins: ids(F.from), dests: ids(F.to), commodities, ...o });
}
function routeCard(r, i) {
  return `<div class="route" data-i="${i}">
    <div class="r-head"><div class="c">${esc(r.commodity)}${illegal(r.illegal)}</div><div class="p">+${money(r.profit)}</div></div>
    <div class="r-path"><div><b>${esc(r.b.t.name)}</b><span>${money(r.b.buy)} ${ageBadge(SCT.age(r.b))}</span></div><i>→</i>
      <div><b>${esc(r.s.t.name)}</b><span>${money(r.s.sell)} ${ageBadge(SCT.age(r.s))}</span></div></div>
    <div class="r-foot"><span class="pill"><b>${money(r.scu)}</b> SCU${r.by !== "cargo" ? " · " + r.by : ""}</span><span class="pill">${planText(r.plan)}</span>
      <span class="pill">${short(r.invest)} → <b>${short(r.revenue)}</b></span><span class="pill">${pct(r.roi)}</span>
      ${r.min ? `<span class="pill">${mins(r.min)} · <b>${short(r.perMin)}</b>/min</span>` : ""}</div></div>`;
}
const bindRoutes = (el, routes) => $$(".route[data-i]", el).forEach((c) => c.onclick = () => routeSheet(routes[+c.dataset.i]));

/* ------------------------------------------------------------------- home */
function home(el) {
  const m = app.market;
  const f = filtersFor({ origins: null, dests: null, commodities: null });
  const top = SCT.findRoutes(m, f, "profit", 5);
  const loops = SCT.roundTrips(m, f, false, 3);
  const pins = list("pins").map((p) => {
    const r = SCT.findRoutes(m, SCT.makeFilters({ ship: app.ship, cross: true, illegal: true, origins: new Set([p.from]), dests: new Set([p.to]), commodities: new Set([p.cid]) }), "profit", 1)[0];
    return { p, r };
  });
  const trades = list("trades"), dayStart = new Date().setHours(0, 0, 0, 0) / 1000;
  const today = trades.filter((t) => t.time >= dayStart).reduce((a, t) => a + (t.side === "sell" ? 1 : -1) * t.scu * t.price, 0);
  const stale = m.prices.filter((p) => { const a = SCT.age(p); return S.maxAgeHours && a != null && a > S.maxAgeHours * 3600; }).length;
  const best = top[0];
  el.innerHTML = `
    ${!app.ship ? `<div class="banner"><b>Pick your ship</b> so every run uses its cargo and box sizes. <a href="#" id="pick">Choose ship →</a></div>` : ""}
    <div class="kpis">
      <div class="kpi accent"><div class="k">Best run</div><div class="v">${best ? "+" + short(best.profit) : "–"}</div><div class="s">${best ? esc(best.commodity) : "No routes"}</div></div>
      <div class="kpi"><div class="k">Best loop</div><div class="v">${loops[0] ? "+" + short(loops[0].profit) : "–"}</div><div class="s">${loops[0] ? esc(loops[0].out.b.t.name) : "None"}</div></div>
      <div class="kpi"><div class="k">Your hold</div><div class="v">${money(f.cargo)} SCU</div><div class="s">${S.budget ? "invest " + short(S.budget) : "no budget limit"}</div></div>
      <div class="kpi"><div class="k">Logged today</div><div class="v ${today < 0 ? "neg" : ""}">${today < 0 ? "−" : "+"}${short(Math.abs(today))}</div><div class="s">${trades.length} trades logged</div></div>
    </div>
    <div class="note">${f.system || "All systems"} · fresh, in-stock prices only${S.maxAgeHours ? ` (≤ ${S.maxAgeHours} h)` : ""} · ${money(stale)} stale reports ignored</div>
    <div class="section-title">Top runs for your ship <a href="#routes">All →</a></div>
    <div class="stack" id="h-top">${top.length ? top.map(routeCard).join("") : `<div class="card">${empty("No profitable runs", "Try another system or turn off a filter.")}</div>`}</div>
    ${pins.length ? `<div class="section-title">Pinned</div><div class="card flush"><div class="list">${pins.map(({ p, r }, i) => `<div class="item tap" data-pin="${i}">
      <div class="t">${esc(r ? r.commodity : p.label)}<div class="sub">${r ? esc(r.b.t.name) + ' <span class="arrow">→</span> ' + esc(r.s.t.name) : "Not profitable right now"}</div></div>
      <div class="val ${r ? "pos" : "dim"}">${r ? "+" + short(r.profit) : "–"}<small>${r ? money(r.margin) + "/SCU" : ""}</small></div></div>`).join("")}</div></div>` : ""}
    <div class="section-title">Best round trips</div>
    <div class="card flush"><div class="list">${loops.length ? loops.map((t, i) => `<div class="item tap" data-loop="${i}">
      <div class="t">${esc(t.out.b.t.name)} ⇄ ${esc(t.out.s.t.name)}<div class="sub">${esc(t.out.commodity)} out · ${esc(t.back ? t.back.commodity : "empty")} back</div></div>
      <div class="val pos">+${short(t.profit)}<small>per loop</small></div></div>`).join("") : empty("No two-way loops")}</div></div>
    <div class="credit">Star Citizen Trading · Created by Mossy</div>`;
  bindRoutes($("#h-top", el), top);
  $$("[data-loop]", el).forEach((r) => r.onclick = () => loopSheet(loops[+r.dataset.loop]));
  $$("[data-pin]", el).forEach((r) => r.onclick = () => { const x = pins[+r.dataset.pin]; if (x.r) routeSheet(x.r); });
  const pick = $("#pick", el); if (pick) pick.onclick = (e) => { e.preventDefault(); shipPicker(); };
}

/* ----------------------------------------------------------------- routes */
function routes(el) {
  const F = app.filters, mode = app.routeMode;
  const sortName = { profit: "Profit", perMin: "Profit/min", margin: "Margin", roi: "ROI", investment: "Cheapest" }[F.sort];
  const bits = [F.system === "all" ? "All systems" : F.system, (+F.cargo || (app.ship ? app.ship.effCargo : S.defaultCargo)) + " SCU",
    F.from && "from " + F.from, F.to && "to " + F.to, F.commodity, mode === "one" && "sort: " + sortName, mode === "multi" && F.legs + " legs",
    F.showAll && "incl. stale", F.illegal && "illegal", F.cross && "cross-system"].filter(Boolean);
  el.innerHTML = `
    <div class="seg" id="mode"><button data-m="one">One-way</button><button data-m="loop">Round trip</button><button data-m="multi">Multi-stop</button></div>
    <div class="filterbar"><div class="summary">${esc(bits.join(" · "))}</div><button class="btn small" id="filt">Filters</button></div>
    <div class="stack" id="r-list">${skel(4)}</div>`;
  $$("#mode button", el).forEach((b) => { b.classList.toggle("on", b.dataset.m === mode); b.onclick = () => { app.routeMode = b.dataset.m; routes(el); }; });
  $("#filt", el).onclick = filterSheet;
  setTimeout(() => fillRoutes($("#r-list", el)), 10);
}
async function fillRoutes(box) {
  const m = app.market, F = app.filters, f = filtersFor();
  if (app.routeMode === "one") {
    const timedSort = F.sort === "perMin";
    let rs = SCT.findRoutes(m, f, timedSort ? "profit" : F.sort, timedSort ? 60 : 80);
    if (timedSort || F.timed) {
      box.innerHTML = `<div class="card">${empty("Looking up distances…", "The first time takes up to ~30 s. Saved for a week.")}</div>`;
      await SCT.fillDistances(rs, 25);
      if (timedSort) rs = rs.filter((r) => r.perMin).sort((a, b) => b.perMin - a.perMin);
    }
    app.routes = rs;
    box.innerHTML = rs.length ? rs.map(routeCard).join("") : `<div class="card">${empty("No profitable routes", "Try another system, a bigger budget, or Filters › Show stale & out of stock.")}</div>`;
    bindRoutes(box, rs);
  } else if (app.routeMode === "loop") {
    const trips = SCT.roundTrips(m, f, F.oneWay, 40);
    box.innerHTML = trips.length ? trips.map((t, i) => `<div class="route" data-t="${i}">
      <div class="r-head"><div class="c">${esc(t.out.b.t.name)} ⇄ ${esc(t.out.s.t.name)}</div><div class="p">+${money(t.profit)}</div></div>
      <div class="r-foot"><span class="pill">→ <b>${esc(t.out.commodity)}</b> ${money(t.out.scu)} SCU · +${short(t.out.profit)}</span>
      <span class="pill">← ${t.back ? `<b>${esc(t.back.commodity)}</b> ${money(t.back.scu)} SCU · +${short(t.back.profit)}` : "fly back empty"}</span></div></div>`).join("")
      : `<div class="card">${empty("No loops found", "Try Filters › Include empty return legs.")}</div>`;
    $$("[data-t]", box).forEach((c) => c.onclick = () => loopSheet(trips[+c.dataset.t]));
  } else {
    const ch = SCT.chains(m, f, F.legs, 20);
    box.innerHTML = ch.length ? ch.map((c, i) => `<div class="route" data-c="${i}">
      <div class="r-head"><div class="c">${c.legs.length} legs</div><div class="p">+${money(c.profit)}</div></div>
      <div class="sub muted" style="font-size:13px">${c.stops.map(esc).join(' <span class="arrow">→</span> ')}</div>
      <div class="r-foot">${c.legs.map((r) => `<span class="pill"><b>${esc(r.commodity)}</b> +${short(r.profit)}</span>`).join("")}<span class="pill">start ${short(c.startInvest)}</span></div></div>`).join("")
      : `<div class="card">${empty("No multi-stop runs", "Try fewer legs or another system.")}</div>`;
    $$("[data-c]", box).forEach((c) => c.onclick = () => chainSheet(ch[+c.dataset.c]));
  }
}
function filterSheet() {
  const F = app.filters, m = app.market;
  openSheet(`<h3>Filters</h3><div class="stack" style="margin-top:12px">
    <div class="row2"><label class="field">System<select id="f-sys"><option value="all">All systems</option>${m.systems.map((s) => `<option ${F.system === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></label>
      <label class="field">Load SCU<input id="f-scu" type="number" inputmode="numeric" placeholder="${app.ship ? money(app.ship.effCargo) : S.defaultCargo}" value="${esc(F.cargo)}"></label></div>
    <label class="field">From terminal<input id="f-from" list="dl-terminals" placeholder="Anywhere" value="${esc(F.from)}"></label>
    <label class="field">To terminal<input id="f-to" list="dl-terminals" placeholder="Anywhere" value="${esc(F.to)}"></label>
    <label class="field">Commodity<input id="f-com" list="dl-commodities" placeholder="Any" value="${esc(F.commodity)}"></label>
    <div class="row2"><label class="field">Sort (one-way)<select id="f-sort">${[["profit", "Profit per run"], ["perMin", "Profit per minute"], ["margin", "Margin / SCU"], ["roi", "ROI %"], ["investment", "Cheapest to start"]].map(([v, n]) => `<option value="${v}" ${F.sort === v ? "selected" : ""}>${n}</option>`).join("")}</select></label>
      <label class="field">Multi-stop legs<select id="f-legs">${[2, 3, 4, 5].map((n) => `<option ${F.legs === n ? "selected" : ""}>${n}</option>`).join("")}</select></label></div>
    <div class="card" style="padding:4px 14px">
      ${toggleRow("f-timed", "Distance & time", "Look up distances (slower first time)", F.timed)}
      ${toggleRow("f-illegal", "Illegal cargo", "", F.illegal)}
      ${toggleRow("f-cross", "Cross-system runs", "Through jump points", F.cross)}
      ${toggleRow("f-dock", "Loading dock only", "", F.dock)}
      ${toggleRow("f-oneway", "Include empty return legs", "Round trips", F.oneWay)}
      ${toggleRow("f-all", "Show stale & out of stock", "Ignore freshness filters", F.showAll)}
      ${toggleRow("f-nobox", "Ignore box sizes", "", F.ignoreBoxes)}
    </div>
    <div class="row2"><button class="btn ghost" id="f-reset">Reset</button><button class="btn primary" id="f-apply">Show results</button></div></div>`, (el) => {
    $("#f-apply", el).onclick = () => {
      Object.assign(F, { system: $("#f-sys", el).value, cargo: $("#f-scu", el).value, from: $("#f-from", el).value.trim(), to: $("#f-to", el).value.trim(),
        commodity: $("#f-com", el).value.trim(), sort: $("#f-sort", el).value, legs: +$("#f-legs", el).value, timed: $("#f-timed", el).checked,
        illegal: $("#f-illegal", el).checked, cross: $("#f-cross", el).checked, dock: $("#f-dock", el).checked, oneWay: $("#f-oneway", el).checked,
        showAll: $("#f-all", el).checked, ignoreBoxes: $("#f-nobox", el).checked });
      closeSheet(); render("routes");
    };
    $("#f-reset", el).onclick = () => { Object.assign(F, { system: S.system, sort: "profit", cross: false, illegal: false, dock: false, showAll: false, ignoreBoxes: false, timed: false, from: "", to: "", commodity: "", legs: 3, oneWay: false, cargo: "" }); closeSheet(); render("routes"); };
  });
}

/* --------------------------------------------------------- detail sheets */
function legHtml(kind, p) {
  const buy = kind === "buy";
  return `<div class="leg"><div style="display:flex;justify-content:space-between;align-items:center"><span class="kind ${kind}">${buy ? "Buy" : "Sell"}</span>${lvl(p, kind)}</div>
    <div class="strong" style="margin-top:6px">${esc(p.t.name)}</div><div class="dim" style="font-size:13px">${esc(p.t.location)} · reported ${ago(SCT.age(p))}</div>
    <div class="kv"><div><span>Price / SCU</span><b>${money(buy ? p.buy : p.sell)}</b></div><div><span>${buy ? "Stock" : "Demand"}</span>${money(buy ? p.stock : p.demand)} SCU</div>
      <div><span>Boxes here</span>${p.sizes ? esc(p.sizes) : p.t.maxBox ? "≤ " + p.t.maxBox : "?"} SCU</div><div><span>Loading dock</span>${p.t.dock ? "Yes" : "No"}</div></div></div>`;
}
function routeBlock(r) {
  return `<div class="sum3"><div><span>You spend</span><b>${short(r.invest)}</b></div><div><span>You get back</span><b>${short(r.revenue)}</b></div><div><span>Profit</span><b class="pos">+${short(r.profit)}</b></div></div>
    <h4>Loading plan · ${money(r.scu)} SCU${r.by !== "cargo" ? " (limited by " + r.by + ")" : ""}</h4>
    <div class="boxes">${r.plan.map(([s, n]) => `<div class="box"><b>${n}×</b><span>${s} SCU</span></div>`).join("")}</div>
    <div class="dim" style="font-size:13px;margin-top:8px">${r.boxCount} boxes · ${pct(r.roi)} ROI · ${money(r.margin)}/SCU · <span class="dist" data-a="${r.b.t.id}" data-b="${r.s.t.id}">${r.dist != null ? r.dist.toFixed(1) + " GM · ~" + mins(r.min) : "distance…"}</span></div>
    <div class="calc" data-buy="${r.b.buy}" data-sell="${r.s.sell}" data-cap="${r.cap || r.scu}">
      <b>Investment calculator</b><div class="dim" style="font-size:12.5px">Max ${money(r.cap || r.scu)} SCU · full load ${short((r.cap || r.scu) * r.b.buy)}</div>
      <input class="c-in" inputmode="decimal" value="${money(r.invest)}" style="margin-top:10px">
      <input class="c-sl" type="range" min="1" max="${r.cap || r.scu}" value="${r.scu}">
      <div class="c-out"></div></div>
    ${legHtml("buy", r.b)}${legHtml("sell", r.s)}
    ${r.warn.length ? `<div class="warns">${r.warn.map(esc).join(" · ")}</div>` : ""}`;
}
function wireCalc(root) {
  $$(".calc", root).forEach((c) => {
    const buy = +c.dataset.buy, sell = +c.dataset.sell, cap = +c.dataset.cap;
    const inp = $(".c-in", c), sl = $(".c-sl", c), out = $(".c-out", c);
    const draw = (scu, note = "") => { out.innerHTML = `<div class="flow"><div><span>Spend</span><b>${money(scu * buy)}</b></div><div><span>Get back</span><b>${money(scu * sell)}</b></div><div><span>Profit</span><b class="pos">+${money(scu * (sell - buy))}</b></div></div><div class="dim" style="font-size:12.5px;margin-top:6px">${money(scu)} SCU. ${note}</div>`; };
    const fromMoney = () => { const amt = parseAuec(inp.value), want = Math.floor(amt / buy), scu = Math.max(0, Math.min(cap, want)); sl.value = scu; draw(scu, want > cap ? `Capped by hold/stock - ${money(amt - cap * buy)} aUEC left over.` : ""); };
    inp.oninput = fromMoney; sl.oninput = () => { inp.value = money(sl.value * buy); draw(+sl.value); };
    fromMoney();
  });
}
async function fillDist(root) {
  for (const d of $$(".dist", root)) {
    if (!d.textContent.includes("…")) continue;
    const g = await SCT.distance(+d.dataset.a, +d.dataset.b);
    d.textContent = g == null ? "distance n/a" : g.toFixed(1) + " GM";
  }
}
function routeSheet(r) {
  openSheet(`<h3>${esc(r.commodity)}${illegal(r.illegal)}</h3><div class="lead">${esc(r.b.t.name)} → ${esc(r.s.t.name)}</div>${routeBlock(r)}
    <div class="actions"><button class="btn primary" id="a-log">Log this run</button><button class="btn" id="a-pin">📌 Pin</button>
      <button class="btn" id="a-alert">🔔 Alert me</button><button class="btn ghost" id="a-all">All prices</button></div>`, (el) => {
    wireCalc(el); fillDist(el);
    $("#a-log", el).onclick = () => {
      const scu = +$(".c-sl", el).value || r.scu, t = Date.now() / 1000;
      const tr = list("trades");
      tr.push({ id: uid(), side: "buy", commodity: r.commodity, terminal: r.b.t.name, scu, price: r.b.buy, time: t, ship: S.activeShip });
      tr.push({ id: uid(), side: "sell", commodity: r.commodity, terminal: r.s.t.name, scu, price: r.s.sell, time: t, ship: S.activeShip });
      store.set("trades", tr); toast(`Logged: +${money(scu * r.margin)} aUEC`);
    };
    $("#a-pin", el).onclick = () => {
      const pins = list("pins");
      if (!pins.some((p) => p.from === r.b.t.id && p.to === r.s.t.id && p.cid === r.cid)) pins.push({ id: uid(), from: r.b.t.id, to: r.s.t.id, cid: r.cid, label: r.commodity });
      store.set("pins", pins); toast("Pinned to Home");
    };
    $("#a-alert", el).onclick = () => { alertSheet({ kind: "sell_above", commodity: r.commodity, terminal: r.s.t.name, value: Math.round(r.s.sell * 1.05) }); };
    $("#a-all", el).onclick = () => commoditySheet(r.cid);
  });
}
function loopSheet(t) {
  openSheet(`<h3>Round trip <span class="pos">+${money(t.profit)}</span></h3><div class="lead">${esc(t.out.b.t.name)} ⇄ ${esc(t.out.s.t.name)}</div>
    <h4>Leg 1 · ${esc(t.out.commodity)}</h4>${routeBlock(t.out)}<h4>Leg 2 · ${t.back ? esc(t.back.commodity) : "return empty"}</h4>${t.back ? routeBlock(t.back) : '<p class="dim">No profitable cargo back.</p>'}`, (el) => { wireCalc(el); fillDist(el); });
}
function chainSheet(c) {
  openSheet(`<h3>${c.legs.length}-leg run <span class="pos">+${money(c.profit)}</span></h3><div class="lead">${c.stops.map(esc).join(" → ")}</div>
    ${c.legs.map((r, i) => `<h4>Leg ${i + 1} · ${esc(r.commodity)}</h4>${routeBlock(r)}`).join("")}`, (el) => { wireCalc(el); fillDist(el); });
}
function commoditySheet(cid) {
  const m = app.market, c = m.commodities.get(cid);
  const f = SCT.makeFilters({ showAll: false });
  const rows = m.prices.filter((p) => p.cid === cid && p.t.available);
  const buys = rows.filter((p) => p.buy > 0).sort((a, b) => a.buy - b.buy), sells = rows.filter((p) => p.sell > 0).sort((a, b) => b.sell - a.sell);
  const tbl = (ps, side) => ps.length ? `<table class="mini">${ps.map((p) => `<tr style="${SCT.usable(p, side, f) ? "" : "opacity:.45"}"><td>${esc(p.t.name)}<div class="dim" style="font-size:12px">${esc(p.t.system)}</div></td>
    <td class="r strong">${money(side === "buy" ? p.buy : p.sell)}</td><td class="r">${lvl(p, side)}</td><td class="r">${ageBadge(SCT.age(p))}</td></tr>`).join("")}</table>` : '<p class="dim">None.</p>';
  openSheet(`<h3>${esc(c ? c.name : "Commodity")}${illegal(c && c.illegal)}</h3><div class="lead">${esc(c ? c.kind : "")} · faded rows are stale or out of stock</div>
    <h4>Where to buy</h4>${tbl(buys, "buy")}<h4>Where to sell</h4>${tbl(sells, "sell")}`);
}

/* ------------------------------------------------------------------- sell */
function sell(el) {
  const rows = store.get("sellRows", [["", ""]]);
  el.innerHTML = `<div class="card"><h2>What are you carrying?</h2><div class="stack" id="s-rows"></div>
      <div class="row2" style="margin-top:12px"><button class="btn ghost" id="s-add">+ Add item</button><button class="btn primary" id="s-go">Where to sell</button></div>
      <div class="toggle" style="margin-top:8px"><div><b>Include stale & full</b><span>Old prices and full terminals</span></div>${sw("s-all", false)}</div>
      <p class="hint">Trade goods, mined ore (pick the "(Raw)" version), salvage or mission cargo.</p></div>
    <div class="stack" id="s-res"></div>`;
  const box = $("#s-rows", el);
  const addRow = (c = "", n = "") => {
    const d = document.createElement("div"); d.className = "sell-row";
    d.innerHTML = `<input class="sc" list="dl-commodities" placeholder="Commodity" value="${esc(c)}"><input class="sn" type="number" inputmode="numeric" placeholder="SCU" value="${esc(n)}"><button class="x">✕</button>`;
    $(".x", d).onclick = () => { d.remove(); save(); if (!$$(".sell-row", box).length) addRow(); };
    $$("input", d).forEach((i) => i.onchange = save);
    box.appendChild(d);
  };
  const save = () => store.set("sellRows", $$(".sell-row", box).map((r) => [$(".sc", r).value, $(".sn", r).value]));
  rows.forEach(([c, n]) => addRow(c, n));
  $("#s-add", el).onclick = () => { addRow(); $$(".sc", box).pop().focus(); };
  const run = () => {
    save();
    const items = $$(".sell-row", box).map((r) => ({ commodity: $(".sc", r).value.trim(), scu: +$(".sn", r).value })).filter((i) => i.commodity && i.scu > 0);
    const res = $("#s-res", el);
    if (!items.length) { res.innerHTML = ""; return; }
    const d = SCT.sellPlan(app.market, items, app.filters.system, $("#s-all", el).checked);
    const stops = d.stops.filter((s) => s.of > 1);
    res.innerHTML = `<div class="kpis"><div class="kpi accent"><div class="k">Best total</div><div class="v">${short(d.bestTotal)}</div><div class="s">each item at its best place</div></div>
      ${stops[0] ? `<div class="kpi"><div class="k">Best one stop</div><div class="v">${short(stops[0].value)}</div><div class="s">${esc(stops[0].t.name)} · ${stops[0].covers}/${stops[0].of}</div></div>` : ""}</div>
      ${d.items.map((it) => `<div class="card flush"><div class="item"><div class="t">${esc(it.commodity)} · ${money(it.scu)} SCU
          ${(it.variants || []).length ? `<div class="sub">Other form: ${it.variants.map((v) => `<a href="#" data-var="${esc(it.asked)}" data-to="${esc(v)}">${esc(v)}</a>`).join(", ")}</div>` : ""}</div>
          <div class="val">${it.error ? '<span class="neg">' + esc(it.error) + "</span>" : it.options.length + "<small>places</small>"}</div></div>
        ${it.options.map((o) => `<div class="item"><div class="t" style="font-weight:600">${esc(o.p.t.name)}${o.p.raw ? ' <span class="pill">raw</span>' : ""}<div class="sub">${money(o.p.sell)}/SCU · takes ${money(o.takes)}${o.partial ? ' <span style="color:#fcd34d">(not all)</span>' : ""} · ${ageBadge(SCT.age(o.p))}</div></div>
          <div class="val pos">${short(o.value)}<small>${lvl(o.p, "sell")}</small></div></div>`).join("")}
        ${!it.error && !it.options.length ? empty("Nowhere is buying this right now") : ""}</div>`).join("")}`;
    $$("[data-var]", res).forEach((a) => a.onclick = (e) => {
      e.preventDefault();
      const r = $$(".sell-row", box).find((x) => $(".sc", x).value.trim().toLowerCase() === a.dataset.var.toLowerCase());
      if (r) { $(".sc", r).value = a.dataset.to; run(); }
    });
  };
  $("#s-go", el).onclick = run; $("#s-all", el).onchange = run;
  if (rows.some(([c, n]) => c && n)) run();
}

/* ------------------------------------------------------------------ ships */
function ships(el) {
  const s = app.ship;
  el.innerHTML = `${s ? `<div class="card ship-hero"><div class="dim" style="font-size:12px;text-transform:uppercase;letter-spacing:.6px;font-weight:700">You're flying</div>
      <h2>${esc(s.name)}</h2><div class="muted" style="font-size:13.5px">${esc(s.maker)}${s.role ? " · " + esc(s.role) : ""}</div>
      <div class="stats"><div><span>Cargo</span><b>${money(s.effCargo)}</b></div><div><span>Biggest box</span><b>${s.maxBox || "?"}</b></div><div><span>Pad</span><b>${esc(s.pad || "–")}</b></div></div>
      <div class="sizes">${(s.boxes || SCT.STD_BOXES).map((b) => `<i>${b}</i>`).join("")}</div>
      ${s.dockOnly ? '<p class="hint" style="margin-top:8px">Loading docks only</p>' : ""}
      <h4 style="margin:16px 0 8px;font-size:12.5px;color:var(--muted);text-transform:uppercase">Adjust for your setup</h4>
      <div class="row2"><label class="field">Cargo SCU<input id="o-c" type="number" inputmode="numeric" placeholder="${money(s.cargo)}" value="${s.cargoOverride || ""}"></label>
        <label class="field">Biggest box<select id="o-b"><option value="">Default${s.sizes.length ? " (" + Math.max(...s.sizes) + ")" : ""}</option>${SCT.STD_BOXES.map((b) => `<option ${s.boxOverride === b ? "selected" : ""}>${b}</option>`).join("")}</select></label></div>
      <button class="btn block" id="o-save" style="margin-top:10px">Save</button></div>`
    : `<div class="banner"><b>Which ship are you flying?</b> Tap one below.</div>`}
    <input id="sh-q" placeholder="Search ships…" autocomplete="off">
    <div class="card flush"><div class="list" id="sh-list"></div></div>`;
  const all = app.ships.filter((x) => x.effCargo > 0);
  const draw = () => {
    const q = $("#sh-q", el).value.toLowerCase();
    const rows = all.filter((x) => !q || (x.name + " " + x.maker).toLowerCase().includes(q)).sort((a, b) => (b.isNew - a.isNew) || (a.concept - b.concept) || b.effCargo - a.effCargo);
    $("#sh-list", el).innerHTML = rows.map((x) => `<div class="item tap" data-n="${esc(x.name)}" style="${x.concept ? "opacity:.5" : ""}">
      <div class="t">${esc(x.name)}${x.isNew ? '<span class="tag new">NEW</span>' : ""}${x.name === S.activeShip ? '<span class="tag fly">FLYING</span>' : ""}<div class="sub">${esc(x.maker)}${x.concept ? " · concept" : ""}${x.speed ? " · " + money(x.speed) + " m/s" : ""}</div></div>
      <div class="val">${money(x.effCargo)}<small>SCU · box ≤${x.maxBox || "?"}</small></div></div>`).join("") || empty("No ships match");
    $$("[data-n]", el).forEach((r) => r.onclick = () => { const sh = app.ships.find((z) => z.name === r.dataset.n); if (sh && sh.concept) return toast("That ship isn't in the live game yet"); setShip(r.dataset.n); });
  };
  $("#sh-q", el).oninput = draw; draw();
  const sv = $("#o-save", el);
  if (sv) sv.onclick = () => {
    const ov = { ...S.overrides };
    const c = +$("#o-c", el).value || null, b = +$("#o-b", el).value || null;
    if (c || b) ov[s.name] = { cargo: c, maxBox: b }; else delete ov[s.name];
    SCT.saveSettings({ overrides: ov }); toast("Saved"); load(false);
  };
}

/* ------------------------------------------------------------------- more */
const ICONS = {
  commodities: '<path d="M12 2l9 5v10l-9 5-9-5V7zm0 2.3L5.5 8 12 11.7 18.5 8z"/>', stock: '<path d="M4 20V10h3v10zm6.5 0V4h3v16zM17 20v-7h3v7z"/>',
  terminal: '<path d="M12 2a7 7 0 017 7c0 5-7 13-7 13S5 14 5 9a7 7 0 017-7zm0 4.5A2.5 2.5 0 1012 11.5 2.5 2.5 0 0012 6.5z"/>',
  log: '<path d="M5 3h11l3 3v15H5zm3 6h8v2H8zm0 4h8v2H8zm0 4h5v2H8z"/>',
  alerts: '<path d="M12 22a2.5 2.5 0 002.4-2h-4.8a2.5 2.5 0 002.4 2zm7-5l-2-2v-4a5 5 0 00-4-4.9V5a1 1 0 00-2 0v1.1A5 5 0 007 11v4l-2 2v1h14z"/>',
  settings: '<path d="M12 8.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7zm8.6 5.2l1.9 1.5-2 3.4-2.3-.9a7.6 7.6 0 01-2.2 1.3L15.6 22h-4l-.4-2.5a7.6 7.6 0 01-2.2-1.3l-2.3.9-2-3.4 1.9-1.5a7.7 7.7 0 010-2.6L4.7 9.4l2-3.4 2.3.9a7.6 7.6 0 012.2-1.3L11.6 3h4l.4 2.6a7.6 7.6 0 012.2 1.3l2.3-.9 2 3.4-1.9 1.5a7.7 7.7 0 010 2.6z"/>',
  about: '<path d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 15h-2v-6h2zm0-8h-2V7h2z"/>',
};
function more(el) {
  const hits = list("alerts").filter((a) => a.hit).length;
  const items = [["commodities", "Commodities", "Best buy & sell for everything"], ["stock", "Stock levels", "Scarce or plentiful"],
    ["terminal", "Terminals", "What a terminal buys and sells"], ["log", "Trade log", "Your profit history"],
    ["alerts", "Price alerts", hits ? `${hits} triggered` : "Get notified on targets"], ["settings", "Settings", "Freshness, sound, travel times"],
    ["about", "About & connection", "Data sources, relay, created by Mossy"]];
  el.innerHTML = `<div class="card flush menu"><div class="list">${items.map(([k, t, s]) => `<div class="item tap" data-go="${k}">
    <div class="ic"><svg viewBox="0 0 24 24">${ICONS[k]}</svg></div><div class="t">${t}<div class="sub">${s}</div></div><div class="chev">›</div></div>`).join("")}</div></div>
    <div class="credit">Star Citizen Trading · Created by Mossy</div>`;
  $$("[data-go]", el).forEach((r) => r.onclick = () => go(r.dataset.go));
}
function commodities(el) {
  const m = app.market, f = SCT.makeFilters({});
  el.innerHTML = `<input id="c-q" placeholder="Search commodities…" autocomplete="off"><div class="card flush"><div class="list" id="c-list"></div></div>`;
  const rows = [...m.commodities.values()].map((c) => {
    const ps = m.prices.filter((p) => p.cid === c.id);
    const b = ps.filter((p) => p.buy > 0 && SCT.usable(p, "buy", f)).sort((x, y) => x.buy - y.buy)[0];
    const s = ps.filter((p) => p.sell > 0 && SCT.usable(p, "sell", f)).sort((x, y) => y.sell - x.sell)[0];
    return { c, b, s, margin: b && s ? s.sell - b.buy : null };
  }).filter((r) => r.b || r.s).sort((x, y) => (y.margin ?? -1e12) - (x.margin ?? -1e12));
  const draw = () => {
    const q = $("#c-q", el).value.toLowerCase();
    $("#c-list", el).innerHTML = rows.filter((r) => !q || r.c.name.toLowerCase().includes(q) || r.c.code.toLowerCase().includes(q)).map((r) => `<div class="item tap" data-c="${r.c.id}">
      <div class="t">${esc(r.c.name)}${illegal(r.c.illegal)}<div class="sub">${r.b ? "buy " + money(r.b.buy) + " · " + esc(r.b.t.name) : "not sold"}<br>${r.s ? "sell " + money(r.s.sell) + " · " + esc(r.s.t.name) : "not bought"}</div></div>
      <div class="val ${r.margin > 0 ? "pos" : ""}">${r.margin == null ? "–" : money(r.margin)}<small>margin</small></div></div>`).join("") || empty("Nothing matches");
    $$("[data-c]", el).forEach((x) => x.onclick = () => commoditySheet(+x.dataset.c));
  };
  $("#c-q", el).oninput = draw; draw();
}
function stock(el) {
  const m = app.market;
  el.innerHTML = `<div class="seg" id="ss"><button data-v="buy">Where I buy</button><button data-v="sell">Where I sell</button></div>
    <div class="seg" id="sl"><button data-v="low">Low</button><button data-v="high">High</button></div><div class="note" id="s-note"></div>
    <div class="card flush"><div class="list" id="s-list"></div></div>`;
  const draw = () => {
    const side = app.stockSide, lv = app.stockLevel, buy = side === "buy";
    $$("#ss button", el).forEach((b) => b.classList.toggle("on", b.dataset.v === side));
    $$("#sl button", el).forEach((b) => b.classList.toggle("on", b.dataset.v === lv));
    $("#s-note", el).textContent = { "buy-low": "Stock running out - you may not fill your hold.", "buy-high": "Plenty to buy - good places to fill up.",
      "sell-low": "Low inventory - they want this cargo.", "sell-high": "Full or nearly full - prices may drop." }[side + "-" + lv];
    const sys = app.filters.system;
    const rows = m.prices.filter((p) => (buy ? p.buy > 0 && p.sb != null : p.sell > 0 && p.ss != null) && p.t.available && (sys === "all" || !sys || p.t.system === sys))
      .filter((p) => { const st = buy ? p.sb : p.ss; return lv === "low" ? st <= 3 : st >= 5; })
      .sort((a, b) => (buy ? a.sb - b.sb : a.ss - b.ss) * (lv === "low" ? 1 : -1)).slice(0, 150);
    $("#s-list", el).innerHTML = rows.map((p) => `<div class="item tap" data-c="${p.cid}"><div class="t">${esc(p.commodity)}${illegal(p.illegal)}<div class="sub">${esc(p.t.name)} · ${ageBadge(SCT.age(p))}</div></div>
      <div class="val">${money(buy ? p.buy : p.sell)}<small>${lvl(p, side)}</small></div></div>`).join("") || empty("Nothing to show");
    $$("[data-c]", el).forEach((x) => x.onclick = () => commoditySheet(+x.dataset.c));
  };
  $$("#ss button", el).forEach((b) => b.onclick = () => { app.stockSide = b.dataset.v; draw(); });
  $$("#sl button", el).forEach((b) => b.onclick = () => { app.stockLevel = b.dataset.v; draw(); });
  draw();
}
function terminal(el) {
  el.innerHTML = `<input id="t-q" list="dl-terminals" placeholder="Terminal name, e.g. Area18" autocomplete="off"><div id="t-res"></div>`;
  const run = () => {
    const ts = SCT.findTerminals(app.market, $("#t-q", el).value);
    const res = $("#t-res", el);
    if (!ts.length) { res.innerHTML = $("#t-q", el).value ? `<div class="card">${empty("No terminal found")}</div>` : ""; return; }
    const t = ts[0], ps = app.market.prices.filter((p) => p.t.id === t.id).sort((a, b) => a.commodity.localeCompare(b.commodity));
    const fit = app.ship && app.ship.maxBox && t.maxBox ? (t.maxBox >= app.ship.maxBox ? '<span class="badge lv6">Your boxes fit</span>' : `<span class="badge lv3">Max ${t.maxBox} SCU boxes</span>`) : "";
    res.innerHTML = `<div class="card"><h2>${esc(t.name)}</h2><div class="muted" style="font-size:13.5px">${esc(t.location)} · max box ${t.maxBox || "?"} SCU · dock ${t.dock ? "yes" : "no"} ${fit}</div></div>
      <div class="card flush" style="margin-top:12px"><div class="list">${ps.map((p) => `<div class="item tap" data-c="${p.cid}"><div class="t">${esc(p.commodity)}${illegal(p.illegal)}<div class="sub">${p.buy > 0 ? "buy " + money(p.buy) + " " : ""}${p.sell > 0 ? "sell " + money(p.sell) + " " : ""}${ageBadge(SCT.age(p))}</div></div>
        <div class="val">${p.buy > 0 ? lvl(p, "buy") : lvl(p, "sell")}</div></div>`).join("")}</div></div>`;
    $$("[data-c]", res).forEach((x) => x.onclick = () => commoditySheet(+x.dataset.c));
  };
  $("#t-q", el).onchange = run; $("#t-q", el).onkeydown = (e) => e.key === "Enter" && run();
}

/* -------------------------------------------------------------- trade log */
function tradeLog(el) {
  const trades = list("trades").sort((a, b) => b.time - a.time);
  const sum = (ts) => ts.reduce((a, t) => a + (t.side === "sell" ? 1 : -1) * t.scu * t.price, 0);
  const day = new Date().setHours(0, 0, 0, 0) / 1000;
  const sgn = (n) => (n < 0 ? "−" : "+") + short(Math.abs(n));
  el.innerHTML = `<div class="kpis"><div class="kpi accent"><div class="k">Today</div><div class="v">${sgn(sum(trades.filter((t) => t.time >= day)))}</div><div class="s">aUEC</div></div>
    <div class="kpi"><div class="k">All time</div><div class="v">${sgn(sum(trades))}</div><div class="s">${trades.length} trades</div></div></div>
    <div class="card"><h2>Log a trade</h2><div class="seg" id="l-side"><button data-v="buy" class="on">Bought</button><button data-v="sell">Sold</button></div>
      <div class="stack" style="margin-top:12px"><input id="l-c" list="dl-commodities" placeholder="Commodity"><input id="l-t" list="dl-terminals" placeholder="Terminal (optional)">
      <div class="row2"><input id="l-n" type="number" inputmode="numeric" placeholder="SCU"><input id="l-p" type="number" inputmode="decimal" placeholder="Price / SCU"></div>
      <button class="btn primary block" id="l-add">Add</button></div></div>
    <div class="card flush"><div class="list">${trades.map((t) => `<div class="item"><div class="t">${t.side === "buy" ? '<span class="badge lv4">Bought</span>' : '<span class="badge lv6">Sold</span>'} ${esc(t.commodity)}
      <div class="sub">${money(t.scu)} SCU × ${money(t.price)}${t.terminal ? " · " + esc(t.terminal) : ""} · ${new Date(t.time * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div></div>
      <div class="val ${t.side === "sell" ? "pos" : "neg"}">${t.side === "sell" ? "+" : "−"}${short(t.scu * t.price)}<small><a href="#" data-del="${t.id}">delete</a></small></div></div>`).join("") || empty("No trades yet", "Add one above, or tap 'Log this run' on any route.")}</div></div>`;
  let side = "buy";
  $$("#l-side button", el).forEach((b) => b.onclick = () => { side = b.dataset.v; $$("#l-side button", el).forEach((x) => x.classList.toggle("on", x === b)); });
  $("#l-add", el).onclick = () => {
    const c = $("#l-c", el).value.trim(), n = +$("#l-n", el).value, p = +$("#l-p", el).value;
    if (!c || !n || !p) return toast("Fill in commodity, SCU and price", true);
    store.set("trades", [...list("trades"), { id: uid(), side, commodity: c, terminal: $("#l-t", el).value.trim(), scu: n, price: p, time: Date.now() / 1000, ship: S.activeShip }]);
    toast("Trade logged"); tradeLog(el);
  };
  $$("[data-del]", el).forEach((a) => a.onclick = (e) => { e.preventDefault(); store.set("trades", list("trades").filter((t) => t.id !== a.dataset.del)); tradeLog(el); });
}

/* ----------------------------------------------------------------- alerts */
function checkAlerts() {
  if (!app.market) return;
  const as = list("alerts");
  for (const a of as) {
    const { value, where } = SCT.evalAlert(app.market, a, app.ship);
    const hit = value != null && (a.kind === "buy_below" ? value <= a.value : value >= a.value);
    if (hit && !a.hit) { a.lastHit = Date.now() / 1000; notify(`${a.commodity || "Trade"} alert`, `${SCT.ALERT_KINDS[a.kind]} ${money(a.value)}: now ${money(value)} (${where})`); }
    Object.assign(a, { current: value, where, hit });
  }
  store.set("alerts", as);
}
function alertSheet(pre = {}) {
  openSheet(`<h3>New alert</h3><div class="stack" style="margin-top:12px">
    <label class="field">When<select id="a-k">${Object.entries(SCT.ALERT_KINDS).map(([k, v]) => `<option value="${k}" ${pre.kind === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
    <input id="a-c" list="dl-commodities" placeholder="Commodity (any for 'best run')" value="${esc(pre.commodity || "")}">
    <input id="a-t" list="dl-terminals" placeholder="Terminal (optional)" value="${esc(pre.terminal || "")}">
    <input id="a-v" type="number" inputmode="numeric" placeholder="Value (aUEC)" value="${pre.value || ""}">
    <button class="btn primary block" id="a-save">Add alert</button></div>`, (el) => {
    $("#a-save", el).onclick = async () => {
      const a = { id: uid(), kind: $("#a-k", el).value, commodity: $("#a-c", el).value.trim(), terminal: $("#a-t", el).value.trim(), value: +$("#a-v", el).value, system: app.filters.system === "all" ? "" : app.filters.system };
      if (!a.value) return toast("Enter a value", true);
      if (a.kind !== "route_above" && !a.commodity) return toast("Pick a commodity", true);
      store.set("alerts", [...list("alerts"), a]);
      closeSheet(false); checkAlerts(); header(); go("alerts");
      toast("Alert added");
      // ask for notification permission afterwards - never block saving on it
      if ("Notification" in window && Notification.permission === "default") { try { Notification.requestPermission(); } catch { /* ignore */ } }
    };
  });
}
function alerts(el) {
  const as = list("alerts");
  el.innerHTML = `<button class="btn primary block" id="al-new">+ New alert</button>
    <p class="hint">Checked whenever prices update while the app is open (auto-refresh every ${S.autoRefreshMin || "–"} min). Phones don't let web apps check while they're closed.</p>
    <div class="card flush"><div class="list">${as.map((a) => `<div class="item"><div class="t">${a.hit ? '<span class="badge lv6">Triggered</span>' : '<span class="badge lvx">Watching</span>'} ${esc(a.commodity || "Any")}
      <div class="sub">${esc(SCT.ALERT_KINDS[a.kind])} <b>${money(a.value)}</b>${a.terminal ? " · " + esc(a.terminal) : ""}<br>now ${money(a.current)} ${a.where ? "· " + esc(a.where) : ""}</div></div>
      <div class="val"><a href="#" data-del="${a.id}">delete</a></div></div>`).join("") || empty("No alerts yet", "Example: Laranite sells for 3,200 or more.")}</div></div>`;
  $("#al-new", el).onclick = () => alertSheet();
  $$("[data-del]", el).forEach((a) => a.onclick = (e) => { e.preventDefault(); store.set("alerts", list("alerts").filter((x) => x.id !== a.dataset.del)); alerts(el); header(); });
}

/* --------------------------------------------------------------- settings */
function settings(el) {
  el.innerHTML = `<div class="card" style="padding:6px 16px"><h2 style="margin-top:10px">Price freshness</h2>
      <label class="field" style="margin-bottom:10px">Hide prices older than<select id="st-age">${[[6, "6 hours"], [12, "12 hours"], [24, "24 hours"], [48, "2 days"], [72, "3 days"], [0, "Don't hide"]].map(([v, n]) => `<option value="${v}" ${S.maxAgeHours === v ? "selected" : ""}>${n}</option>`).join("")}</select></label>
      ${toggleRow("st-oos", "Skip out-of-stock terminals", "When buying", S.hideOutOfStock)}${toggleRow("st-full", "Skip full terminals", "When selling", S.hideFull)}</div>
    <div class="card" style="padding:6px 16px"><h2 style="margin-top:10px">Alerts</h2>
      ${toggleRow("st-sound", "Chime", "For alerts, new patches, new ships", S.sound)}
      <input type="range" id="st-vol" min="0" max="1" step="0.05" value="${S.volume}"><button class="btn small" id="st-test" style="margin:4px 0 10px">Test sound</button>
      ${toggleRow("st-vib", "Vibrate", "", S.vibrate)}
      <label class="field" style="margin:10px 0 12px">Auto-refresh while open<select id="st-auto">${[[0, "Off"], [15, "Every 15 min"], [30, "Every 30 min"], [60, "Every hour"]].map(([v, n]) => `<option value="${v}" ${S.autoRefreshMin === v ? "selected" : ""}>${n}</option>`).join("")}</select></label></div>
    <div class="card"><h2>Travel-time estimates</h2><div class="stack">
      <label class="field">Quantum speed (km/s)<input id="st-qt" type="number" inputmode="numeric" value="${S.qtSpeed}"></label>
      <div class="row2"><label class="field">Minutes per stop<input id="st-stop" type="number" inputmode="decimal" value="${S.stopMinutes}"></label>
      <label class="field">Seconds per box<input id="st-box" type="number" inputmode="decimal" value="${S.boxSeconds}"></label></div>
      <label class="field">Default system<select id="st-sys">${(app.market ? app.market.systems : [S.system]).map((s) => `<option ${S.system === s ? "selected" : ""}>${esc(s)}</option>`).join("")}<option value="all" ${S.system === "all" ? "selected" : ""}>All systems</option></select></label></div></div>
    <button class="btn primary block" id="st-save">Save settings</button>
    <button class="btn ghost block" id="st-clear">Clear saved price data</button>`;
  $("#st-test", el).onclick = () => chime(+$("#st-vol", el).value);
  $("#st-save", el).onclick = () => {
    SCT.saveSettings({ maxAgeHours: +$("#st-age", el).value, hideOutOfStock: $("#st-oos", el).checked, hideFull: $("#st-full", el).checked,
      sound: $("#st-sound", el).checked, volume: +$("#st-vol", el).value, vibrate: $("#st-vib", el).checked, autoRefreshMin: +$("#st-auto", el).value,
      qtSpeed: +$("#st-qt", el).value || 200000, stopMinutes: +$("#st-stop", el).value, boxSeconds: +$("#st-box", el).value, system: $("#st-sys", el).value });
    app.filters.system = S.system; toast("Settings saved"); checkAlerts();
  };
  $("#st-clear", el).onclick = async () => { await SCT.clearCache(); toast("Saved data cleared - downloading fresh"); load(true); };
}

/* ------------------------------------------------------------------ about */
function about(el) {
  const st = SCT.status;
  const dot = (x) => `<span class="dot ${x.state}"></span>`;
  el.innerHTML = `<div class="card"><h2>Data sources</h2>
      <div class="src">${dot(st.uex)}<div><b>UEX Corp</b><div class="dim" style="font-size:13px">${esc(st.uex.msg || "Waiting")}${app.error ? " · " + esc(app.error.message) : ""}</div></div></div>
      <div class="src">${dot(st.fleetyards)}<div><b>FleetYards</b><div class="dim" style="font-size:13px">${esc(st.fleetyards.msg || "Waiting")}</div></div></div>
      <button class="btn block" id="ab-check" style="margin-top:10px">Run connection check</button><div id="ab-res" style="margin-top:10px"></div></div>
    <div class="card"><h2>Relay (only if needed)</h2>
      <p class="hint" style="margin-bottom:10px">Some sites block phone apps from reading their data directly. If the check above says UEX is blocked, set up the free relay (INSTALL.md, step 4) and paste its address here.</p>
      <input id="ab-relay" placeholder="https://sct-relay.yourname.workers.dev" value="${esc(S.relay)}" autocomplete="off" autocapitalize="off">
      <label class="field" style="margin-top:10px">UEX API token (optional)<input id="ab-tok" type="password" value="${esc(S.uexToken)}" autocomplete="off"></label>
      ${toggleRow("ab-fy", "Use FleetYards", "Ship speed & role (optional)", S.useFleetYards)}
      <button class="btn primary block" id="ab-save" style="margin-top:6px">Save & reload data</button></div>
    <div class="card"><h2>Star Citizen Trading</h2><p class="muted" style="margin:0">Created by Mossy. Unofficial fan app, not affiliated with Cloud Imperium Games.</p>
      <p class="hint" style="margin-top:8px">Data: UEX Corp (uexcorp.space) and FleetYards (fleetyards.net). Prices are player-reported estimates. Check in game before you buy.</p></div>`;
  $("#ab-check", el).onclick = async () => {
    const r = $("#ab-res", el); r.innerHTML = '<div class="skel" style="height:44px"></div>';
    const c = await SCT.connectionCheck();
    r.innerHTML = c.direct ? `<div class="banner"><b style="color:#86efac">✓ UEX works directly from this phone.</b> No relay needed.</div>`
      : c.relay ? `<div class="banner"><b style="color:#86efac">✓ UEX works through your relay.</b></div>`
      : `<div class="banner err"><b>UEX is blocked from this phone${S.relay ? " and the relay didn't answer" : ""}.</b> Set up the free relay (INSTALL.md step 4, about 5 minutes on your PC), then paste its address below.</div>`;
  };
  $("#ab-save", el).onclick = async () => {
    SCT.saveSettings({ relay: $("#ab-relay", el).value.trim(), uexToken: $("#ab-tok", el).value.trim(), useFleetYards: $("#ab-fy", el).checked });
    SCT.status.via = ""; await SCT.clearCache(); toast("Saved - reloading data"); await load(true); about(el);
  };
}

/* ------------------------------------------------------------------- boot */
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
history.replaceState({ page: location.hash.slice(1) || "home" }, "", location.hash || "#home");
go(location.hash.slice(1) || "home", false);
header();
load(false);
