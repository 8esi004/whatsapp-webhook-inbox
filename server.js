const express = require('express');
const http = require('http');
const https = require('https');
const app = express();
const PORT = process.env.PORT || 3456;

// Store messages in memory
const messages = [];
const sseClients = [];

// WhatsApp verify token — change this to match your Meta app config
const VERIFY_TOKEN = 'arkan_webhook_test_2026';

app.use(express.json());

// ---------- SSE stream ----------
app.get('/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  sseClients.push(res);
  req.on('close', () => {
    const i = sseClients.indexOf(res);
    if (i !== -1) sseClients.splice(i, 1);
  });
});

function broadcast(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((c) => c.write(payload));
}

// ---------- WhatsApp webhook verification (GET) ----------
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verified');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// ---------- WhatsApp webhook messages (POST) ----------
app.post('/webhook', (req, res) => {
  const body = req.body;
  const ts = new Date().toISOString();

  // Parse WhatsApp Cloud API payload
  let parsed = [];

  if (body.object === 'whatsapp_business_account') {
    (body.entry || []).forEach((entry) => {
      (entry.changes || []).forEach((change) => {
        const value = change.value || {};

        // Incoming messages
        (value.messages || []).forEach((msg) => {
          const contact = (value.contacts || []).find(
            (c) => c.wa_id === msg.from
          );
          parsed.push({
            id: msg.id,
            type: 'message',
            messageType: msg.type,
            from: msg.from,
            name: contact?.profile?.name || msg.from,
            text:
              msg.text?.body ||
              msg.image?.caption ||
              msg.document?.caption ||
              `[${msg.type}]`,
            timestamp: msg.timestamp
              ? new Date(msg.timestamp * 1000).toISOString()
              : ts,
            raw: msg,
          });
        });

        // Status updates
        (value.statuses || []).forEach((st) => {
          parsed.push({
            id: st.id,
            type: 'status',
            status: st.status,
            recipientId: st.recipient_id,
            timestamp: st.timestamp
              ? new Date(st.timestamp * 1000).toISOString()
              : ts,
            raw: st,
          });
        });
      });
    });
  }

  // If nothing was parsed, store the raw payload
  if (parsed.length === 0) {
    parsed.push({
      id: `raw-${Date.now()}`,
      type: 'raw',
      text: JSON.stringify(body, null, 2),
      timestamp: ts,
      raw: body,
    });
  }

  parsed.forEach((p) => {
    messages.push(p);
    broadcast(p);
  });

  res.sendStatus(200);
});

// ---------- API: get all stored messages ----------
app.get('/api/messages', (_req, res) => {
  res.json(messages);
});

// ---------- API: clear messages ----------
app.delete('/api/messages', (_req, res) => {
  messages.length = 0;
  broadcast({ type: 'clear' });
  res.json({ ok: true });
});

// ---------- API: send test payload ----------
app.post('/api/test', (_req, res) => {
  const fake = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_ID',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '962790000000',
                phone_number_id: '123456',
              },
              contacts: [
                { profile: { name: 'Test Customer' }, wa_id: '962791234567' },
              ],
              messages: [
                {
                  from: '962791234567',
                  id: `wamid.test${Date.now()}`,
                  timestamp: Math.floor(Date.now() / 1000).toString(),
                  text: { body: 'مرحبا، هذه رسالة تجريبية! 🧪' },
                  type: 'text',
                },
              ],
            },
            field: 'messages',
          },
        ],
      },
    ],
  };

  // Post to our own webhook
  const data = JSON.stringify(fake);
  const opts = {
    hostname: 'localhost',
    port: PORT,
    path: '/webhook',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
  };
  const r = http.request(opts, () => res.json({ ok: true, sent: fake }));
  r.write(data);
  r.end();
});

// ---------- Dashboard UI ----------
app.get('/', (_req, res) => {
  res.send(DASHBOARD_HTML);
});

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WhatsApp Webhook Inbox</title>
<style>
  :root {
    --bg: #0b141a;
    --surface: #111b21;
    --border: #222d34;
    --text: #e9edef;
    --text2: #8696a0;
    --green: #00a884;
    --green2: #025144;
    --bubble-in: #202c33;
    --bubble-out: #005c4b;
    --red: #ef4444;
    --yellow: #f59e0b;
    --blue: #3b82f6;
    --mono: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, sans-serif; background: var(--bg); color: var(--text); height: 100vh; display: flex; flex-direction: column; }

  /* Header */
  header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 12px 20px; display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
  header .logo { width: 40px; height: 40px; background: var(--green); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px; }
  header h1 { font-size: 16px; font-weight: 600; }
  header .sub { font-size: 12px; color: var(--text2); }
  header .status { margin-left: auto; display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--green); }
  header .status .dot { width: 8px; height: 8px; background: var(--green); border-radius: 50%; animation: pulse 2s infinite; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .4; } }

  /* Toolbar */
  .toolbar { background: var(--surface); border-bottom: 1px solid var(--border); padding: 10px 20px; display: flex; gap: 8px; align-items: center; flex-shrink: 0; flex-wrap: wrap; }
  .toolbar code { background: var(--bg); color: var(--green); padding: 6px 12px; border-radius: 6px; font-family: var(--mono); font-size: 13px; word-break: break-all; flex: 1; min-width: 200px; }
  .toolbar button { padding: 6px 14px; border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 6px; cursor: pointer; font-size: 12px; white-space: nowrap; }
  .toolbar button:hover { background: var(--border); }
  .toolbar button.primary { background: var(--green); border-color: var(--green); color: #fff; }
  .toolbar button.primary:hover { opacity: .85; }
  .toolbar button.danger { border-color: var(--red); color: var(--red); }

  /* Tabs */
  .tabs { display: flex; border-bottom: 1px solid var(--border); background: var(--surface); flex-shrink: 0; }
  .tab { padding: 10px 20px; font-size: 13px; color: var(--text2); cursor: pointer; border-bottom: 2px solid transparent; }
  .tab.active { color: var(--green); border-color: var(--green); }

  /* Main area */
  main { flex: 1; overflow: hidden; display: flex; }

  /* Chat view */
  #chatView { flex: 1; display: flex; flex-direction: column; }
  .messages { flex: 1; overflow-y: auto; padding: 16px 60px; display: flex; flex-direction: column; gap: 4px; }
  .msg { max-width: 65%; padding: 8px 12px; border-radius: 8px; font-size: 14px; line-height: 1.45; position: relative; }
  .msg.incoming { background: var(--bubble-in); align-self: flex-start; border-top-left-radius: 0; }
  .msg.status-msg { background: var(--green2); align-self: center; font-size: 12px; color: var(--text2); border-radius: 6px; max-width: 80%; text-align: center; }
  .msg.raw-msg { background: #1a1a2e; align-self: center; max-width: 90%; border-radius: 6px; }
  .msg .sender { font-size: 12px; color: var(--green); font-weight: 600; margin-bottom: 2px; }
  .msg .time { font-size: 11px; color: var(--text2); text-align: right; margin-top: 2px; }
  .msg .type-badge { display: inline-block; background: var(--border); color: var(--text2); font-size: 10px; padding: 1px 6px; border-radius: 3px; margin-left: 4px; }
  .empty { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--text2); font-size: 14px; text-align: center; padding: 40px; }

  /* JSON view */
  #jsonView { flex: 1; overflow-y: auto; padding: 16px; display: none; }
  #jsonView pre { font-family: var(--mono); font-size: 12px; line-height: 1.5; color: var(--text2); white-space: pre-wrap; word-break: break-all; }

  /* Info panel */
  .info-panel { background: var(--surface); border-top: 1px solid var(--border); padding: 12px 20px; font-size: 12px; color: var(--text2); flex-shrink: 0; display: flex; gap: 20px; flex-wrap: wrap; }
  .info-panel strong { color: var(--text); }

  /* Counter badge */
  .count { background: var(--green); color: #fff; font-size: 11px; padding: 1px 7px; border-radius: 10px; margin-left: 6px; }

  /* Scrollbar */
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

  @media (max-width: 600px) {
    .messages { padding: 12px; }
    .msg { max-width: 90%; }
    .toolbar code { font-size: 11px; }
  }
</style>
</head>
<body>

<header>
  <div class="logo">📨</div>
  <div>
    <h1>WhatsApp Webhook Inbox</h1>
    <div class="sub">Test & monitor incoming webhooks</div>
  </div>
  <div class="status"><div class="dot"></div> Listening</div>
</header>

<div class="toolbar">
  <code id="webhookUrl"></code>
  <button onclick="copyUrl()" title="Copy webhook URL">📋 Copy</button>
  <button class="primary" onclick="sendTest()">🧪 Send Test</button>
  <button class="danger" onclick="clearAll()">🗑 Clear</button>
</div>

<div class="tabs">
  <div class="tab active" data-tab="chat" onclick="switchTab('chat')">💬 Chat<span class="count" id="msgCount">0</span></div>
  <div class="tab" data-tab="json" onclick="switchTab('json')">{ } Raw JSON</div>
</div>

<main>
  <div id="chatView">
    <div class="messages" id="msgList">
      <div class="empty" id="emptyState">
        <div>
          <div style="font-size:48px;margin-bottom:12px">📡</div>
          <div>Waiting for webhooks…</div>
          <div style="margin-top:8px;font-size:12px">
            Point your WhatsApp webhook to the URL above,<br>
            or click <strong>Send Test</strong> to try it out.
          </div>
        </div>
      </div>
    </div>
  </div>
  <div id="jsonView"><pre id="jsonPre">[]</pre></div>
</main>

<div class="info-panel">
  <div><strong>Verify Token:</strong> arkan_webhook_test_2026</div>
  <div><strong>GET</strong> /webhook → verification</div>
  <div><strong>POST</strong> /webhook → messages</div>
</div>

<script>
const msgList = document.getElementById('msgList');
const jsonPre = document.getElementById('jsonPre');
const emptyState = document.getElementById('emptyState');
const msgCount = document.getElementById('msgCount');
let allMessages = [];
let currentTab = 'chat';

// Set webhook URL display
const base = location.origin;
document.getElementById('webhookUrl').textContent = base + '/webhook';

function copyUrl() {
  navigator.clipboard.writeText(base + '/webhook');
  const btn = event.target.closest('button');
  btn.textContent = '✅ Copied!';
  setTimeout(() => btn.textContent = '📋 Copy', 1500);
}

async function sendTest() {
  await fetch('/api/test', { method: 'POST' });
}

async function clearAll() {
  await fetch('/api/messages', { method: 'DELETE' });
  allMessages = [];
  render();
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.getElementById('chatView').style.display = tab === 'chat' ? 'flex' : 'none';
  document.getElementById('jsonView').style.display = tab === 'json' ? 'block' : 'none';
}

function formatTime(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return ''; }
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function render() {
  // Chat
  const msgs = allMessages.filter(m => m.type !== 'clear');
  if (msgs.length === 0) {
    emptyState.style.display = 'flex';
  } else {
    emptyState.style.display = 'none';
  }
  msgCount.textContent = msgs.length;

  // Build chat HTML (keep empty state, replace rest)
  let html = '';
  msgs.forEach(m => {
    if (m.type === 'message') {
      html += '<div class="msg incoming">'
        + '<div class="sender">' + escHtml(m.name || m.from) + ' <span style="font-weight:400;color:var(--text2)">' + escHtml(m.from) + '</span>'
        + ' <span class="type-badge">' + escHtml(m.messageType || 'text') + '</span></div>'
        + '<div>' + escHtml(m.text) + '</div>'
        + '<div class="time">' + formatTime(m.timestamp) + '</div>'
        + '</div>';
    } else if (m.type === 'status') {
      const icons = { sent: '✓', delivered: '✓✓', read: '✓✓', failed: '✗' };
      const colors = { sent: 'var(--text2)', delivered: 'var(--text2)', read: 'var(--blue)', failed: 'var(--red)' };
      html += '<div class="msg status-msg">'
        + '<span style="color:' + (colors[m.status]||'var(--text2)') + '">' + (icons[m.status]||'•') + '</span> '
        + escHtml(m.status) + ' → ' + escHtml(m.recipientId || '')
        + ' <span style="margin-left:8px">' + formatTime(m.timestamp) + '</span>'
        + '</div>';
    } else if (m.type === 'raw') {
      html += '<div class="msg raw-msg">'
        + '<div class="sender" style="color:var(--yellow)">📦 Raw payload</div>'
        + '<pre style="font-family:var(--mono);font-size:11px;color:var(--text2);white-space:pre-wrap;margin-top:4px">' + escHtml(m.text) + '</pre>'
        + '<div class="time">' + formatTime(m.timestamp) + '</div>'
        + '</div>';
    }
  });

  // Keep the empty state element, add messages after it
  const existing = msgList.querySelectorAll('.msg');
  existing.forEach(e => e.remove());
  msgList.insertAdjacentHTML('beforeend', html);

  // JSON
  jsonPre.textContent = JSON.stringify(msgs.map(m => m.raw || m), null, 2);

  // Auto-scroll
  msgList.scrollTop = msgList.scrollHeight;
}

// Load existing messages
fetch('/api/messages').then(r => r.json()).then(data => {
  allMessages = data;
  render();
});

// SSE for live updates
const es = new EventSource('/events');
es.onmessage = (e) => {
  const data = JSON.parse(e.data);
  if (data.type === 'clear') {
    allMessages = [];
  } else {
    allMessages.push(data);
  }
  render();
};
</script>
</body>
</html>`;

// ---------- Health check / keep-alive ping endpoint ----------
app.get('/ping', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`\n🟢 Webhook Inbox running on http://localhost:${PORT}`);
  console.log(`📡 Webhook URL: http://localhost:${PORT}/webhook`);
  console.log(`🔑 Verify Token: ${VERIFY_TOKEN}\n`);

  // Self-ping every 4 minutes to prevent Render free-tier cold starts
  const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
  if (RENDER_URL) {
    const pingUrl = `${RENDER_URL}/ping`;
    console.log(`⏱  Self-ping enabled → ${pingUrl} (every 4 min)`);
    setInterval(() => {
      const client = pingUrl.startsWith('https') ? https : http;
      client.get(pingUrl, (res) => {
        console.log(`🏓 Self-ping OK [${res.statusCode}]`);
      }).on('error', (err) => {
        console.log(`⚠️  Self-ping failed: ${err.message}`);
      });
    }, 4 * 60 * 1000); // every 4 minutes
  }
});
