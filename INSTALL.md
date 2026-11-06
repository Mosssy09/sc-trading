# Star Citizen Trading - Samsung / Android app

*Created by Mossy*

This is a standalone phone app. It runs entirely on your phone and gets its data straight from
UEX Corp, with no PC needed. It installs from the browser, gets its own icon in your app drawer,
and opens full screen like any other app.

An app has to live at a web address before you can install it, so you'll put these files on
**GitHub Pages**. It's free, and you only do this once (about 10 minutes, easiest on your PC).

---

## Step 1 - Put the app online (GitHub Pages)

1. Go to **github.com** and create a free account (skip if you have one).
2. Click **+** (top right), then **New repository**.
   - Name: `sc-trading`
   - Choose **Public**
   - Click **Create repository**
3. On the new page, click the link **"uploading an existing file"**.
4. Open the unzipped **Star Citizen Trading Mobile** folder on your PC, select **everything inside
   it** (including the `icons` and `relay` folders), and drag it all onto the GitHub page.
   Wait for the uploads to finish, then click **Commit changes**.
5. In the repository, open **Settings → Pages** (left menu).
   - Under *Build and deployment*, set **Source: Deploy from a branch**
   - Set **Branch: main** and **/ (root)**, then click **Save**
6. Wait 1-2 minutes and refresh that page. It shows your app's address:
   **`https://YOUR-USERNAME.github.io/sc-trading/`**

> The files contain no personal information. Your ship, trades, alerts and settings are only
> stored on your phone.

## Step 2 - Install it on your Samsung

**Chrome (recommended):**
1. Open your app address in **Chrome** on the phone.
2. Tap **⋮** (top right), then **Add to Home screen**, then **Install**.
3. **Star Citizen Trading** appears in your app drawer and on your home screen.

**Samsung Internet:**
1. Open the address and tap **≡** (bottom right), then **Add page to**, then **Home screen**.
   (Or tap the install icon in the address bar if you see one.)

## Step 3 - Check the connection (first launch)

Open the app, go to **More → About & connection** and tap **Run connection check**.

- **"UEX works directly"**: you're done. Pick your ship and go.
- **"UEX is blocked from this phone"**: some sites stop phone apps reading their data directly
  (a browser safety rule called CORS). Do Step 4 once and it's fixed.

## Step 4 - Only if blocked: the free relay (about 5 minutes)

The relay is a tiny free program on Cloudflare. It fetches the data for your app. It only talks to
UEX and FleetYards and nothing else.

1. Go to **dash.cloudflare.com** and create a free account.
2. Open **Workers & Pages** and click **Create**, then **Create Worker** (start from "Hello World").
3. Name it `sct-relay` and click **Deploy**.
4. Click **Edit code**, delete everything there, and paste in the contents of
   **`relay/worker.js`** from this folder. Click **Deploy**.
5. Copy the worker's address. It looks like **`https://sct-relay.YOUR-NAME.workers.dev`**.
   Opening it in a browser should say *"Star Citizen Trading relay is running."*
6. In the app: **More → About & connection**, paste the address into **Relay**, then tap
   **Save & reload data**. Run the connection check again and it should say ✓.

Cloudflare's free plan allows 100,000 requests a day. The app uses a few dozen per refresh.

---

## What's in the app

- **Home**: best run and best loop for your ship, your hold and investment, today's logged
  profit, pinned routes.
- **Routes**: one-way, round trip or multi-stop (2-5 legs). Tap a route for the loading plan
  (e.g. `18×32`), the investment calculator, and the **Log**, **Pin** and **Alert** buttons.
  Use **Filters** for system, from/to, commodity, sort (including profit per minute) and more.
- **Sell**: enter what you're carrying (trade goods, ore, salvage) and get the best places to
  sell and the best single stop.
- **Ships**: pick your ship. Cargo and box sizes come from UEX, and new ships get a NEW tag.
  You can adjust cargo or biggest box for your setup.
- **More**: commodities, stock levels, terminals, trade log, price alerts, settings, connection.
- Prices older than 24 hours, out-of-stock buy terminals and full sell terminals are skipped by
  default (change this in Settings). Every price shows its age.
- A new patch is detected automatically and triggers a fresh download.
- Alerts chime and vibrate, but only while the app is open. Phones don't let web apps check
  prices in the background.
- Works offline with the last data it downloaded.

## Updating the app later

When you get new files, open your `sc-trading` repository on GitHub, click **Add file → Upload
files**, drag in the new files (they replace the old ones) and click **Commit changes**. Then
fully close and reopen the app on your phone, maybe twice, to pick up the new version.

Unofficial fan app, not affiliated with Cloud Imperium Games. Data: UEX Corp (uexcorp.space),
FleetYards (fleetyards.net). Prices are player-reported estimates.
