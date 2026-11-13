# Wallpaper Troll

Pair with a friend using a short code, then swap each other's desktop wallpaper for laughs.
Works on **macOS and Windows** from one codebase (Electron). Nothing happens without the
other person explicitly clicking "Accept" on a pairing request first.

## How it works
1. Everyone launches the app. On first launch you see a plain-language disclosure screen:
   *"Anyone in a group you join or create can change your wallpaper at any time, without
   asking again — including while you're away. Only join a group, or share your group code,
   with people you're okay with having that ability."* You have to click "I Understand —
   Continue" to get past it.
2. One person clicks **Create Group** and gets a 6-character group code.
3. Everyone else clicks **Join Group** and enters that code.
4. From then on, anyone in the group can pick an image and send it — it becomes the
   wallpaper of **everyone else** in the group (never the sender's own), any time, even
   while people are away from their computer.
5. Anyone can hit **Leave Group** any time to stop, or just quit the app.
6. More people can join later — just give them the same group code.

**A group code is effectively a shared password.** Anyone who has it can join and start
changing everyone's wallpaper, so don't post it publicly — only give it to the specific
people you want in on it. The relay server never stores images or wallpaper data — it just
passes messages between members of the same group, in memory, and forgets them when the
group empties out.

## 1. Run the relay server
You (or whoever's hosting) needs one relay server that both clients connect to.

```bash
cd server
npm install
npm start
# -> Wallpaper Troll relay server listening on ws://0.0.0.0:8080
```

For friends on different networks, deploy this somewhere reachable (a $5 VPS, Render, Railway,
Fly.io, etc.) and open port 8080 (or put it behind a reverse proxy with TLS and use `wss://`).
If you're all on the same Wi-Fi, `ws://<your-laptop-LAN-IP>:8080` works fine too.

## 2. Run the client app
The relay URL is now baked into the app so you don't need to type an environment variable
every time. Open `client/main.js`, find this near the top:

```js
const DEFAULT_RELAY_URL = "wss://YOUR-SERVER-URL-HERE.onrender.com";
```

and replace it with your actual deployed server URL (see the deployment section below if you
haven't set one up yet). Do this once, before building/sharing the app with your friend —
both of you should be running a copy of the app pointed at the *same* URL.

Then, each person runs:

```bash
cd client
npm install
npm start
```

That's it — no `RELAY_URL=...` needed anymore. (You can still override it temporarily with
the environment variable if you ever want to test against a different server.)

## 3. Deploying the relay server so it works across different networks
If you and your friend won't be on the same Wi-Fi, deploy the `server/` folder somewhere
always-on and public. Render's free tier works well:

1. Push the contents of `server/` (`index.js`, `package.json`) to a GitHub repo.
2. On [render.com](https://render.com), click **New +** → **Web Service**, connect that repo.
3. Set Build Command to `npm install` and Start Command to `npm start`. Free tier is fine.
4. Render gives you a public URL like `wallpaper-troll-server.onrender.com` — your server is
   then reachable at `wss://wallpaper-troll-server.onrender.com`. Paste that into
   `DEFAULT_RELAY_URL` in `main.js` as described above.

Note: Render's free tier sleeps after ~15 minutes idle and takes 30-60s to wake on the next
connection — fine for a prank app, just expect a short "Connecting..." the first time each
session. Railway is a free-tier alternative that doesn't sleep the same way.

## 4. Package it as a real double-click app (optional)
Once your server URL is baked in and everything works, build installable apps for both
platforms so nobody has to touch a terminal:

```bash
cd client
npm run dist
```

This uses `electron-builder` to produce a `.dmg` for macOS and an installer `.exe` for Windows
(you'll typically want to build the Mac version on a Mac and the Windows version on Windows,
or use CI).

## New: media playback + live voice broadcast
Beyond wallpaper, anyone in a group can now:
- **Send an mp4 or mp3** — it plays full-screen (video) or with a speaker icon (audio) on
  every other member's screen, always-on-top, until it finishes (or they press Escape).
- **Hold to Talk** — broadcasts YOUR OWN microphone, live, to everyone else in the group while
  you hold the button down (like a walkie-talkie). This only ever captures the speaking
  person's own mic, with the normal OS/browser mic-permission prompt the first time it's used.
  It cannot turn on or access anyone else's microphone — there is no remote-listen feature,
  by design.

## Notes / things to customize
- **Full image always visible**: incoming wallpapers are automatically resized and letterboxed
  to fit the receiver's actual screen resolution, so the whole image is always shown (with
  black bars on the sides/top if the aspect ratio doesn't match), instead of the OS's default
  "fill" behavior which usually crops the edges off.
- **Wallpaper setting** uses the [`wallpaper`](https://www.npmjs.com/package/wallpaper) npm
  package, which handles both macOS (`osascript`) and Windows (`SystemParametersInfo`) under
  the hood — no platform-specific code needed on your end.
- **Consent is enforced server-side and client-side**: the relay only forwards messages between
  two codes that both agreed to pair, and the receiving app always shows a native
  accept/decline dialog before any pairing completes.
- Want a "revert to original wallpaper" button? Have the client save the current wallpaper path
  (`wallpaper.get()`) before overwriting it, and add an IPC handler to restore it.
- Want group trolling instead of 1-on-1? Extend the server's pairing model to "rooms" instead of
  single pairs — the message-relay logic barely changes.
