const consentScreen = document.getElementById("consentScreen");
const mainScreen = document.getElementById("mainScreen");
const statusEl = document.getElementById("status");
const setupSection = document.getElementById("setupSection");
const trollSection = document.getElementById("trollSection");
const actionsSection = document.getElementById("actionsSection");
const groupBadge = document.getElementById("groupBadge");
const roomCodeEl = document.getElementById("roomCode");
const memberCountLabel = document.getElementById("memberCountLabel");
const talkBtn = document.getElementById("talkBtn");

document.getElementById("acceptBtn").addEventListener("click", () => {
  consentScreen.style.display = "none";
  mainScreen.style.display = "block";
});

window.api.onMyCode(() => {
  // Personal code exists server-side for identifying senders; the group
  // code is what's actually shown/shared in this UI.
});

window.api.onStatus((text) => (statusEl.textContent = text));

window.api.onRoomJoined(({ roomCode, memberCount }) => {
  setupSection.style.display = "none";
  trollSection.style.display = "block";
  actionsSection.style.display = "block";
  groupBadge.style.display = "block";
  groupBadge.textContent = `✅ In group ${roomCode}`;
  roomCodeEl.textContent = roomCode;
  memberCountLabel.textContent = `${memberCount} member${memberCount === 1 ? "" : "s"}`;
});

window.api.onMemberCount((count) => {
  memberCountLabel.textContent = `${count} member${count === 1 ? "" : "s"}`;
});

window.api.onRoomLeft(() => {
  setupSection.style.display = "block";
  trollSection.style.display = "none";
  actionsSection.style.display = "none";
  groupBadge.style.display = "none";
  statusEl.textContent = "Left the group.";
});

document.getElementById("createRoomBtn").addEventListener("click", () => {
  window.api.createRoom();
  statusEl.textContent = "Creating group...";
});

document.getElementById("joinRoomBtn").addEventListener("click", () => {
  const code = document.getElementById("joinCode").value.trim();
  if (code.length < 4) return;
  window.api.joinRoom(code);
  statusEl.textContent = `Joining ${code}...`;
});

document.getElementById("leaveRoomBtn").addEventListener("click", () => {
  window.api.leaveRoom();
});

// ---- Wallpaper ----

document.getElementById("pickImageBtn").addEventListener("click", async () => {
  const filePath = await window.api.pickImage();
  if (!filePath) return;
  statusEl.textContent = "Sending wallpaper to the group...";
  try {
    await window.api.sendWallpaperToGroup(filePath);
    statusEl.textContent = "Sent to everyone else in the group 😈";
  } catch (err) {
    statusEl.textContent = `Failed to send: ${err.message}`;
  }
});

// ---- Media (mp4 / mp3) jump-scare ----

document.getElementById("pickMediaBtn").addEventListener("click", async () => {
  const filePath = await window.api.pickMedia();
  if (!filePath) return;
  statusEl.textContent = "Sending media to the group...";
  try {
    await window.api.sendMediaToGroup(filePath);
    statusEl.textContent = "Sent! It'll play full-screen on their devices 😈";
  } catch (err) {
    statusEl.textContent = `Failed to send: ${err.message}`;
  }
});

// ---- Loudspeaker: push-to-talk broadcast of YOUR OWN mic ----
// This captures audio from the local device's own microphone only
// (standard browser getUserMedia permission), and streams it out to
// the group while the button is held down. It never accesses anyone
// else's microphone.

let micStream = null;
let micRecorder = null;

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function startTalking() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    statusEl.textContent = "Couldn't access your microphone: " + err.message;
    return;
  }

  talkBtn.classList.add("active");
  talkBtn.textContent = "🔴 Talking... (release to stop)";
  window.api.startMic();

  micRecorder = new MediaRecorder(micStream, { mimeType: "audio/webm;codecs=opus" });
  micRecorder.ondataavailable = async (e) => {
    if (e.data.size === 0) return;
    const buf = await e.data.arrayBuffer();
    window.api.sendMicChunk(arrayBufferToBase64(buf));
  };
  micRecorder.start(250); // send a chunk every 250ms
}

function stopTalking() {
  if (micRecorder && micRecorder.state !== "inactive") micRecorder.stop();
  if (micStream) micStream.getTracks().forEach((t) => t.stop());
  micRecorder = null;
  micStream = null;

  talkBtn.classList.remove("active");
  talkBtn.textContent = "Hold to Talk";
  window.api.stopMic();
}

talkBtn.addEventListener("mousedown", startTalking);
talkBtn.addEventListener("mouseup", stopTalking);
talkBtn.addEventListener("mouseleave", () => {
  if (micStream) stopTalking(); // stop if dragged off the button while holding
});

// ---- Receiving someone else's live mic broadcast ----

let playbackMediaSource = null;
let playbackSourceBuffer = null;
let playbackAudioEl = null;
let playbackQueue = [];

window.api.onMicStart((fromCode) => {
  statusEl.textContent = `${fromCode} is talking...`;

  playbackQueue = [];
  playbackMediaSource = new MediaSource();
  playbackAudioEl = new Audio();
  playbackAudioEl.src = URL.createObjectURL(playbackMediaSource);

  playbackMediaSource.addEventListener("sourceopen", () => {
    try {
      playbackSourceBuffer = playbackMediaSource.addSourceBuffer("audio/webm; codecs=opus");
      playbackSourceBuffer.addEventListener("updateend", () => {
        if (playbackQueue.length > 0 && !playbackSourceBuffer.updating) {
          playbackSourceBuffer.appendBuffer(playbackQueue.shift());
        }
      });
    } catch (err) {
      statusEl.textContent = "Playback error: " + err.message;
    }
  });

  playbackAudioEl.play().catch(() => {
    /* Autoplay may need a user gesture on some systems; ignore if blocked. */
  });
});

window.api.onMicChunk(({ audioBase64 }) => {
  if (!playbackSourceBuffer) return;
  const bytes = base64ToUint8Array(audioBase64);
  if (playbackSourceBuffer.updating) {
    playbackQueue.push(bytes);
  } else {
    try {
      playbackSourceBuffer.appendBuffer(bytes);
    } catch {
      playbackQueue.push(bytes);
    }
  }
});

window.api.onMicStop((fromCode) => {
  statusEl.textContent = `${fromCode} stopped talking.`;
  try {
    if (playbackMediaSource && playbackMediaSource.readyState === "open") {
      playbackMediaSource.endOfStream();
    }
  } catch {}
  playbackMediaSource = null;
  playbackSourceBuffer = null;
  playbackQueue = [];
});
