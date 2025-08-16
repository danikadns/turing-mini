// ⚠️ Cambia esto por tu URL pública del backend en Render:
const API_BASE = "https://turing-mini.onrender.com";

const chatEl = document.getElementById('chat');
const form = document.getElementById('form');
const input = document.getElementById('input');
const typingEl = document.getElementById('typing');

let sessionId = null;
let lastIndex = 0; // último i recibido
let ended = false;
let expiresAt = null;
let endTimer = null;

function addMsg(role, text) {
  const div = document.createElement('div');
  div.className = `msg ${role === 'user' ? 'user' : 'bot'}`;
  div.textContent = text;
  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function setTyping(v) {
  typingEl.classList.toggle('hidden', !v);
}

async function startSession(mode) {
  const r = await fetch(`${API_BASE}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }) // puede ser 'AI', 'human' o undefined
  });
  const data = await r.json();
  sessionId = data.sessionId;
  expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
  ended = false;

  if (endTimer) clearTimeout(endTimer);
  if (expiresAt) {
    const ms = Math.max(0, expiresAt.getTime() - Date.now());
    endTimer = setTimeout(() => {
      if (!ended) showDebrief();
    }, ms);
  }
}

async function poll() {
  if (!sessionId) return;
  const r = await fetch(`${API_BASE}/api/messages?sessionId=${encodeURIComponent(sessionId)}&after=${lastIndex}`);
  const data = await r.json();
  const items = data.items || [];

  if (data.awaitingOperator) {
    setTyping(true);
  } else {
    setTyping(false);
  }

  if (data.ended && !ended) {
    ended = true;
    await showDebrief();
  }

  items.forEach(m => {
    lastIndex = Math.max(lastIndex, m.i);
    if (m.role === 'user') return;
    addMsg('bot', m.text);
  });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (ended) {
    addMsg('bot', '⏱️ La sesión ya terminó. Revisa el debrief.');
    return;
  }
  const text = input.value.trim();
  if (!text) return;
  addMsg('user', text);
  input.value = '';
  setTyping(true);

  const r = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, text })
  });
  const data = await r.json();

  if (data.error) {
    addMsg('bot', '⚠️ Error: ' + data.error);
  } else if (data.ended) {
    ended = true;
    await showDebrief();
  }
  setTyping(false);
});

async function showDebrief() {
  if (!sessionId) return;
  const r = await fetch(`${API_BASE}/debrief/${encodeURIComponent(sessionId)}`);
  const data = await r.json();
  if (data.error) {
    alert(data.error);
    return;
  }
  ended = true;
  const who = data.condition === 'AI' ? '🤖 IA' : '👤 Humano';
  alert(`Debrief:\nCondición: ${who}\nMensajes: ${data.transcript.length}`);
}

startSession().then(() => {
  poll();
  setInterval(poll, 2000);
});
