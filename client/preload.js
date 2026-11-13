const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  createRoom: () => ipcRenderer.invoke("create-room"),
  joinRoom: (code) => ipcRenderer.invoke("join-room", code),
  leaveRoom: () => ipcRenderer.invoke("leave-room"),

  pickImage: () => ipcRenderer.invoke("pick-image"),
  sendWallpaperToGroup: (filePath) => ipcRenderer.invoke("send-wallpaper-to-group", filePath),

  pickMedia: () => ipcRenderer.invoke("pick-media"),
  sendMediaToGroup: (filePath) => ipcRenderer.invoke("send-media-to-group", filePath),

  startMic: () => ipcRenderer.invoke("mic-start"),
  stopMic: () => ipcRenderer.invoke("mic-stop"),
  sendMicChunk: (base64) => ipcRenderer.invoke("mic-chunk", base64),

  onMyCode: (cb) => ipcRenderer.on("my-code", (_e, code) => cb(code)),
  onRoomJoined: (cb) => ipcRenderer.on("room-joined", (_e, data) => cb(data)),
  onRoomLeft: (cb) => ipcRenderer.on("room-left", () => cb()),
  onMemberCount: (cb) => ipcRenderer.on("member-count", (_e, count) => cb(count)),
  onStatus: (cb) => ipcRenderer.on("status", (_e, text) => cb(text)),

  onMicStart: (cb) => ipcRenderer.on("mic-start", (_e, fromCode) => cb(fromCode)),
  onMicChunk: (cb) => ipcRenderer.on("mic-chunk", (_e, data) => cb(data)),
  onMicStop: (cb) => ipcRenderer.on("mic-stop", (_e, fromCode) => cb(fromCode)),
});
