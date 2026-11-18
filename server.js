const express = require('express');
const app = express();
const PORT = process.env.PORT || 3456;
const messages = [];
const sseClients = [];
const VERIFY_TOKEN = 'arkan_webhook_test_2026';
app.use(express.json());

app.get('/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  sseClients.push(res);
  req.on('close', () => { const i = sseClients.indexOf(res); if (i !== -1) sseClients.splice(i, 1); });
});

function broadcast(data) {
  const payload = 'data: ' + JSON.stringify(data) + '\n\n';
  sseClients.forEach((c) => c.write(payload));
}

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

app.post('/webhook', (req, res) => {
  const body = req.body;
  const ts = new Date().toISOString();
  let parsed = [];
  if (body.object === 'whatsapp_business_account') {
    (body.entry || []).forEach((entry) => {
      (entry.changes || []).forEach((change) => {
        const value = change.value || {};
        (value.messages || []).forEach((msg) => {
          const contact = (value.contacts || []).find((c) => c.wa_id === msg.from);
          parsed.push({ id: msg.id, type: 'message', messageType: msg.type, from: msg.from, name: (contact && contact.profile && contact.profile.name) || msg.from, text: (msg.text && msg.text.body) || '[' + msg.type + ']', timestamp: msg.timestamp ? new Date(msg.timestamp * 1000).toISOString() : ts, raw: msg });
        });
        (value.statuses || []).forEach((st) => {
          parsed.push({ id: st.id, type: 'status', status: st.status, recipientId: st.recipient_id, timestamp: st.timestamp ? new Date(st.timestamp * 1000).toISOString() : ts, raw: st });
        });
      });
    });
  }
  if (parsed.length === 0) {
    parsed.push({ id: 'raw-' + Date.now(), type: 'raw', text: JSON.stringify(body, null, 2), timestamp: ts, raw: body });
  }
  parsed.forEach((p) => { messages.push(p); broadcast(p); });
  res.sendStatus(200);
});

app.get('/api/messages', (_req, res) => { res.json(messages); });
app.delete('/api/messages', (_req, res) => { messages.length = 0; broadcast({ type: 'clear' }); res.json({ ok: true }); });

app.post('/api/test', (_req, res) => {
  const fake = { object: 'whatsapp_business_account', entry: [{ id: 'WABA_ID', changes: [{ value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '962790000000', phone_number_id: '123456' }, contacts: [{ profile: { name: 'Test Customer' }, wa_id: '962791234567' }], messages: [{ from: '962791234567', id: 'wamid.test' + Date.now(), timestamp: Math.floor(Date.now() / 1000).toString(), text: { body: 'Hello test message!' }, type: 'text' }] }, field: 'messages' }] }] };
  const http = require('http');
  const data = JSON.stringify(fake);
  const opts = { hostname: 'localhost', port: PORT, path: '/webhook', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } };
  const r = http.request(opts, () => res.json({ ok: true }));
  r.write(data);
  r.end();
});

app.get('/', (_req, res) => { res.send('<html><head><title>WhatsApp Webhook Inbox</title><style>:root{--bg:#0b141a;--surface:#111b21;--border:#222d34;--text:#e9edef;--text2:#8696a0;--green:#00a884;--bubble-in:#202c33;--red:#ef4444;--blue:#3b82f6;--mono:monospace}*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:var(--bg);color:var(--text);height:100vh;display:flex;flex-direction:column}header{background:var(--surface);border-bottom:1px solid var(--border);padding:12px 20px;display:flex;align-items:center;gap:12px}header h1{font-size:16px}.toolbar{background:var(--surface);border-bottom:1px solid var(--border);padding:10px 20px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.toolbar code{background:var(--bg);color:var(--green);padding:6px 12px;border-radius:6px;font-family:var(--mono);font-size:13px;flex:1}.toolbar button{padding:6px 14px;border:1px solid var(--border);background:var(--surface);color:var(--text);border-radius:6px;cursor:pointer;font-size:12px}.toolbar button.primary{background:var(--green);border-color:var(--green);color:#fff}.toolbar button.danger{border-color:var(--red);color:var(--red)}.tabs{display:flex;border-bottom:1px solid var(--border);background:var(--surface)}.tab{padding:10px 20px;font-size:13px;color:var(--text2);cursor:pointer;border-bottom:2px solid transparent}.tab.active{color:var(--green);border-color:var(--green)}main{flex:1;overflow:hidden;display:flex}#chatView{flex:1;display:flex;flex-direction:column}.messages{flex:1;overflow-y:auto;padding:16px 60px;display:flex;flex-direction:column;gap:4px}.msg{max-width:65%;padding:8px 12px;border-radius:8px;font-size:14px;line-height:1.45}.msg.incoming{background:var(--bubble-in);align-self:flex-start}.msg.status-msg{background:#025144;align-self:center;font-size:12px;color:var(--text2);text-align:center}.msg.raw-msg{background:#1a1a2e;align-self:center;max-width:90%}.msg .sender{font-size:12px;color:var(--green);font-weight:600;margin-bottom:2px}.msg .time{font-size:11px;color:var(--text2);text-align:right;margin-top:2px}.empty{flex:1;display:flex;align-items:center;justify-content:center;color:var(--text2);font-size:14px;text-align:center;padding:40px}#jsonView{flex:1;overflow-y:auto;padding:16px;display:none}#jsonView pre{font-family:var(--mono);font-size:12px;color:var(--text2);white-space:pre-wrap}.info-panel{background:var(--surface);border-top:1px solid var(--border);padding:12px 20px;font-size:12px;color:var(--text2);display:flex;gap:20px}.info-panel strong{color:var(--text)}.count{background:var(--green);color:#fff;font-size:11px;padding:1px 7px;border-radius:10px;margin-left:6px}</style></head><body><header><div style="width:40px;height:40px;background:var(--green);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px">📨</div><div><h1>WhatsApp Webhook Inbox</h1><div style="font-size:12px;color:var(--text2)">Test and monitor incoming webhooks</div></div><div style="margin-left:auto;display:flex;align-items:center;gap:6px;font-size:12px;color:var(--green)"><div style="width:8px;height:8px;background:var(--green);border-radius:50%"></div> Listening</div></header><div class="toolbar"><code id="webhookUrl"></code><button onclick="copyUrl()">📋 Copy</button><button class="primary" onclick="sendTest()">🧪 Test</button><button class="danger" onclick="clearAll()">🗑 Clear</button></div><div class="tabs"><div class="tab active" data-tab="chat" onclick="switchTab(this)">💬 Chat<span class="count" id="msgCount">0</span></div><div class="tab" data-tab="json" onclick="switchTab(this)">{ } JSON</div></div><main><div id="chatView"><div class="messages" id="msgList"><div class="empty" id="emptyState"><div><div style="font-size:48px;margin-bottom:12px">📡</div><div>Waiting for webhooks...</div></div></div></div></div><div id="jsonView"><pre id="jsonPre">[]</pre></div></main><div class="info-panel"><div><strong>Verify Token:</strong> arkan_webhook_test_2026</div><div><strong>GET</strong> /webhook</div><div><strong>POST</strong> /webhook</div></div><script>const msgList=document.getElementById("msgList"),jsonPre=document.getElementById("jsonPre"),emptyState=document.getElementById("emptyState"),msgCount=document.getElementById("msgCount");let allMessages=[];const base=location.origin;document.getElementById("webhookUrl").textContent=base+"/webhook";function copyUrl(){navigator.clipboard.writeText(base+"/webhook")}async function sendTest(){await fetch("/api/test",{method:"POST"})}async function clearAll(){await fetch("/api/messages",{method:"DELETE"});allMessages=[];render()}function switchTab(el){document.querySelectorAll(".tab").forEach(t=>t.classList.remove("active"));el.classList.add("active");const t=el.dataset.tab;document.getElementById("chatView").style.display=t==="chat"?"flex":"none";document.getElementById("jsonView").style.display=t==="json"?"block":"none"}function escHtml(s){const d=document.createElement("div");d.textContent=s;return d.innerHTML}function render(){const msgs=allMessages.filter(m=>m.type!=="clear");emptyState.style.display=msgs.length===0?"flex":"none";msgCount.textContent=msgs.length;let html="";msgs.forEach(m=>{if(m.type==="message"){html+="<div class=msg incoming><div class=sender>"+escHtml(m.name||m.from)+"</div><div>"+escHtml(m.text)+"</div><div class=time>"+new Date(m.timestamp).toLocaleTimeString()+"</div></div>"}else if(m.type==="status"){html+="<div class=\"msg status-msg\">"+escHtml(m.status)+" → "+escHtml(m.recipientId||"")+"</div>"}else{html+="<div class=\"msg raw-msg\"><pre style=font-family:var(--mono);font-size:11px;color:var(--text2);white-space:pre-wrap>"+escHtml(m.text)+"</pre></div>"}});msgList.querySelectorAll(".msg").forEach(e=>e.remove());msgList.insertAdjacentHTML("beforeend",html);jsonPre.textContent=JSON.stringify(msgs.map(m=>m.raw||m),null,2);msgList.scrollTop=msgList.scrollHeight}fetch("/api/messages").then(r=>r.json()).then(d=>{allMessages=d;render()});const es=new EventSource("/events");es.onmessage=e=>{const d=JSON.parse(e.data);if(d.type==="clear"){allMessages=[]}else{allMessages.push(d)}render()};</script></body></html>'); });

app.listen(PORT, () => { console.log('Server running on port ' + PORT); });
