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

  let parsed = [];

  if (body.object === 'whatsapp_business_account') {
    (body.entry || []).forEach((entry) => {
      (entry.changes || []).forEach((change) => {
        const value = change.value || {};

        (value.messages || []).forEach((msg) => {
          const contact = (value.contacts || []).find(
            (c) => c.wa_id === msg.from
          );
          parsed.push({
            id: msg.id,
            type: 'message',
            direction: 'inbound',
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

// ---------- API: reply to a customer via WhatsApp Cloud API ----------
app.post('/api/reply', async (req, res) => {
  const { to, text } = req.body;
  if (!to || !text) {
    return res.status(400).json({ ok: false, error: 'Missing to or text' });
  }

  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.PHONE_NUMBER_ID;

  if (!token || !phoneId) {
    return res.status(500).json({
      ok: false,
      error: 'WHATSAPP_TOKEN or PHONE_NUMBER_ID not configured on server',
    });
  }

  const payload = JSON.stringify({
    messaging_product: 'whatsapp',
    to: to,
    type: 'text',
    text: { body: text },
  });

  const options = {
    hostname: 'graph.facebook.com',
    path: `/v18.0/${phoneId}/messages`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Content-Length': Buffer.byteLength(payload),
    },
  };

  const apiReq = https.request(options, (apiRes) => {
    let data = '';
    apiRes.on('data', (chunk) => (data += chunk));
    apiRes.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (apiRes.statusCode === 200) {
          // Store the outbound reply in our messages list
          const replyMsg = {
            id: json.messages?.[0]?.id || `reply-${Date.now()}`,
            type: 'message',
            direction: 'outbound',
            messageType: 'text',
            from: 'agent',
            to: to,
            name: 'Agent',
            text: text,
            timestamp: new Date().toISOString(),
          };
          messages.push(replyMsg);
          broadcast(replyMsg);
          res.json({ ok: true, messageId: replyMsg.id });
        } else {
          console.error('WhatsApp API error:', data);
          res.status(apiRes.statusCode).json({ ok: false, error: json });
        }
      } catch (e) {
        res.status(500).json({ ok: false, error: 'Failed to parse API response' });
      }
    });
  });

  apiReq.on('error', (err) => {
    console.error('Reply request failed:', err);
    res.status(500).json({ ok: false, error: err.message });
  });

  apiReq.write(payload);
  apiReq.end();
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
<title>Arkan CS Inbox</title>
<style>
  :root {
    --bg: #0f1317;
    --sidebar-bg: #111b21;
    --chat-bg: #0b141a;
    --header-bg: #1f2c33;
    --surface: #202c33;
    --border: #2a3942;
    --text: #e9edef;
    --text2: #8696a0;
    --green: #00a884;
    --green-dark: #005c4b;
    --bubble-in: #202c33;
    --bubble-out: #005c4b;
    --red: #ef4444;
    --yellow: #f59e0b;
    --blue: #53bdeb;
    --unread: #00a884;
    --mono: 'SF Mono','Cascadia Code','Fira Code',monospace;
    --radius: 8px;
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: -apple-system,system-ui,'Segoe UI',sans-serif; background:var(--bg); color:var(--text); height:100vh; overflow:hidden; display:flex; flex-direction:column; }

  /* ── Top bar ── */
  .topbar { background:var(--header-bg); border-bottom:1px solid var(--border); padding:0 16px; height:56px; display:flex; align-items:center; gap:12px; flex-shrink:0; z-index:10; }
  .topbar .logo { width:36px; height:36px; background:var(--green); border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:18px; flex-shrink:0; }
  .topbar h1 { font-size:15px; font-weight:600; }
  .topbar .sub { font-size:12px; color:var(--text2); margin-top:1px; }
  .topbar .spacer { flex:1; }
  .topbar .pill { background:var(--surface); border:1px solid var(--border); border-radius:20px; padding:5px 12px; font-size:12px; color:var(--text2); display:flex; align-items:center; gap:6px; cursor:pointer; }
  .topbar .pill:hover { background:var(--border); color:var(--text); }
  .topbar .dot { width:7px; height:7px; background:var(--green); border-radius:50%; animation:pulse 2s infinite; }
  @keyframes pulse { 0%,100%{opacity:1}50%{opacity:.35} }
  .topbar button { background:none; border:1px solid var(--border); color:var(--text2); border-radius:6px; padding:5px 12px; font-size:12px; cursor:pointer; }
  .topbar button:hover { background:var(--border); color:var(--text); }
  .topbar button.danger { border-color:var(--red); color:var(--red); }
  .topbar button.primary { background:var(--green); border-color:var(--green); color:#fff; }
  .topbar button.primary:hover { opacity:.85; }

  /* ── Layout ── */
  .layout { flex:1; display:flex; overflow:hidden; }

  /* ── Sidebar ── */
  .sidebar { width:340px; min-width:280px; max-width:380px; background:var(--sidebar-bg); border-right:1px solid var(--border); display:flex; flex-direction:column; flex-shrink:0; }
  .sidebar-head { padding:12px 16px 8px; border-bottom:1px solid var(--border); }
  .sidebar-head h2 { font-size:13px; color:var(--text2); font-weight:500; margin-bottom:8px; text-transform:uppercase; letter-spacing:.5px; }
  .search-wrap { position:relative; }
  .search-wrap input { width:100%; background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:7px 12px 7px 34px; font-size:13px; color:var(--text); outline:none; }
  .search-wrap input::placeholder { color:var(--text2); }
  .search-wrap input:focus { border-color:var(--green); }
  .search-wrap .si { position:absolute; left:10px; top:50%; transform:translateY(-50%); color:var(--text2); font-size:14px; pointer-events:none; }
  .conv-list { flex:1; overflow-y:auto; }
  .conv-item { display:flex; align-items:center; gap:12px; padding:12px 16px; cursor:pointer; border-bottom:1px solid var(--border); transition:background .15s; }
  .conv-item:hover { background:var(--surface); }
  .conv-item.active { background:var(--surface); border-left:3px solid var(--green); padding-left:13px; }
  .conv-avatar { width:44px; height:44px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:18px; font-weight:700; color:#fff; flex-shrink:0; }
  .conv-info { flex:1; min-width:0; }
  .conv-name { font-size:14px; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .conv-preview { font-size:12px; color:var(--text2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px; }
  .conv-meta { display:flex; flex-direction:column; align-items:flex-end; gap:4px; flex-shrink:0; }
  .conv-time { font-size:11px; color:var(--text2); }
  .conv-badge { background:var(--unread); color:#fff; font-size:11px; font-weight:600; min-width:18px; height:18px; border-radius:9px; display:flex; align-items:center; justify-content:center; padding:0 5px; }
  .sidebar-empty { flex:1; display:flex; align-items:center; justify-content:center; color:var(--text2); font-size:13px; text-align:center; padding:24px; }

  /* ── Chat panel ── */
  .chat-panel { flex:1; display:flex; flex-direction:column; background:var(--chat-bg); min-width:0; }
  .chat-welcome { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; color:var(--text2); text-align:center; padding:40px; gap:12px; }
  .chat-welcome .icon { font-size:64px; margin-bottom:4px; }
  .chat-welcome h3 { font-size:16px; color:var(--text); font-weight:500; }
  .chat-welcome p { font-size:13px; max-width:280px; }

  .chat-header { background:var(--header-bg); border-bottom:1px solid var(--border); padding:10px 20px; display:flex; align-items:center; gap:12px; flex-shrink:0; }
  .chat-header .avatar { width:38px; height:38px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:16px; font-weight:700; color:#fff; flex-shrink:0; }
  .chat-header .info .name { font-size:14px; font-weight:600; }
  .chat-header .info .phone { font-size:12px; color:var(--text2); margin-top:1px; }
  .chat-header .hactions { margin-left:auto; display:flex; gap:8px; }
  .chat-header .hactions button { background:none; border:none; color:var(--text2); cursor:pointer; font-size:18px; padding:4px 8px; border-radius:6px; }
  .chat-header .hactions button:hover { background:var(--border); color:var(--text); }

  .chat-messages { flex:1; overflow-y:auto; padding:16px 60px; display:flex; flex-direction:column; gap:2px; }
  .day-sep { text-align:center; margin:12px 0 8px; }
  .day-sep span { background:var(--surface); color:var(--text2); font-size:11px; padding:4px 10px; border-radius:6px; }

  .bubble-wrap { display:flex; margin-bottom:4px; }
  .bubble-wrap.out { justify-content:flex-end; }
  .bubble { max-width:62%; padding:7px 10px 5px; border-radius:8px; font-size:14px; line-height:1.45; position:relative; word-break:break-word; }
  .bubble.in { background:var(--bubble-in); border-top-left-radius:0; }
  .bubble.out { background:var(--bubble-out); border-top-right-radius:0; color:#e9edef; }
  .bubble .btext { }
  .bubble .bmeta { display:flex; align-items:center; justify-content:flex-end; gap:4px; margin-top:3px; }
  .bubble .btime { font-size:11px; color:rgba(255,255,255,.45); }
  .bubble.in .btime { color:var(--text2); }
  .bubble .btick { font-size:13px; color:var(--blue); }

  .status-sep { text-align:center; margin:4px 0; }
  .status-sep span { font-size:11px; color:var(--text2); background:rgba(32,44,51,.7); padding:2px 8px; border-radius:4px; }

  .chat-empty { flex:1; display:flex; align-items:center; justify-content:center; color:var(--text2); font-size:13px; }

  /* ── Reply box ── */
  .reply-bar { background:var(--header-bg); border-top:1px solid var(--border); padding:10px 16px; display:flex; align-items:flex-end; gap-10px; gap:10px; flex-shrink:0; }
  .reply-bar textarea { flex:1; background:var(--surface); border:1px solid var(--border); border-radius:22px; padding:10px 16px; font-size:14px; color:var(--text); resize:none; outline:none; min-height:42px; max-height:120px; font-family:inherit; line-height:1.4; }
  .reply-bar textarea::placeholder { color:var(--text2); }
  .reply-bar textarea:focus { border-color:var(--green); }
  .reply-bar .send-btn { width:42px; height:42px; border-radius:50%; background:var(--green); border:none; color:#fff; font-size:18px; cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0; transition:opacity .15s; }
  .reply-bar .send-btn:hover { opacity:.85; }
  .reply-bar .send-btn:disabled { opacity:.4; cursor:not-allowed; }

  /* ── Webhook info bar ── */
  .info-bar { background:var(--surface); border-top:1px solid var(--border); padding:7px 20px; font-size:11px; color:var(--text2); display:flex; gap:16px; align-items:center; flex-wrap:wrap; flex-shrink:0; }
  .info-bar strong { color:var(--text); }
  .info-bar .url-chip { background:var(--bg); color:var(--green); padding:3px 8px; border-radius:4px; font-family:var(--mono); font-size:11px; cursor:pointer; user-select:all; }
  .info-bar .url-chip:hover { opacity:.8; }

  /* ── Scrollbar ── */
  ::-webkit-scrollbar { width:5px; }
  ::-webkit-scrollbar-track { background:transparent; }
  ::-webkit-scrollbar-thumb { background:var(--border); border-radius:3px; }

  /* ── Toast ── */
  #toast { position:fixed; bottom:24px; left:50%; transform:translateX(-50%) translateY(20px); background:#1f2c33; border:1px solid var(--border); color:var(--text); padding:9px 18px; border-radius:8px; font-size:13px; opacity:0; transition:all .25s; pointer-events:none; z-index:999; }
  #toast.show { opacity:1; transform:translateX(-50%) translateY(0); }

  @media(max-width:680px){
    .sidebar { width:100%; display:none; }
    .sidebar.mobile-show { display:flex; position:absolute; z-index:50; height:calc(100vh - 56px); top:56px; left:0; right:0; }
    .chat-messages { padding:12px 12px; }
    .bubble { max-width:88%; }
  }
</style>
</head>
<body>

<!-- Top bar -->
<div class="topbar">
  <div class="logo">💬</div>
  <div>
    <div style="font-size:15px;font-weight:600">Arkan CS Inbox</div>
    <div style="font-size:11px;color:var(--text2)">WhatsApp Customer Support</div>
  </div>
  <div class="spacer"></div>
  <div class="pill"><div class="dot"></div>Live</div>
  <button class="primary" onclick="sendTest()">🧪 Test Msg</button>
  <button class="danger" onclick="clearAll()">🗑</button>
</div>

<!-- Layout -->
<div class="layout">

  <!-- Sidebar -->
  <div class="sidebar" id="sidebar">
    <div class="sidebar-head">
      <h2>Conversations <span id="convCount" style="color:var(--green)"></span></h2>
      <div class="search-wrap">
        <span class="si">🔍</span>
        <input type="text" id="searchInput" placeholder="Search by name or number…" oninput="renderSidebar()">
      </div>
    </div>
    <div class="conv-list" id="convList">
      <div class="sidebar-empty">No conversations yet.<br>Send a WhatsApp message or click Test.</div>
    </div>
  </div>

  <!-- Chat panel -->
  <div class="chat-panel" id="chatPanel">
    <div class="chat-welcome" id="chatWelcome">
      <div class="icon">📨</div>
      <h3>Select a conversation</h3>
      <p>Pick a customer from the left panel to view their messages and reply.</p>
      <div style="margin-top:16px;font-size:12px;color:var(--text2)">
        Webhook: <span id="webhookUrl2" class="url-chip" onclick="copyUrl()"></span>
      </div>
    </div>

    <div id="chatActive" style="display:none;flex:1;flex-direction:column;min-height:0;">
      <div class="chat-header" id="chatHeader"></div>
      <div class="chat-messages" id="chatMessages"></div>
      <div class="reply-bar">
        <textarea id="replyInput" placeholder="Type a message…" rows="1" onkeydown="replyKeydown(event)" oninput="autoResize(this)"></textarea>
        <button class="send-btn" id="sendBtn" onclick="sendReply()" title="Send">➤</button>
      </div>
    </div>
  </div>

</div>

<!-- Info bar -->
<div class="info-bar">
  <span><strong>Token:</strong> arkan_webhook_test_2026</span>
  <span><strong>POST</strong> /webhook → messages</span>
  <span><strong>POST</strong> /api/reply → send reply</span>
  <span class="url-chip" id="webhookUrl" onclick="copyUrl()"></span>
</div>

<div id="toast"></div>

<script>
// ───────── State ─────────
let allMessages = [];
let conversations = {}; // keyed by phone number
let activePhone = null;

const avatarColors = ['#7c3aed','#0891b2','#059669','#d97706','#dc2626','#7c3aed','#db2777'];
function avatarColor(phone) {
  let h = 0;
  for (let i = 0; i < phone.length; i++) h = (h * 31 + phone.charCodeAt(i)) & 0xffffffff;
  return avatarColors[Math.abs(h) % avatarColors.length];
}
function initials(name) {
  if (!name) return '?';
  const p = name.trim().split(/ +/);
  if (p.length >= 2) return (p[0][0] + p[p.length-1][0]).toUpperCase();
  return name.slice(0,2).toUpperCase();
}

// ───────── URL ─────────
const base = location.origin;
document.getElementById('webhookUrl').textContent = base + '/webhook';
const el2 = document.getElementById('webhookUrl2');
if (el2) el2.textContent = base + '/webhook';

function copyUrl() {
  navigator.clipboard.writeText(base + '/webhook');
  showToast('📋 Webhook URL copied!');
}

// ───────── Toast ─────────
function showToast(msg, dur=2200) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), dur);
}

// ───────── Build conversations map ─────────
function buildConversations(msgs) {
  const map = {};
  msgs.forEach(m => {
    if (m.type === 'clear') return;
    const phone = m.direction === 'outbound' ? m.to : m.from;
    if (!phone || phone === 'agent') return;
    if (!map[phone]) {
      map[phone] = {
        phone,
        name: (m.direction === 'inbound' ? m.name : null) || phone,
        messages: [],
        unread: 0,
      };
    }
    if (m.type === 'message') {
      map[phone].messages.push(m);
      if (m.direction === 'inbound' && phone !== activePhone) {
        // will recalc unread properly below
      }
      // update name from latest inbound
      if (m.direction === 'inbound' && m.name && m.name !== m.from) {
        map[phone].name = m.name;
      }
    } else if (m.type === 'status') {
      // attach statuses to the conversation by recipientId
      const rp = m.recipientId;
      if (rp && map[rp]) map[rp].messages.push(m);
    }
  });
  return map;
}

function getUnreadCount(conv) {
  if (conv.phone === activePhone) return 0;
  // Count inbound messages after last outbound
  let last = -1;
  conv.messages.forEach((m,i) => { if (m.direction === 'outbound') last = i; });
  return conv.messages.filter((m,i) => i > last && m.direction === 'inbound').length;
}

// ───────── Sidebar render ─────────
function renderSidebar() {
  const q = (document.getElementById('searchInput').value || '').toLowerCase();
  const list = document.getElementById('convList');
  const convs = Object.values(conversations).sort((a,b) => {
    const at = a.messages[a.messages.length-1]?.timestamp || '';
    const bt = b.messages[b.messages.length-1]?.timestamp || '';
    return bt.localeCompare(at);
  }).filter(c => !q || c.name.toLowerCase().includes(q) || c.phone.includes(q));

  document.getElementById('convCount').textContent = convs.length ? '(' + convs.length + ')' : '';

  if (convs.length === 0) {
    list.innerHTML = '<div class="sidebar-empty">No conversations yet.<br>Send a WhatsApp message or click Test.</div>';
    return;
  }

  list.innerHTML = convs.map(conv => {
    const last = conv.messages.filter(m => m.type==='message').slice(-1)[0];
    const preview = last ? (last.direction==='outbound' ? '✓ You: ' : '') + escHtml(last.text || '') : '';
    const time = last ? fmtTime(last.timestamp) : '';
    const unread = getUnreadCount(conv);
    const color = avatarColor(conv.phone);
    const ini = initials(conv.name);
    const isActive = conv.phone === activePhone;
    return '<div class="conv-item' + (isActive?' active':'') + '" onclick="selectConv(&quot;' + conv.phone + '&quot;)">'
      + '<div class="conv-avatar" style="background:' + color + '">' + ini + '</div>'
      + '<div class="conv-info">'
      + '<div class="conv-name">' + escHtml(conv.name) + '</div>'
      + '<div class="conv-preview">' + preview + '</div>'
      + '</div>'
      + '<div class="conv-meta">'
      + '<div class="conv-time">' + time + '</div>'
      + (unread ? '<div class="conv-badge">' + unread + '</div>' : '')
      + '</div>'
      + '</div>';
  }).join('');
}

// ───────── Chat panel render ─────────
function renderChat() {
  if (!activePhone) {
    document.getElementById('chatWelcome').style.display = '';
    document.getElementById('chatActive').style.display = 'none';
    return;
  }
  document.getElementById('chatWelcome').style.display = 'none';
  const ca = document.getElementById('chatActive');
  ca.style.display = 'flex';

  const conv = conversations[activePhone];
  if (!conv) return;

  // Header
  const color = avatarColor(conv.phone);
  const ini = initials(conv.name);
  document.getElementById('chatHeader').innerHTML =
    '<div class="avatar" style="background:' + color + '">' + ini + '</div>'
    + '<div class="info"><div class="name">' + escHtml(conv.name) + '</div>'
    + '<div class="phone">+' + conv.phone + '</div></div>'
    + '<div class="hactions"><button title="Copy number" onclick="navigator.clipboard.writeText(&quot;+' + conv.phone + '&quot;);showToast(&quot;Copied&quot;)">📋</button></div>';

  // Messages
  const msgs = conv.messages;
  const cm = document.getElementById('chatMessages');
  if (msgs.length === 0) {
    cm.innerHTML = '<div class="chat-empty">No messages yet.</div>';
    return;
  }

  let html = '';
  let lastDay = '';
  msgs.forEach(m => {
    if (m.type === 'status') {
      const icons = {sent:'✓',delivered:'✓✓',read:'✓✓',failed:'✗'};
      const col = {read:'var(--blue)',failed:'var(--red)'};
      html += '<div class="status-sep"><span style="color:' + (col[m.status]||'var(--text2)') + '">'
        + (icons[m.status]||'•') + ' ' + escHtml(m.status) + '</span></div>';
      return;
    }
    if (m.type !== 'message') return;
    const day = m.timestamp ? new Date(m.timestamp).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '';
    if (day && day !== lastDay) {
      html += '<div class="day-sep"><span>' + day + '</span></div>';
      lastDay = day;
    }
    const isOut = m.direction === 'outbound';
    html += '<div class="bubble-wrap' + (isOut?' out':'') + '">'
      + '<div class="bubble ' + (isOut?'out':'in') + '">'
      + '<div class="btext">' + escHtml(m.text) + '</div>'
      + '<div class="bmeta">'
      + '<span class="btime">' + fmtTimeFull(m.timestamp) + '</span>'
      + (isOut ? '<span class="btick">✓✓</span>' : '')
      + '</div></div></div>';
  });

  cm.innerHTML = html;
  cm.scrollTop = cm.scrollHeight;
}

// ───────── Select conversation ─────────
function selectConv(phone) {
  activePhone = phone;
  renderSidebar();
  renderChat();
  document.getElementById('replyInput').focus();
}

// ───────── Reply ─────────
function replyKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendReply();
  }
}
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}
async function sendReply() {
  if (!activePhone) return;
  const inp = document.getElementById('replyInput');
  const text = inp.value.trim();
  if (!text) return;
  const btn = document.getElementById('sendBtn');
  btn.disabled = true;
  inp.value = '';
  inp.style.height = '';
  try {
    const r = await fetch('/api/reply', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ to: activePhone, text }),
    });
    const j = await r.json();
    if (!j.ok) {
      showToast('⚠️ ' + (j.error?.error?.message || JSON.stringify(j.error) || 'Send failed'), 3500);
      inp.value = text; // restore
    }
  } catch(e) {
    showToast('⚠️ Network error: ' + e.message, 3000);
    inp.value = text;
  }
  btn.disabled = false;
  inp.focus();
}

// ───────── Test & Clear ─────────
async function sendTest() {
  await fetch('/api/test', { method:'POST' });
  showToast('🧪 Test message sent!');
}
async function clearAll() {
  if (!confirm('Clear all messages?')) return;
  await fetch('/api/messages', { method:'DELETE' });
}

// ───────── Helpers ─────────
function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function esc(s) { return String(s); }
function fmtTime(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return 'now';
    if (diff < 3600) return Math.floor(diff/60) + 'm';
    if (diff < 86400) return d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
    if (diff < 604800) return d.toLocaleDateString('en-GB',{weekday:'short'});
    return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'});
  } catch { return ''; }
}
function fmtTimeFull(ts) {
  if (!ts) return '';
  try { return new Date(ts).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}); }
  catch { return ''; }
}

// ───────── Full render ─────────
function fullRender() {
  conversations = buildConversations(allMessages);
  renderSidebar();
  renderChat();
}

// ───────── Load existing + SSE ─────────
function loadMsgs() {
  fetch('/api/messages').then(r=>r.json()).then(data => {
    if (data.length !== allMessages.length) { allMessages = data; fullRender(); }
  }).catch(()=>{});
}
loadMsgs();
setInterval(loadMsgs, 5000);

const es = new EventSource('/events');
es.onmessage = (e) => {
  const data = JSON.parse(e.data);
  if (data.type === 'clear') {
    allMessages = [];
    activePhone = null;
  } else {
    allMessages.push(data);
    // If new inbound from active conv, just re-render chat; else re-render sidebar for badge
  }
  fullRender();
  // Auto-select first conversation if none selected
  if (!activePhone && Object.keys(conversations).length > 0) {
    const first = Object.values(conversations).sort((a,b) => {
      const at = a.messages[a.messages.length-1]?.timestamp || '';
      const bt = b.messages[b.messages.length-1]?.timestamp || '';
      return bt.localeCompare(at);
    })[0];
    if (first) selectConv(first.phone);
  }
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
    }, 4 * 60 * 1000);
  }
});
