const { app, BrowserWindow, ipcMain, dialog, Notification, screen, session } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const WebSocket = require("ws");

// ---- CONFIGURE THIS ----
// After deploying the relay server (see README "Deploying so it works
// across different networks"), paste your server's URL here. Use wss://
// (not ws://) since hosts like Render/Railway serve over TLS.
// Example: "wss://wallpaper-troll-server.onrender.com"
const DEFAULT_RELAY_URL = "wss://trolls-n-shi.onrender.com";

// Falls back to DEFAULT_RELAY_URL above, but can still be overridden with
// an env var if you ever want to point at a different server temporarily.
const RELAY_URL = process.env.RELAY_URL || DEFAULT_RELAY_URL;

let mainWindow;
let overlayWindow = null;
let ws;
let myCode = null;
let currentRoomCode = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 700,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile("index.html");
}

function toRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function connectToRelay() {
  if (RELAY_URL.includes("YOUR-SERVER-URL-HERE")) {
    toRenderer(
      "status",
      "No server configured yet — edit DEFAULT_RELAY_URL at the top of main.js with your deployed server's URL."
    );
    return;
  }

  ws = new WebSocket(RELAY_URL);

  ws.on("open", () => toRenderer("status", "Connected to relay server."));

  ws.on("message", async (raw) => {
    const msg = JSON.parse(raw.toString());

    switch (msg.type) {
      case "registered":
        myCode = msg.code;
        toRenderer("my-code", myCode);
        break;

      case "room-created":
        currentRoomCode = msg.roomCode;
        toRenderer("room-joined", { roomCode: msg.roomCode, memberCount: 1 });
        break;

      case "room-joined":
        currentRoomCode = msg.roomCode;
        toRenderer("room-joined", { roomCode: msg.roomCode, memberCount: msg.memberCount });
        break;

      case "room-error":
        toRenderer("status", `Group error: ${msg.reason}`);
        break;

      case "member-joined":
        toRenderer("member-count", msg.memberCount);
        toRenderer("status", `Someone joined the group. ${msg.memberCount} member(s) total.`);
        break;

      case "member-left":
        toRenderer("member-count", msg.memberCount);
        toRenderer("status", `Someone left the group. ${msg.memberCount} member(s) remaining.`);
        break;

      case "room-left":
        currentRoomCode = null;
        toRenderer("room-left");
        break;

      case "set-wallpaper":
        await handleIncomingWallpaper(msg);
        break;

      case "play-media":
        await handleIncomingMedia(msg);
        break;

      // Live mic broadcast - just forwarded straight to the renderer,
      // which does the actual decode/playback via MediaSource.
      case "mic-start":
        toRenderer("mic-start", msg.fromCode);
        break;
      case "mic-chunk":
        toRenderer("mic-chunk", { audioBase64: msg.audioBase64, fromCode: msg.fromCode });
        break;
      case "mic-stop":
        toRenderer("mic-stop", msg.fromCode);
        break;

      case "error":
        toRenderer("status", msg.reason);
        break;
    }
  });

  ws.on("close", () => {
    toRenderer("status", "Disconnected from relay server. Retrying in 3s...");
    setTimeout(connectToRelay, 3000);
  });

  ws.on("error", () => {
    toRenderer("status", "Could not reach relay server.");
  });
}

// ---- Wallpaper ----

async function handleIncomingWallpaper(msg) {
  try {
    const buffer = Buffer.from(msg.imageBase64, "base64");
    const fittedPath = await fitImageToScreen(buffer);

    const { setWallpaper } = await import("wallpaper");
    await setWallpaper(fittedPath, { scale: "fill" }); // canvas is already screen-sized

    new Notification({
      title: "Wallpaper Troll",
      body: `${msg.fromCode} just changed your wallpaper!`,
    }).show();

    toRenderer("status", `${msg.fromCode} changed your wallpaper.`);
  } catch (err) {
    toRenderer("status", `Failed to set wallpaper: ${err.message}`);
  }
}

async function fitImageToScreen(buffer) {
  const Jimp = require("jimp");

  const display = screen.getPrimaryDisplay();
  const scaleFactor = display.scaleFactor || 1;
  const screenWidth = Math.round(display.size.width * scaleFactor);
  const screenHeight = Math.round(display.size.height * scaleFactor);

  const image = await Jimp.read(buffer);

  const widthRatio = screenWidth / image.bitmap.width;
  const heightRatio = screenHeight / image.bitmap.height;
  const scale = Math.min(widthRatio, heightRatio);

  const newWidth = Math.max(1, Math.round(image.bitmap.width * scale));
  const newHeight = Math.max(1, Math.round(image.bitmap.height * scale));
  image.resize(newWidth, newHeight, Jimp.RESIZE_BICUBIC);

  const canvas = new Jimp(screenWidth, screenHeight, 0x000000ff);
  const x = Math.round((screenWidth - newWidth) / 2);
  const y = Math.round((screenHeight - newHeight) / 2);
  canvas.composite(image, x, y);

  const outPath = path.join(os.tmpdir(), `wallpaper-troll-fitted-${Date.now()}.png`);
  await canvas.writeAsync(outPath);
  return outPath;
}

// ---- Media (mp4 / mp3) jump-scare playback ----
// Plays fullscreen/always-on-top on the RECEIVING device, using a file
// the sender chose and sent. Nothing here touches the receiver's own
// camera, mic, or files - it just displays/plays what was sent to them,
// the same way the wallpaper feature works.

async function handleIncomingMedia(msg) {
  try {
    const buffer = Buffer.from(msg.mediaBase64, "base64");
    const ext = msg.ext || (msg.isVideo ? "mp4" : "mp3");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wallpaper-troll-media-"));
    const mediaPath = path.join(tmpDir, `media.${ext}`);
    fs.writeFileSync(mediaPath, buffer);

    showMediaOverlay(mediaPath, !!msg.isVideo, tmpDir);
    toRenderer("status", `${msg.fromCode} sent you a ${msg.isVideo ? "video" : "sound"}.`);
  } catch (err) {
    toRenderer("status", `Failed to play media: ${err.message}`);
  }
}

function showMediaOverlay(mediaPath, isVideo, tmpDir) {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
  }

  overlayWindow = new BrowserWindow({
    fullscreen: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: "#000000",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false, // local temp file only, never remote content
    },
  });

  const fileUrl = "file://" + mediaPath.replace(/\\/g, "/");
  const tag = isVideo
    ? `<video id="m" src="${fileUrl}" autoplay style="max-width:100%;max-height:100%;"></video>`
    : `<div style="font-size:64px;">🔊</div><audio id="m" src="${fileUrl}" autoplay></audio>`;

  const html = `
    <!DOCTYPE html><html><body style="margin:0;background:#000;color:#fff;
      display:flex;align-items:center;justify-content:center;height:100vh;
      flex-direction:column;font-family:sans-serif;">
      ${tag}
      <script>
        const { ipcRenderer } = require('electron');
        const m = document.getElementById('m');
        const done = () => ipcRenderer.send('media-overlay-done');
        m.addEventListener('ended', done);
        m.addEventListener('error', done);
        window.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(); });
      </script>
    </body></html>`;

  const htmlPath = path.join(tmpDir, "overlay.html");
  fs.writeFileSync(htmlPath, html);
  overlayWindow.loadFile(htmlPath);

  // Failsafe: force-close after 2 minutes even if 'ended' never fires.
  const failsafe = setTimeout(() => {
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close();
  }, 2 * 60 * 1000);

  overlayWindow.on("closed", () => {
    clearTimeout(failsafe);
    overlayWindow = null;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });
}

// ---- IPC handlers (called from renderer via preload) ----

ipcMain.handle("create-room", () => {
  ws.send(JSON.stringify({ type: "create-room" }));
});

ipcMain.handle("join-room", (_e, roomCode) => {
  ws.send(JSON.stringify({ type: "join-room", code: roomCode.toUpperCase() }));
});

ipcMain.handle("leave-room", () => {
  ws.send(JSON.stringify({ type: "leave-room" }));
});

ipcMain.handle("send-wallpaper-to-group", async (_e, filePath) => {
  if (!currentRoomCode) throw new Error("Not in a group yet.");
  const buffer = fs.readFileSync(filePath);
  ws.send(JSON.stringify({ type: "set-wallpaper", imageBase64: buffer.toString("base64") }));
});

ipcMain.handle("pick-image", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg"] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("pick-media", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [{ name: "Video/Audio", extensions: ["mp4", "mp3"] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("send-media-to-group", async (_e, filePath) => {
  if (!currentRoomCode) throw new Error("Not in a group yet.");
  const ext = path.extname(filePath).replace(".", "").toLowerCase();
  const isVideo = ext === "mp4";
  const buffer = fs.readFileSync(filePath);
  ws.send(
    JSON.stringify({
      type: "play-media",
      mediaBase64: buffer.toString("base64"),
      ext,
      isVideo,
    })
  );
});

// Live mic broadcast: these just relay data the renderer captured from
// the SENDER's own mic (via getUserMedia in the renderer) out to the
// group. Nothing here reaches into anyone else's device or microphone.
ipcMain.handle("mic-start", () => {
  ws.send(JSON.stringify({ type: "mic-start" }));
});
ipcMain.handle("mic-stop", () => {
  ws.send(JSON.stringify({ type: "mic-stop" }));
});
ipcMain.handle("mic-chunk", (_e, base64) => {
  ws.send(JSON.stringify({ type: "mic-chunk", audioBase64: base64 }));
});

app.whenReady().then(() => {
  // Allow mic access for the push-to-talk feature (captures the LOCAL
  // user's own mic only, never a remote device's).
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "media");
  });

  createWindow();
  connectToRelay();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
