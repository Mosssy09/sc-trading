/* Star Citizen Trading (mobile) - data + trade engine. No DOM code here.
   Data: UEX Corp API 2.0 (prices, terminals, ships, versions) + FleetYards (ship speed, optional). */
"use strict";

const SCT = (() => {
  const UEX_BASES = ["https://api.uexcorp.uk/2.0", "https://api.uexcorp.space/2.0"];
  const FY_BASE = "https://api.fleetyards.net/v1";
  const STD_BOXES = [1, 2, 4, 8, 16, 24, 32];
  const TTL = {            // seconds a cached download stays fresh
    commodities_prices_all: 1800, commodities_raw_prices_all: 1800,
    commodities: 43200, terminals: 43200, vehicles: 21600, game_versions: 3600,
    commodities_status: 86400, terminals_distances: 604800, fleetyards: 86400,
  };
  const CACHE = "sct-data-v1";
  const now = () => Date.now() / 1000;

  /* ------------------------------------------------------------ settings */
  const DEFAULTS = {
    activeShip: "", overrides: {}, budget: 0, defaultCargo: 96, system: "Stanton",
    maxAgeHours: 24, hideOutOfStock: true, hideFull: true,
    sound: true, volume: 0.6, vibrate: true,
    qtSpeed: 200000, stopMinutes: 5, boxSeconds: 4,
    autoRefreshMin: 30, relay: "", uexToken: "", useFleetYards: true,
    lastLive: "",
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem("sct." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("sct." + k, JSON.stringify(v)); } catch { /* full or blocked */ } },
  };
  const settings = Object.assign({}, DEFAULTS, store.get("settings", {}));
  function saveSettings(changes) { Object.assign(settings, changes || {}); store.set("settings", settings); }

  /* -------------------------------------------------------------- network */
  const status = { uex: { state: "idle", msg: "" }, fleetyards: { state: "idle", msg: "" }, via: "" };

  function viaRelay(url) {
    const r = (settings.relay || "").trim().replace(/\/+$/, "");
    return r ? `${r}/?url=${encodeURIComponent(url)}` : null;
  }

  async function cacheGet(key) {
    try {
      const c = await caches.open(CACHE);
      const res = await c.match(key);
      if (!res) return null;
      return await res.json();             // {saved, data}
    } catch { return null; }
  }
  async function cachePut(key, data) {
    try {
      const c = await caches.open(CACHE);
      await c.put(key, new Response(JSON.stringify({ saved: now(), data }), { headers: { "Content-Type": "application/json" } }));
    } catch { /* storage unavailable */ }
  }

  async function fetchJSON(url, timeoutMs = 25000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const headers = { Accept: "application/json" };
      if (settings.uexToken && url.includes("uexcorp")) headers.Authorization = "Bearer " + settings.uexToken;
      const res = await fetch(url, { headers, signal: ctl.signal, cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } finally { clearTimeout(t); }
  }

  /* Try the relay (if set) then every base URL directly. Remember what worked. */
  async function getUEX(resource, params = {}, { force = false, ttlKey } = {}) {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== "")).toString();
    const key = `https://sct.cache/uex/${resource}${qs ? "?" + qs : ""}`;
    const cached = await cacheGet(key);
    const ttl = TTL[ttlKey || resource] || 1800;
    if (cached && !force && now() - cached.saved < ttl) return { data: cached.data, saved: cached.saved, cached: true };
    const errors = [];
    const attempts = [];
    for (const base of UEX_BASES) {
      const direct = `${base}/${resource}${qs ? "?" + qs : ""}`;
      const relayed = viaRelay(direct);
      if (status.via === "relay" && relayed) attempts.push(["relay", relayed]);
      attempts.push(["direct", direct]);
      if (relayed && status.via !== "relay") attempts.push(["relay", relayed]);
    }
    for (const [how, url] of attempts) {
      try {
        const payload = await fetchJSON(url);
        if (payload && payload.status && payload.status !== "ok") throw new Error("UEX said " + payload.status);
        const data = payload && Object.prototype.hasOwnProperty.call(payload, "data") ? payload.data : payload;
        status.via = how;
        await cachePut(key, data);
        return { data, saved: now(), cached: false };
      } catch (e) {
        errors.push(`${how}: ${e.name === "TypeError" ? "blocked or offline" : e.message}`);
      }
    }
    if (cached) return { data: cached.data, saved: cached.saved, cached: true, stale: true, error: errors.join("; ") };
    const err = new Error("Couldn't reach UEX (" + [...new Set(errors)].join("; ") + ")");
    err.blocked = errors.some((x) => x.includes("blocked"));
    throw err;
  }

  async function getFleetYards(force) {
    const key = "https://sct.cache/fleetyards/models";
    const cached = await cacheGet(key);
    if (cached && !force && now() - cached.saved < TTL.fleetyards) return cached.data;
    const out = [];
    try {
      for (let page = 1; page <= 15; page++) {
        const url = `${FY_BASE}/models?page=${page}&perPage=200`;
        let batch;
        try { batch = await fetchJSON(url); }
        catch (e) { const r = viaRelay(url); if (!r) throw e; batch = await fetchJSON(r); }
        if (batch && !Array.isArray(batch)) batch = batch.items || batch.data || [];
        if (!batch || !batch.length) break;
        out.push(...batch);
        if (batch.length < 200) break;
      }
      await cachePut(key, out);
      return out;
    } catch (e) {
      if (cached) return cached.data;
      throw e;
    }
  }

  /* --------------------------------------------------------------- market */
  const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
  const int = (v) => { const n = parseInt(v, 10); return isNaN(n) ? null : n; };
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  const DEFAULT_STATUS = { 1: "Out of stock", 2: "Very low", 3: "Low", 4: "Medium", 5: "High", 6: "Very high", 7: "Maximum" };

  function terminalFrom(t) {
    const loc = [t.star_system_name, t.planet_name || t.orbit_name, t.moon_name].filter(Boolean).join(" › ");
    return {
      id: int(t.id), name: t.name || t.displayname || "Terminal " + t.id, code: t.code || "",
      system: t.star_system_name || "", location: loc, maxBox: int(t.max_container_size || t.mcs),
      available: (t.is_available ?? 1) != 0 && (t.is_available_live ?? 1) != 0,
      playerOwned: !!+t.is_player_owned,
      dock: !!(+t.has_loading_dock || +t.has_docking_port || +t.is_auto_load),
    };
  }

  function buildMarket({ commodities, terminals, prices, rawPrices, rawTerminals, statuses }) {
    const m = { commodities: new Map(), terminals: new Map(), prices: [], statusNames: { ...DEFAULT_STATUS } };
    for (const c of commodities || []) {
      m.commodities.set(int(c.id), { id: int(c.id), name: c.name || "", code: c.code || "", kind: c.kind || "",
        illegal: !!+c.is_illegal, avgBuy: num(c.price_buy), avgSell: num(c.price_sell) });
    }
    for (const t of terminals || []) m.terminals.set(int(t.id), terminalFrom(t));
    for (const t of rawTerminals || []) if (t && !m.terminals.has(int(t.id))) m.terminals.set(int(t.id), terminalFrom(t));
    const items = [];
    if (Array.isArray(statuses)) items.push(...statuses);
    else if (statuses && typeof statuses === "object") Object.values(statuses).forEach((v) => Array.isArray(v) && items.push(...v));
    const seen = new Set();
    for (const it of items) { const c = int(it && it.code); if (c != null && it.name && !seen.has(c)) { m.statusNames[c] = it.name; seen.add(c); } }

    const add = (p, raw) => {
      const tid = int(p.id_terminal), cid = int(p.id_commodity);
      if (tid == null || cid == null) return;
      let t = m.terminals.get(tid);
      if (!t) { t = terminalFrom({ id: tid, name: p.terminal_name, star_system_name: p.star_system_name, planet_name: p.planet_name }); m.terminals.set(tid, t); }
      const com = m.commodities.get(cid);
      m.prices.push({
        cid, commodity: p.commodity_name || (com ? com.name : String(cid)), t,
        buy: num(p.price_buy), sell: num(p.price_sell), stock: num(p.scu_buy), demand: num(p.scu_sell),
        inventory: num(p.scu_sell_stock), sb: int(p.status_buy), ss: int(p.status_sell),
        buyAvg: num(p.price_buy_avg), sellAvg: num(p.price_sell_avg), sizes: p.container_sizes || "",
        mod: int(p.date_modified), illegal: com ? com.illegal : false, raw,
      });
    };
    (prices || []).forEach((p) => p && add(p, false));
    (rawPrices || []).forEach((p) => p && add(p, true));
    m.systems = [...new Set([...m.terminals.values()].map((t) => t.system).filter(Boolean))].sort();
    return m;
  }

  const age = (p) => (p && p.mod ? Math.max(0, now() - p.mod) : null);
  const statusName = (m, code) => (code == null ? "" : m.statusNames[code] || String(code));
  function freshness(ageSec) {
    if (ageSec == null) return "unknown";
    const limit = (settings.maxAgeHours || 24) * 3600;
    if (ageSec > limit) return "stale";
    return ageSec < Math.min(6 * 3600, limit / 2) ? "fresh" : "aging";
  }
  function usable(p, side, f) {
    if (!p.t.available) return false;
    if (f.maxAge) { const a = age(p); if (a != null && a > f.maxAge) return false; }
    if (side === "buy" && f.skipOOS && p.sb === 1) return false;
    if (side === "sell" && f.skipFull && p.ss === 7) return false;
    return true;
  }
  function findCommodity(m, text) {
    const q = String(text || "").trim().toLowerCase();
    if (!q) return null;
    const all = [...m.commodities.values()];
    return all.find((c) => c.name.toLowerCase() === q || c.code.toLowerCase() === q)
      || all.filter((c) => c.name.toLowerCase().includes(q)).sort((a, b) => a.name.length - b.name.length)[0] || null;
  }
  function findTerminals(m, text) {
    const q = String(text || "").trim().toLowerCase();
    if (!q) return [];
    return [...m.terminals.values()].filter((t) => (t.name + " " + t.code + " " + t.location).toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /* ----------------------------------------------------------------- ships */
  const sizesOf = (csv) => [...new Set(String(csv || "").split(/[,;]/).map((x) => parseInt(x, 10)).filter((x) => x > 0))].sort((a, b) => a - b);

  function buildShips(vehicles, fyModels) {
    const byKey = new Map();
    for (const v of vehicles || []) {
      if (!v || +v.is_ground_vehicle || +v.is_addon) continue;
      const name = v.name || v.name_full;
      if (!name) continue;
      const s = { name, maker: v.company_name || "", cargo: num(v.scu), sizes: sizesOf(v.container_sizes),
        pad: v.pad_type || "", dockOnly: !!+v.is_loading_dock, concept: !!+v.is_concept,
        version: v.game_version || "", speed: 0, role: "", url: "" };
      byKey.set(norm(name), s);
      if (v.name_full) { const k = norm(v.name_full); if (!byKey.has(k)) byKey.set(k, s); }
    }
    for (const d of fyModels || []) {
      if (!d || !d.name) continue;
      const s = byKey.get(norm(d.name));
      const speed = num(d.scmSpeed || (d.speeds && d.speeds.scmSpeed));
      const role = d.focus || d.classificationLabel || d.classification || "";
      if (s) { s.speed = speed || s.speed; s.role = role || s.role; s.url = d.slug ? "https://fleetyards.net/ships/" + d.slug : ""; }
    }
    const list = [...new Set(byKey.values())];
    const ov = settings.overrides || {};
    for (const s of list) {
      const o = ov[s.name] || {};
      s.cargoOverride = num(o.cargo) || null;
      s.boxOverride = int(o.maxBox) || null;
      s.effCargo = s.cargoOverride || s.cargo;
      s.maxBox = s.boxOverride || (s.sizes.length ? Math.max(...s.sizes) : null);
      s.boxes = s.maxBox ? STD_BOXES.filter((b) => b <= s.maxBox) : null;
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }

  /* ---------------------------------------------------------------- routes */
  function availBoxes(p) {
    const s = sizesOf(p.sizes);
    if (s.length) return new Set(s);
    if (p.t.maxBox) return new Set(STD_BOXES.filter((b) => b <= p.t.maxBox));
    return null;
  }
  function compatBoxes(p, shipBoxes) {
    const ship = new Set(shipBoxes || STD_BOXES);
    const av = availBoxes(p);
    return [...(av ? [...av].filter((b) => ship.has(b)) : ship)].sort((a, b) => b - a);
  }
  function boxPlan(scu, sizes) {
    const plan = []; let left = Math.floor(scu);
    for (const size of [...(sizes || [1])].sort((a, b) => b - a)) {
      const n = Math.floor(left / size);
      if (n) { plan.push([size, n]); left -= n * size; }
    }
    if (left && sizes && sizes.length) {
      const sm = Math.min(...sizes);
      if (plan.length && plan[plan.length - 1][0] === sm) plan[plan.length - 1][1]++; else plan.push([sm, 1]);
    }
    return plan;
  }
  function minutes(distGM, boxes) {
    if (distGM == null) return null;
    return distGM * 1e6 / Math.max(settings.qtSpeed, 1) / 60 + 2 * settings.stopMinutes + boxes * settings.boxSeconds * 2 / 60;
  }

  function makeFilters(o = {}) {
    const ship = o.ship;
    const f = {
      cargo: o.cargo || (ship && ship.effCargo) || settings.defaultCargo,
      budget: o.budget === undefined ? (settings.budget || null) : o.budget,
      system: o.system && o.system !== "all" ? o.system : null,
      cross: !!o.cross, illegal: !!o.illegal, respectStock: o.respectStock !== false,
      origins: o.origins || null, dests: o.dests || null, commodities: o.commodities || null,
      dockOnly: !!o.dockOnly || !!(ship && ship.dockOnly),
      shipBoxes: o.ignoreBoxes ? null : (ship && ship.boxes) || null,
      maxAge: null, skipOOS: false, skipFull: false,
    };
    if (!o.showAll) {
      f.maxAge = settings.maxAgeHours ? settings.maxAgeHours * 3600 : null;
      f.skipOOS = settings.hideOutOfStock; f.skipFull = settings.hideFull;
    }
    return f;
  }

  function planScu(b, s, f, ignoreBudget) {
    const lim = { cargo: f.cargo };
    const warn = [];
    if (!ignoreBudget && f.budget && b.buy > 0) lim.budget = Math.floor(f.budget / b.buy);
    if (f.respectStock) {
      if (b.stock > 0) lim.stock = b.stock; else warn.push("stock unknown at origin");
      if (s.demand > 0) lim.demand = s.demand; else warn.push("demand unknown at destination");
    }
    let by = "cargo";
    for (const k in lim) if (lim[k] < lim[by]) by = k;
    return { scu: Math.max(0, Math.floor(lim[by])), by, warn };
  }

  function makeRoute(b, s, scu, by, warn, boxes, cap) {
    const r = { b, s, scu, by, warn, boxes, cap, commodity: b.commodity, cid: b.cid, illegal: b.illegal,
      margin: s.sell - b.buy, dist: null };
    r.invest = scu * b.buy; r.revenue = scu * s.sell; r.profit = scu * r.margin;
    r.roi = b.buy ? r.margin / b.buy * 100 : 0;
    r.plan = boxPlan(scu, boxes); r.boxCount = r.plan.reduce((a, [, n]) => a + n, 0);
    const ages = [age(b), age(s)].filter((a) => a != null);
    r.oldest = ages.length ? Math.max(...ages) : null;
    return r;
  }
  const timed = (r) => { r.min = minutes(r.dist, r.boxCount); r.perMin = r.min ? r.profit / r.min : null; return r; };

  function findRoutes(m, f, sort = "profit", limit = 80) {
    const buys = new Map(), sells = new Map();
    for (const p of m.prices) {
      if (f.commodities && !f.commodities.has(p.cid)) continue;
      if (p.illegal && !f.illegal) continue;
      const t = p.t;
      if (!t.available || t.playerOwned) continue;
      if (f.system && t.system !== f.system) continue;
      if (f.dockOnly && !t.dock) continue;
      if (p.buy > 0 && (!f.origins || f.origins.has(t.id)) && usable(p, "buy", f)) (buys.get(p.cid) || buys.set(p.cid, []).get(p.cid)).push(p);
      if (p.sell > 0 && (!f.dests || f.dests.has(t.id)) && usable(p, "sell", f)) (sells.get(p.cid) || sells.set(p.cid, []).get(p.cid)).push(p);
    }
    const out = [];
    const bc = new Map();
    const boxesFor = (p) => { if (!bc.has(p)) bc.set(p, compatBoxes(p, f.shipBoxes)); return bc.get(p); };
    for (const [cid, bl] of buys) {
      const sl = sells.get(cid);
      if (!sl) continue;
      for (const b of bl) {
        const bb = boxesFor(b);
        if (f.shipBoxes && !bb.length) continue;
        for (const s of sl) {
          if (s.t.id === b.t.id || s.sell <= b.buy) continue;
          if (!f.cross && b.t.system && s.t.system && b.t.system !== s.t.system) continue;
          const sb = new Set(boxesFor(s));
          const usableBoxes = f.shipBoxes ? bb.filter((x) => sb.has(x)) : bb;
          if (f.shipBoxes && !usableBoxes.length) continue;
          const { scu, by, warn } = planScu(b, s, f);
          if (scu <= 0) continue;
          const cap = by === "budget" ? planScu(b, s, f, true).scu : scu;
          const r = makeRoute(b, s, scu, by, warn.slice(), usableBoxes, cap);
          if (b.sb === 1) r.warn.push("origin reported out of stock");
          if (s.ss === 7) r.warn.push("destination inventory full");
          if (b.t.system !== s.t.system) r.warn.push("crosses star systems");
          out.push(r);
        }
      }
    }
    const key = { profit: (r) => r.profit, margin: (r) => r.margin, roi: (r) => r.roi, investment: (r) => -r.invest,
      perMin: (r) => r.perMin || 0 }[sort] || ((r) => r.profit);
    out.sort((a, b) => key(b) - key(a));
    return limit ? out.slice(0, limit) : out;
  }

  function bestLegs(routes) {
    const best = new Map();
    for (const r of routes) { const k = r.b.t.id + ">" + r.s.t.id; if (!best.has(k) || r.profit > best.get(k).profit) best.set(k, r); }
    return best;
  }
  function roundTrips(m, f, oneWay = false, limit = 40) {
    const starts = f.origins;
    const legs = bestLegs(findRoutes(m, { ...f, origins: null }, "profit", 0));
    const seen = new Set(), trips = [];
    for (const [k, out0] of legs) {
      const [a, b] = k.split(">").map(Number);
      if (starts && !starts.has(a) && !starts.has(b)) continue;
      const back0 = legs.get(b + ">" + a);
      if (!back0 && !oneWay) continue;
      const pair = [a, b].sort().join("-");
      if (back0 && seen.has(pair)) continue;
      seen.add(pair);
      let out = out0, back = back0;
      if (back && back.profit > out.profit && !(starts && starts.has(a))) [out, back] = [back, out];
      trips.push({ out, back, profit: out.profit + (back ? back.profit : 0) });
    }
    return trips.sort((x, y) => y.profit - x.profit).slice(0, limit);
  }
  function chains(m, f, legsN = 3, limit = 20, beam = 40, perStop = 6) {
    const starts = f.origins;
    const byOrigin = new Map();
    for (const r of bestLegs(findRoutes(m, { ...f, origins: null }, "profit", 0)).values())
      (byOrigin.get(r.b.t.id) || byOrigin.set(r.b.t.id, []).get(r.b.t.id)).push(r);
    for (const l of byOrigin.values()) l.sort((a, b) => b.profit - a.profit);
    let frontier = [];
    for (const [o, l] of byOrigin) if (!starts || starts.has(o)) frontier.push(...l.slice(0, perStop).map((r) => [r]));
    frontier.sort((a, b) => b[0].profit - a[0].profit); frontier = frontier.slice(0, beam);
    let finished = legsN === 1 ? frontier : [];
    for (let i = 1; i < legsN; i++) {
      const next = [];
      for (const ch of frontier) {
        const visited = new Set([ch[0].b.t.id, ...ch.map((r) => r.s.t.id)]);
        for (const r of (byOrigin.get(ch[ch.length - 1].s.t.id) || []).slice(0, perStop * 2))
          if (!visited.has(r.s.t.id)) next.push([...ch, r]);
      }
      if (!next.length) break;
      const tot = (c) => c.reduce((a, r) => a + r.profit, 0);
      next.sort((a, b) => tot(b) - tot(a)); frontier = next.slice(0, beam); finished = frontier;
    }
    const out = [], keys = new Set();
    for (const legs of finished) {
      const stops = [legs[0].b.t.name, ...legs.map((r) => r.s.t.name)];
      const k = stops.join("|"); if (keys.has(k)) continue; keys.add(k);
      out.push({ legs, stops, profit: legs.reduce((a, r) => a + r.profit, 0),
        startInvest: legs[0].invest, peakInvest: Math.max(...legs.map((r) => r.invest)) });
    }
    return out.sort((a, b) => b.profit - a.profit).slice(0, limit);
  }

  /* ------------------------------------------------------------ sell cargo */
  function sellPlan(m, items, system, showAll) {
    const f = makeFilters({ showAll });
    const perT = new Map(), res = [];
    for (const it of items) {
      const com = findCommodity(m, it.commodity);
      if (!com) { res.push({ ...it, error: "Unknown commodity", options: [] }); continue; }
      const base = com.name.toLowerCase().split(" (")[0];
      const variants = [...m.commodities.values()].filter((c) => c.id !== com.id &&
        (c.name.toLowerCase() === base || c.name.toLowerCase().startsWith(base + " ("))).map((c) => c.name);
      const opts = [];
      for (const p of m.prices) {
        if (p.cid !== com.id || !(p.sell > 0) || !p.t.available) continue;
        if (system && system !== "all" && p.t.system !== system) continue;
        if (!usable(p, "sell", f)) continue;
        const takes = p.demand > 0 ? Math.min(it.scu, p.demand) : it.scu;
        const o = { p, takes, value: takes * p.sell, partial: takes < it.scu };
        opts.push(o);
        const e = perT.get(p.t.id) || perT.set(p.t.id, { t: p.t, items: new Map() }).get(p.t.id);
        const prev = e.items.get(com.name);
        if (!prev || o.value > prev.value) e.items.set(com.name, { name: com.name, ...o });
      }
      opts.sort((a, b) => b.value - a.value);
      res.push({ commodity: com.name, asked: it.commodity, scu: it.scu, variants, options: opts.slice(0, 6) });
    }
    const wanted = res.filter((r) => !r.error).length;
    const stops = [...perT.values()].map((e) => ({ t: e.t, items: [...e.items.values()],
      value: [...e.items.values()].reduce((a, x) => a + x.value, 0), covers: e.items.size, of: wanted }))
      .sort((a, b) => b.covers - a.covers || b.value - a.value).slice(0, 6);
    const bestTotal = res.reduce((a, r) => a + (r.options[0] ? r.options[0].value : 0), 0);
    return { items: res, stops, bestTotal };
  }

  /* ------------------------------------------------------------- distances */
  async function distance(a, b) {
    try {
      const { data } = await getUEX("terminals_distances", { id_terminal_origin: a, id_terminal_destination: b });
      const d = Array.isArray(data) ? data[0] : data;
      const v = parseFloat(d && d.distance);
      return isNaN(v) ? null : v;
    } catch { return null; }
  }
  async function fillDistances(routes, max = 25) {
    let n = 0;
    for (const r of routes) {
      if (r.dist == null && n < max) { r.dist = await distance(r.b.t.id, r.s.t.id); n++; }
      timed(r);
    }
  }

  /* ---------------------------------------------------------------- alerts */
  const ALERT_KINDS = {
    sell_above: "Best sell price at or above", buy_below: "Best buy price at or below",
    margin_above: "Best margin per SCU at or above", route_above: "Best run for my ship at or above",
  };
  function evalAlert(m, a, ship) {
    const f = makeFilters({ ship, system: a.system || null });
    if (a.kind === "route_above") {
      const com = a.commodity ? findCommodity(m, a.commodity) : null;
      if (com) f.commodities = new Set([com.id]);
      const r = findRoutes(m, f, "profit", 1)[0];
      return r ? { value: r.profit, where: `${r.commodity}: ${r.b.t.name} → ${r.s.t.name}` } : { value: null };
    }
    const com = findCommodity(m, a.commodity);
    if (!com) return { value: null };
    let rows = m.prices.filter((p) => p.cid === com.id && (!f.system || p.t.system === f.system));
    if (a.terminal) rows = rows.filter((p) => p.t.name.toLowerCase().includes(a.terminal.toLowerCase()));
    const buys = rows.filter((p) => p.buy > 0 && usable(p, "buy", f)), sells = rows.filter((p) => p.sell > 0 && usable(p, "sell", f));
    const lo = buys.sort((x, y) => x.buy - y.buy)[0], hi = sells.sort((x, y) => y.sell - x.sell)[0];
    if (a.kind === "sell_above" && hi) return { value: hi.sell, where: hi.t.name };
    if (a.kind === "buy_below" && lo) return { value: lo.buy, where: lo.t.name };
    if (a.kind === "margin_above" && lo && hi) return { value: hi.sell - lo.buy, where: `${lo.t.name} → ${hi.t.name}` };
    return { value: null };
  }

  /* ---------------------------------------------------------- load all data */
  async function loadAll(force = false) {
    const events = [];
    status.uex = { state: "loading", msg: "Downloading prices…" };
    // patch check first - a new live version forces fresh downloads
    let live = null, ptu = null;
    try {
      const v = (await getUEX("game_versions", {}, { force: true })).data || {};
      const d = Array.isArray(v) ? v[0] || {} : v;
      live = d.live || null; ptu = d.ptu || null;
      if (live && settings.lastLive && live !== settings.lastLive) {
        events.push({ id: "patch-" + live, title: "New Star Citizen patch", msg: `Patch ${live} is live (was ${settings.lastLive}). Downloading fresh data.` });
        force = true;
      }
      if (live && live !== settings.lastLive) saveSettings({ lastLive: live });
    } catch { /* optional */ }

    const [c, t, p, st] = await Promise.all([
      getUEX("commodities", {}, { force }), getUEX("terminals", { type: "commodity" }, { force, ttlKey: "terminals" }),
      getUEX("commodities_prices_all", {}, { force }),
      getUEX("commodities_status", {}, { force }).catch(() => ({ data: null })),
    ]);
    const [rp, rt, veh] = await Promise.all([
      getUEX("commodities_raw_prices_all", {}, { force }).catch(() => ({ data: [] })),
      getUEX("terminals", { type: "commodity_raw" }, { force, ttlKey: "terminals" }).catch(() => ({ data: [] })),
      getUEX("vehicles", {}, { force }).catch(() => ({ data: [] })),
    ]);
    const market = buildMarket({ commodities: c.data, terminals: t.data, prices: p.data, rawPrices: rp.data, rawTerminals: rt.data, statuses: st.data });
    market.savedAt = p.saved;
    market.live = live || settings.lastLive || null; market.ptu = ptu;
    status.uex = p.stale ? { state: "warn", msg: "Offline - using saved data" }
      : { state: "ok", msg: `${market.commodities.size} commodities · ${market.prices.length} prices` + (status.via === "relay" ? " · via relay" : "") };

    let fy = [];
    if (settings.useFleetYards) {
      status.fleetyards = { state: "loading", msg: "" };
      try { fy = await getFleetYards(force); status.fleetyards = { state: "ok", msg: `${fy.length} ships (speed, role)` }; }
      catch { status.fleetyards = { state: "warn", msg: "Not reachable - speeds unavailable" }; }
    } else status.fleetyards = { state: "off", msg: "Off" };
    const ships = buildShips(veh.data, fy);

    // new ships since last time (first run only records them)
    const known = store.get("knownShips", null);
    const nowS = now();
    const map = known || {};
    for (const s of ships) {
      if (!(s.name in map)) {
        map[s.name] = known ? nowS : 0;
        if (known && !s.concept) events.push({ id: "ship-" + s.name, title: "New ship available", msg: `${s.name}${s.cargo ? " · " + Math.round(s.cargo) + " SCU" : ""} is now in the ship list` });
      }
      s.firstSeen = map[s.name];
      s.isNew = !!s.firstSeen && nowS - s.firstSeen < 14 * 86400;
    }
    if (ships.length) store.set("knownShips", map);
    return { market, ships, events };
  }

  /* -------------------------------------------- connection check (for setup) */
  async function connectionCheck() {
    const target = UEX_BASES[0] + "/game_versions";
    const result = { direct: false, relay: null };
    try { await fetchJSON(target, 12000); result.direct = true; } catch { /* blocked */ }
    if (!result.direct) {
      try { await fetchJSON(UEX_BASES[1] + "/game_versions", 12000); result.direct = true; } catch { /* blocked */ }
    }
    const r = viaRelay(target);
    if (r) { try { await fetchJSON(r, 12000); result.relay = true; } catch { result.relay = false; } }
    return result;
  }

  async function clearCache() { try { await caches.delete(CACHE); } catch { /* ignore */ } }

  return { settings, saveSettings, store, status, loadAll, findRoutes, roundTrips, chains, sellPlan, makeFilters,
    fillDistances, distance, timed, boxPlan, age, freshness, statusName, findCommodity, findTerminals, usable,
    evalAlert, ALERT_KINDS, connectionCheck, clearCache, STD_BOXES, norm };
})();
if (typeof module !== "undefined") module.exports = SCT;
