/**
 * Wallpaper Troll - Relay Server
 * ------------------------------
 * Purpose: let two clients find each other via a short pairing code and
 * exchange messages, WITHOUT ever storing images or wallpaper data.
 *
 * The server never sets anyone's wallpaper itself - it just forwards
 * JSON messages between two sockets that have BOTH explicitly agreed
 * to be paired. No pairing = no message forwarding.
 *
 * Flow:
 *  1. Client connects -> server assigns it a random 6-char code.
 *  2. Client A sends { type: "pair-request", code: "<B's code>" }
 *  3. Server forwards a "pair-request" to Client B, including A's code.
 *  4. Client B replies { type: "pair-response", code: "<A's code>", accept: true|false }
 *  5. If accepted, server marks A<->B as paired and will now relay any
 *     further messages between them (e.g. "set-wallpaper").
 *  6. Either side can send { type: "unpair" } to end the session.
 */

const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

// code -> { ws, pairedWith: code|null }
const clients = new Map();

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (clients.has(code));
  return code;
}

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

wss.on("connection", (ws) => {
  const code = generateCode();
  clients.set(code, { ws, pairedWith: null });
  ws.myCode = code;

  send(ws, { type: "registered", code });
  console.log(`[+] Client connected: ${code}`);

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return; // ignore malformed input
    }

    const self = clients.get(ws.myCode);
    if (!self) return;

    switch (msg.type) {
      case "pair-request": {
        const target = clients.get((msg.code || "").toUpperCase());
        if (!target) {
          send(ws, { type: "pair-error", reason: "No device found with that code." });
          return;
        }
        if (target.pairedWith || self.pairedWith) {
          send(ws, { type: "pair-error", reason: "One of you is already paired. Unpair first." });
          return;
        }
        send(target.ws, { type: "pair-request", fromCode: ws.myCode });
        break;
      }

      case "pair-response": {
        const requester = clients.get((msg.code || "").toUpperCase());
        if (!requester) return;

        if (msg.accept) {
          self.pairedWith = requester.ws.myCode;
          requester.pairedWith = ws.myCode;
          send(ws, { type: "paired", withCode: requester.ws.myCode });
          send(requester.ws, { type: "paired", withCode: ws.myCode });
          console.log(`[=] Paired: ${ws.myCode} <-> ${requester.ws.myCode}`);
        } else {
          send(requester.ws, { type: "pair-declined", byCode: ws.myCode });
        }
        break;
      }

      case "unpair": {
        if (self.pairedWith) {
          const other = clients.get(self.pairedWith);
          if (other) {
            other.pairedWith = null;
            send(other.ws, { type: "unpaired", byCode: ws.myCode });
          }
          self.pairedWith = null;
        }
        break;
      }

      // Anything else (e.g. "set-wallpaper") just gets relayed to the
      // paired peer, verbatim, if and only if a pairing exists.
      default: {
        if (!self.pairedWith) {
          send(ws, { type: "error", reason: "You are not paired with anyone yet." });
          return;
        }
        const peer = clients.get(self.pairedWith);
        if (peer) {
          send(peer.ws, { ...msg, fromCode: ws.myCode });
        }
      }
    }
  });

  ws.on("close", () => {
    const self = clients.get(ws.myCode);
    if (self?.pairedWith) {
      const other = clients.get(self.pairedWith);
      if (other) {
        other.pairedWith = null;
        send(other.ws, { type: "unpaired", byCode: ws.myCode });
      }
    }
    clients.delete(ws.myCode);
    console.log(`[-] Client disconnected: ${ws.myCode}`);
  });
});

console.log(`Wallpaper Troll relay server listening on ws://0.0.0.0:${PORT}`);
