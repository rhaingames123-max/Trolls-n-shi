/**
 * Wallpaper Troll - Relay Server (Group Edition)
 * ------------------------------------------------
 * Anyone can create or join a shared "group code." Everyone in a group
 * can broadcast to everyone else - wallpapers, media files, or live mic
 * audio - never back to themselves. The server never stores or inspects
 * payloads; it just relays JSON messages between members of a group.
 *
 * Message types (client -> server):
 *  - "create-room"                     -> server makes a new group code
 *  - { type: "join-room", code }       -> join an existing group
 *  - { type: "leave-room" }            -> leave current group
 *  - anything else (set-wallpaper, play-media, mic-start, mic-chunk,
 *    mic-stop, etc.) -> broadcast to every OTHER member of your group
 *
 * Message types (server -> client):
 *  - { type: "registered", code }               your personal id
 *  - { type: "room-created", roomCode }
 *  - { type: "room-joined", roomCode, memberCount }
 *  - { type: "room-error", reason }
 *  - { type: "member-joined", memberCount }
 *  - { type: "member-left", memberCount }
 *  - whatever was broadcast, with fromCode added
 */

const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT, maxPayload: 50 * 1024 * 1024 }); // allow larger media payloads

// personalCode -> { ws, roomCode: string|null }
const clients = new Map();
// roomCode -> Set of personalCodes
const rooms = new Map();

function generateCode(existingSet, length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let code;
  do {
    code = Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (existingSet.has(code));
  return code;
}

function send(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function broadcastToRoom(roomCode, obj, excludePersonalCode) {
  const members = rooms.get(roomCode);
  if (!members) return;
  for (const personalCode of members) {
    if (personalCode === excludePersonalCode) continue;
    const entry = clients.get(personalCode);
    if (entry) send(entry.ws, obj);
  }
}

function leaveCurrentRoom(personalCode) {
  const entry = clients.get(personalCode);
  if (!entry || !entry.roomCode) return;
  const roomCode = entry.roomCode;
  const members = rooms.get(roomCode);
  if (members) {
    members.delete(personalCode);
    if (members.size === 0) {
      rooms.delete(roomCode);
    } else {
      broadcastToRoom(roomCode, { type: "member-left", memberCount: members.size }, null);
    }
  }
  entry.roomCode = null;
}

const RESERVED_TYPES = new Set(["create-room", "join-room", "leave-room"]);

wss.on("connection", (ws) => {
  const personalCode = generateCode(clients);
  clients.set(personalCode, { ws, roomCode: null });
  ws.myCode = personalCode;

  send(ws, { type: "registered", code: personalCode });
  console.log(`[+] Client connected: ${personalCode}`);

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const self = clients.get(ws.myCode);
    if (!self) return;

    if (RESERVED_TYPES.has(msg.type)) {
      switch (msg.type) {
        case "create-room": {
          leaveCurrentRoom(ws.myCode);
          const roomCode = generateCode(rooms, 6);
          rooms.set(roomCode, new Set([ws.myCode]));
          self.roomCode = roomCode;
          send(ws, { type: "room-created", roomCode });
          console.log(`[room] ${ws.myCode} created ${roomCode}`);
          break;
        }
        case "join-room": {
          const roomCode = (msg.code || "").toUpperCase();
          const members = rooms.get(roomCode);
          if (!members) {
            send(ws, { type: "room-error", reason: "No group found with that code." });
            return;
          }
          leaveCurrentRoom(ws.myCode);
          members.add(ws.myCode);
          self.roomCode = roomCode;
          send(ws, { type: "room-joined", roomCode, memberCount: members.size });
          broadcastToRoom(roomCode, { type: "member-joined", memberCount: members.size }, ws.myCode);
          console.log(`[room] ${ws.myCode} joined ${roomCode} (${members.size} members)`);
          break;
        }
        case "leave-room": {
          leaveCurrentRoom(ws.myCode);
          send(ws, { type: "room-left" });
          break;
        }
      }
      return;
    }

    // Anything else (set-wallpaper, play-media, mic-start, mic-chunk,
    // mic-stop, ...) - just relay to the rest of the group, verbatim.
    if (!self.roomCode) {
      send(ws, { type: "error", reason: "You're not in a group yet." });
      return;
    }
    broadcastToRoom(self.roomCode, { ...msg, fromCode: ws.myCode }, ws.myCode);
  });

  ws.on("close", () => {
    leaveCurrentRoom(ws.myCode);
    clients.delete(ws.myCode);
    console.log(`[-] Client disconnected: ${ws.myCode}`);
  });
});

console.log(`Wallpaper Troll relay server (group edition) listening on ws://0.0.0.0:${PORT}`);
