// ⚠️ Cambia esto por tu URL pública del backend en Render:
const API_BASE = "https://turing-mini.onrender.com";

const chatEl = document.getElementById('chat');
const form = document.getElementById('form');
const input = document.getElementById('input');
const typingEl = document.getElementById('typing');
const btnDebrief = document.getElementById('btnDebrief');

let sessionId = null;
let lastIndex = 0; // último i recibido

// Config temporizador (5 minutos)
const SESSION_LIMIT_MS = 5 * 60 * 1000;
let endTimer = null;
let ended = false;

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

// Terminar sesión en el cliente y mostrar debrief
async function endSessionClient() {
  if (ended) return;
  ended = true;

  // Bloquear UI de envío
  input.disabled = true;
  input.placeholder = 'Sesión finalizada';
  const submitBtn = form.querySelector('button');
  if (submitBtn) submitBtn.disabled = true;

  addMsg('bot', 'La sesión ha terminado (5 minutos). Mostrando debrief…');

  // Mostrar debrief
  await showDebrief();
}

// Reusar lógica para ver debrief (se llama desde botón o temporizador)
async function showDebrief() {
  if (!sessionId) return;
  try {
    const r = await fetch(`${API_BASE}/debrief/${encodeURIComponent(sessionId)}`);
    const data = await r.json();
    if (data.error) return alert(data.error);
    const who = data.condition === 'AI' ? '🤖 IA' : '👤 Humano';
    alert(`Debrief:\nCondición: ${who}\nMensajes: ${data.transcript.length}`);
  } catch (e) {
    alert('No se pudo obtener el debrief.');
  }
}

async function startSession(mode) {
  const r = await fetch(`${API_BASE}/api/session`, { 
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }) // se envía AI o human o ""
  });
  const data = await r.json();
  sessionId = data.sessionId;

  // Arrancar temporizador de 5 minutos
  if (endTimer) clearTimeout(endTimer);
  ended = false;
  input.disabled = false;
  const submitBtn = form.querySelector('button');
  if (submitBtn) submitBtn.disabled = false;
  input.placeholder = 'Escribe tu mensaje…';

  endTimer = setTimeout(() => {
    // Cuando se cumpla el tiempo, finalizamos sesión en cliente y mostramos debrief
    endSessionClient();
  }, SESSION_LIMIT_MS);
}

/*
// Evento del botón:
document.getElementById('startBtn').addEventListener('click', async () => {
  const mode = document.getElementById('modeSelect').value;
  await startSession(mode);
  poll();
  setInterval(poll, 2000);
});
*/

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

  if (data.queued) {
    // sin acción extra
  } else if (data.reply) {
    //addMsg('bot', data.reply);
  } else if (data.error) {
    addMsg('bot', '⚠️ Error: ' + data.error);
  }
  setTyping(false);
});

// Si existe el botón, usarlo; si lo quitas, no pasa nada
if (btnDebrief) {
  btnDebrief.addEventListener('click', async () => {
    await showDebrief();
  });
}

startSession().then(() => {
  poll();
  setInterval(poll, 2000);
});
