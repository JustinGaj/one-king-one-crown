# Hosting for free

The game is one small Node.js server that keeps games in memory. It needs WebSockets and a
single always-running instance. This guide puts it online for **$0**, with **no credit card**,
on a name of your own, kept awake around the clock.

| Piece | Service | Cost |
|---|---|---|
| Server | [Render](https://render.com) free web service | free, no card |
| Your own name | [is-a.dev](https://is-a.dev) subdomain, e.g. `onekingonecrown.is-a.dev` | free |
| Kept awake 24/7 | [UptimeRobot](https://uptimerobot.com) free monitor | free |
| HTTPS | Render's automatic certificate | free |

## 1. Put the server on Render

1. Sign in at [render.com](https://render.com) with your GitHub account. No card is asked for.
2. **New + → Blueprint**, give Render access to the `one-king-one-crown` repository, and pick it.
   Render reads `render.yaml` and creates a free web service called `one-king-one-crown`.
3. Wait for the first deploy to finish (a few minutes). The game is then live at
   `https://one-king-one-crown.onrender.com` (Render shows the exact address).

Every push to `main` redeploys automatically. A deploy restarts the server, which ends games in
progress; players see a notice. Push between games.

## 2. Keep it awake

A free Render service goes to sleep after 15 minutes without traffic and takes about a minute to
wake up. A free uptime monitor visiting it every 5 minutes keeps it awake.

1. Make a free account at [uptimerobot.com](https://uptimerobot.com).
2. **Add New Monitor**: type **HTTP(s)**, URL `https://<your address>/healthz`, interval **5 minutes**.

Render gives each account 750 free hours a month, which covers one service running all month
(at most 744 hours). Don't run a second free service on the same account, or both can be paused
near the end of the month.

## 3. Your own name (is-a.dev)

[is-a.dev](https://github.com/is-a-dev/register) gives free subdomains to developers' projects
through a pull request on GitHub.

1. Pick a name, for example `onekingonecrown.is-a.dev`, and check it isn't taken.
2. Fork [is-a-dev/register](https://github.com/is-a-dev/register) and add
   `domains/onekingonecrown.json`, following the template in that repository's README. It looks
   like this (use the address Render gave you):

   ```json
   {
     "owner": { "username": "JustinGaj" },
     "records": { "CNAME": "one-king-one-crown.onrender.com" }
   }
   ```
3. Open the pull request and describe the project ("free fan-made online version of a card game").
   Maintainers review it; once merged, the name works within minutes to a day.
4. In Render: your service → **Settings → Custom Domains → Add**, enter
   `onekingonecrown.is-a.dev`, and wait for Render to verify it and issue the HTTPS certificate.
5. Point the UptimeRobot monitor at the new name.

Other free names: [EU.org](https://nic.eu.org) gives a real domain (e.g.
`onekingonecrown.eu.org`) for non-commercial use but approval takes days to weeks. Paid names cost
roughly $10 a year if you ever want one.

## What to expect from free hosting

- **Restarts end games.** Games live in memory. A deploy, a Render maintenance restart or a crash
  ends the games in progress. Rooms, lobbies and the rest come back immediately.
- **Small server.** 512 MB and a slice of a CPU is plenty for several games at once among friends.
- **Bandwidth.** Game updates are compressed, so normal use stays far below the free allowance.
- **No guarantee.** Render says free instances aren't meant for production, and free plans can
  change. If Render's free tier ever goes away, the same repository runs anywhere Node.js does
  (for example an Oracle Cloud "Always Free" VM, which needs a card for sign-up).

## Security built in

- HTTPS everywhere (Render), with strict security headers: content security policy, no framing,
  no sniffing, no referrer, HSTS.
- Only this site can open a game connection (cross-site WebSockets are refused).
- Rate limits: connections per network, rooms created per network, join attempts (which also
  makes guessing room codes slow), and messages per second per player. Oversized messages are
  refused.
- No accounts, passwords, emails or personal data are stored. A seat is reclaimed with a random
  token kept in the player's browser, or by room code plus name while that seat is disconnected.
- Rooms are wiped 3 minutes after the last person leaves; nothing is written to disk.

Limits can be tuned with environment variables in Render (defaults in `server/security.js`):
`OKOC_MAX_SOCKETS_PER_IP` (16), `OKOC_MAX_ROOMS` (300), `OKOC_ROOMS_PER_IP_PER_10_MIN` (10),
`OKOC_JOINS_PER_IP_PER_MIN` (30), `OKOC_EVENTS_PER_SEC` (15).
