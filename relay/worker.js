// Star Citizen Trading - data relay (Cloudflare Worker, free plan is plenty).
// Only needed if the app's connection check says UEX is blocked on your phone.
// It fetches the trade data for the app and adds the header phones need.
// It only talks to the three data sites below - nothing else.

const ALLOWED_HOSTS = ["api.uexcorp.uk", "api.uexcorp.space", "api.fleetyards.net"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Accept, Authorization",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "GET") return new Response("Only GET", { status: 405, headers: CORS });

    const target = new URL(request.url).searchParams.get("url");
    if (!target) return new Response("Star Citizen Trading relay is running.", { headers: CORS });

    let url;
    try { url = new URL(target); } catch { return new Response("Bad url", { status: 400, headers: CORS }); }
    if (url.protocol !== "https:" || !ALLOWED_HOSTS.includes(url.hostname)) {
      return new Response("That site isn't allowed", { status: 403, headers: CORS });
    }

    const headers = { Accept: "application/json", "User-Agent": "star-citizen-trading-relay/1.0" };
    const auth = request.headers.get("Authorization");
    if (auth) headers.Authorization = auth;

    // Cloudflare caches answers for 5 minutes, so the data sites aren't hit more than needed.
    const upstream = await fetch(url.toString(), { headers, cf: { cacheTtl: 300, cacheEverything: !auth } });
    const response = new Response(upstream.body, upstream);
    for (const [k, v] of Object.entries(CORS)) response.headers.set(k, v);
    return response;
  },
};
