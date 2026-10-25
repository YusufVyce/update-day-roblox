# Update Day

Run your Roblox game's update day on autopilot. Set it up once, then the cloud runs the countdown icons, sales and announcements, and moves players onto the update while you play it yourself.

**Sign in with Roblox, tick your games on Roblox's own screen, done.** Group games work too, and teammates join a game by signing in the same way. No API keys to build by hand.

## What it does

| | |
| --- | --- |
| **Overview** | Live players, visits, favorites and like ratio with day-over-day change, a launch timeline of everything planned, and an activity feed. |
| **Countdown** | Draws an hourglass countdown (`24 HOURS → … → 5 MINS → NOW!`) on your icon and swaps it on Roblox at each step. Two hours after release the normal icon comes back. |
| **Release autopilot** | At release it adds an update tag to the title (`[🎃 UPDATE] My Game`) and removes it after N days, restarts or soft-migrates servers, and posts to Discord with the countdown icon attached. |
| **Analytics** | Players online over 24h, 7d or 30d with the release marked, peak and average, visits and favorites gained, and a **launch report** comparing before and after the update. |
| **Events** | Create and delete Roblox events (they show on your game page and in players' calendars). |
| **Sale** | Pick game passes and dev products, a discount and a window (or your admin-abuse hour). Prices drop on time and go back on time. |
| **Players** | Send any player items from your gift list. They arrive on their next join, or right away if they're online. Look up a player to see and edit their saved data: your DataStores and the player's keys are found automatically, with nothing to type. |
| **Timers** | In-game countdowns, pushed to every running server in seconds. |
| **Game page** | Your page as players see it, plus a fix list: too few thumbnails, no event for the update, no update tag, empty description. |

Search with **Ctrl K**. Every Roblox call is logged in the activity feed, including failures.

## Set up (once, about 5 minutes)

1. **Deploy.** Push this repo to GitHub. In Vercel choose **Add New → Project**, import it and deploy. No build settings are needed.
2. **Database.** In the Vercel project open **Storage → Create Database → Upstash for Redis** (the free plan is enough) and connect it.
3. **Roblox sign-in app.** In Creator Hub open [OAuth 2.0 Apps](https://create.roblox.com/dashboard/credentials?activeTab=OAuthTab), choose **Create App** and give it a name. Then edit the app:
   - Redirect URL: `https://<your-site>.vercel.app/api/oauth/callback`
   - Permissions: `openid profile legacy-universe:manage universe:write universe.place:write game-pass:read game-pass:write developer-product:read developer-product:write universe.event:read universe.event:write universe-messaging-service:publish`
   - Copy the Client ID and Secret.

   The site's setup page shows the exact redirect URL and scope list with copy buttons. Roblox requires ID verification to create OAuth apps. A new app is private and can have up to 10 users, which is plenty for a team.
4. **Environment variables** (Vercel → Settings → Environment Variables):

   | Name | Value |
   | --- | --- |
   | `ROBLOX_CLIENT_ID`, `ROBLOX_CLIENT_SECRET` | From step 3 |
   | `APP_SECRET` | 32+ random characters. Signs logins and encrypts tokens. |
   | `CRON_SECRET` | 32+ random characters, for step 6 |
   | `ALLOWED_USERS` | Optional: Roblox usernames or IDs allowed to sign in, comma separated. If empty, anyone can sign in and manage their own games. |
   | `ADMIN_PASSWORD` | Optional: a password login that sees every game. Without a Roblox app, this is the only way in. Games are then added with API keys. |

5. **Redeploy** and open the site. Sign in with Roblox and tick your games.
6. **Cloud.** Vercel's free plan only runs a cron once a day, so use the free [cron-job.org](https://cron-job.org) instead:
   - URL: `https://<your-site>.vercel.app/api/cron`
   - Schedule: every minute
   - Header: `Authorization: Bearer <CRON_SECRET>`

   The sidebar changes to **Cloud running** once it works. An open dashboard also runs the same job every minute as a backup.

## Game script (Gifts, Timers, Player data)

In **Settings → Game script**, download the script. It comes with your site address and a secret already filled in. Put it in a Script in **ServerScriptService**, turn on **Game Settings → Security → Allow HTTP Requests**, and hook up your rewards:

```lua
game.ServerStorage:WaitForChild("UpdateDayGift").Event:Connect(function(player, gift)
	-- gift.type, gift.item, gift.tier, gift.amount
end)
```

Timers appear as `IntValue`s in `ReplicatedStorage.UpdateDayTimers`. Each value is the end time in Unix seconds.

**Player data** also goes through the script. Roblox doesn't let sign-in apps touch DataStores, so a running game server does it instead:

1. The site sends a message to your game servers. The first server to claim it (through MemoryStore) handles it.
2. That server lists your DataStores and works out how each one names its keys from a few real keys (for example `Player_123456` → `Player_{userId}`).
3. It reads the player's entries and sends them back.

The site remembers the key patterns, so later lookups are quick. Edits are saved the same way. At least one server has to be running.

## API keys (optional)

Without a Roblox sign-in app, add games with an Open Cloud API key (Settings → Connection). If a game has a key, that key is used for every call on that game.

## Run locally

Needs Node.js 20.11 or newer. There are no dependencies to install.

```bash
npm run dev
```

Open http://localhost:3000 and log in with `devpassword`. Data goes to `.data.json`, which git ignores.

```bash
npm test
```

## How it works

| Path | What it is |
| --- | --- |
| `index.html`, `styles.css`, `js/` | The dashboard (plain JS modules, no build step) |
| `lib.js` | Pure helpers shared by browser, server and tests: steps, time zones, title tags, stats, launch report |
| `api/main.js` | The one serverless function; `vercel.json` routes every `/api/*` request to it |
| `server/creds.js` | Roblox sign-in (OAuth 2.0 + PKCE), token refresh, picking credentials per game |
| `server/tick.js` | The every-minute job: icons, autopilot, Discord, sales, stats sampling |
| `server/roblox.js` | Roblox web and Open Cloud calls |
| `server/script.js` | The in-game script template |
| `server/store.js` | Upstash Redis over REST, or a JSON file locally |
| `server/auth.js` | Sessions, cookies, encryption |

## Good to know

- Roblox marks the icon and events endpoints as **experimental**, so they may change. Icon changes apply to the game's source language (Settings → Icon language).
- Sign-ins stay alive for as long as the cron runs (Roblox refresh tokens expire after 90 unused days).
- A sale restores the prices it saw when it was planned. A sale whose whole window was missed (cron down) is marked **missed**, and prices are left alone.
- One-time autopilot actions run once. If one fails, it is logged and not retried.

Not affiliated with or endorsed by Roblox Corporation.
