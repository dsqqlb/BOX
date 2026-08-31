'use strict';

const WebSocket = require('ws');

/** WebSocket is only a realtime signal layer; message data remains in SQLite via HTTP APIs. */
function createChatServer({ auth }) {
  const wss = new WebSocket.Server({ noServer: true, maxPayload: 12 * 1024 });

  function onlineUsers() {
    return [...new Set([...wss.clients]
      .filter((client) => client.readyState === WebSocket.OPEN && client.user?.username)
      .map((client) => client.user.username))].sort((left, right) => left.localeCompare(right));
  }

  function broadcast(event, exclude = null) {
    const payload = JSON.stringify(event);
    wss.clients.forEach((client) => {
      if (client !== exclude && client.readyState === WebSocket.OPEN) client.send(payload);
    });
  }

  function broadcastPresence() { broadcast({ type: 'PRESENCE', payload: { usernames: onlineUsers() } }); }

  wss.on('connection', (ws) => {
    if (!ws.user || !auth.hasToolAccess(ws.user, 'lan-chat')) return ws.close(1008, 'Unauthorized');
    ws.lastTypingAt = 0;
    ws.typing = false;
    ws.send(JSON.stringify({ type: 'PRESENCE', payload: { usernames: onlineUsers() } }));
    broadcastPresence();

    ws.on('message', (raw) => {
      try {
        const event = JSON.parse(raw.toString());
        if (!ws.user || !auth.hasToolAccess(ws.user, 'lan-chat') || !event || typeof event !== 'object') return;
        if (event.type === 'TYPING' && typeof event.payload?.active === 'boolean') {
          const now = Date.now();
          if (now - ws.lastTypingAt < 350 && event.payload.active) return;
          ws.lastTypingAt = now;
          ws.typing = event.payload.active;
          broadcast({ type: 'TYPING', payload: { username: ws.user.username, active: event.payload.active } }, ws);
        }
      } catch { /* Invalid client event is ignored; no state is changed. */ }
    });
    ws.on('close', () => {
      if (ws.typing && ws.user?.username) broadcast({ type: 'TYPING', payload: { username: ws.user.username, active: false } }, ws);
      broadcastPresence();
    });
    ws.on('error', () => {});
  });

  return { wss, broadcast, broadcastPresence };
}

module.exports = { createChatServer };
