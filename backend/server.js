import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { nanoid } from 'nanoid';

const app = express();
const PORT = process.env.PORT || 3000;



// CORS: permitir tu dominio de Netlify (o * en dev)
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || '*';
app.use(cors({
  origin: (origin, cb) => cb(null, ALLOWED_ORIGIN === '*' ? true : origin === ALLOWED_ORIGIN),
  credentials: true
}));

app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

// Protección opcional básica para /operator y /export
const BASIC_USER = process.env.BASIC_AUTH_USER || null;
const BASIC_PASS = process.env.BASIC_AUTH_PASS || null;
function requireBasicAuth(req, res, next) {
  if (!BASIC_USER || !BASIC_PASS) return next();
  const header = req.headers.authorization || '';
  const [type, b64] = header.split(' ');
  if (type !== 'Basic' || !b64) return res.status(401).set('WWW-Authenticate', 'Basic').send('Auth requerida');
  const [u, p] = Buffer.from(b64, 'base64').toString().split(':');
  if (u === BASIC_USER && p === BASIC_PASS) return next();
  return res.status(401).set('WWW-Authenticate', 'Basic').send('Credenciales inválidas');
}

// --- Memoria en RAM ---
/**
 * sessions Map: id -> {
 *   id, condition: 'AI'|'human', createdAt, messages: [{i,role:'user'|'ai'|'human',text,t}],
 *   awaitingOperator: boolean
 * }
 */
const sessions = new Map();
let globalIndex = 0; // contador para messages.i

// Utilidades
function createSession() {
  const id = nanoid(10);
  const condition = Math.random() < 0.5 ? 'AI' : 'human';
  const s = { id, condition, createdAt: new Date().toISOString(), messages: [], awaitingOperator: false };
  sessions.set(id, s);
  return s;
}
function pushMessage(session, role, text) {
  const msg = { i: ++globalIndex, role, text, t: new Date().toISOString() };
  session.messages.push(msg);
  return msg;
}
function isAwaitingOperator(session) {
  if (session.condition !== 'human') return false;
  const last = session.messages[session.messages.length - 1];
  return !!last && last.role === 'user';
}

// Gemini proxy (o stub)
//async function askGemini(prompt, history = []) {
  // Si no hay API key -> responder stub
  //if (!process.env.GEMINI_API_KEY) {
    //return `🧪 (Stub IA) Me pediste: "${prompt}". Si configuras GEMINI_API_KEY responderé con Gemini.`;
  //}
// Gemini proxy (o stub)
// Gemini proxy (o stub)
async function askGemini(prompt, history = []) {
  // Si no hay API key -> responder stub "humanoide"
  if (!process.env.GEMINI_API_KEY) {
    const plantillas = [
      txt => `Vale, te entiendo. Sobre eso: ${txt ? 'déjame pensar un segundo…' : ''}`,
      txt => `Gracias por contarlo. ¿Qué te gustaría lograr exactamente?`,
      txt => `Tiene sentido. Puedo darte una mano con eso.`,
      txt => `Ok. ¿Podrías darme un poco más de contexto?`
    ];
    const t = plantillas[Math.floor(Math.random() * plantillas.length)];
    return t(prompt);
  }

  // Instrucciones de estilo "humano"
  const persona = `
    Habla como un operador humano latinoamericano, amable y conciso.
    - Respuestas de 1 a 3 frases, tono natural.
    - Puedes usar muletillas leves: “vale”, “bien”, “ok”, “mmm…”.
    - Evita sonar a IA (no digas “como modelo de lenguaje”, ni cites tu entrenamiento).
    - Comete imperfecciones sutiles (una pausa, un “eh”), pero no errores ortográficos.
    - Si falta contexto, pide 1 dato puntual antes de responder en exceso.
  `;

  const contents = [
    { role: 'user', parts: [{ text: persona.trim() }] },
    ...history.map(h => ({
      role: h.role === 'user' ? 'user' : 'model',
      parts: [{ text: h.text }]
    })),
    { role: 'user', parts: [{ text: prompt }] }
  ];

  // API Gemini
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents })
  });

  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Gemini HTTP ${r.status}: ${txt}`);
  }

  const data = await r.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
    'No obtuve respuesta del modelo.';

  return text;
}


// --- Rutas públicas ---
app.get('/', (req, res) => res.send('pong'));

// Crear sesión
app.post('/api/session', (req, res) => {
  const s = createSession();
  res.json({ sessionId: s.id });
});

// Enviar mensaje desde el cliente
app.post('/api/chat', async (req, res) => {
  try {
    const { sessionId, text } = req.body || {};
    if (!sessionId || !text) return res.status(400).json({ error: 'sessionId y text son requeridos' });
    const s = sessions.get(sessionId);
    if (!s) return res.status(404).json({ error: 'Sesión no encontrada' });

    pushMessage(s, 'user', String(text).slice(0, 2000)); // límite sencillo

    if (s.condition === 'AI') {
  const history = s.messages.filter(m => m.role !== 'ai');
  // Latencia simulada: base 600–1800ms + 20ms por carácter (máx 2.5s)
  const delayMs = Math.min(2500, 600 + Math.random()*1200 + String(text).length*20);
  await new Promise(r => setTimeout(r, delayMs));

  const reply = await askGemini(text, history);
  pushMessage(s, 'ai', reply);
  return res.json({ reply, queued: false });
}else {
      s.awaitingOperator = true;
      return res.json({ queued: true });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error procesando el mensaje' });
  }
});

// Poll de mensajes nuevos del cliente (después del índice i)
app.get('/api/messages', (req, res) => {
  const { sessionId, after } = req.query;
  const s = sessions.get(sessionId);
  if (!s) return res.status(404).json({ error: 'Sesión no encontrada' });
  const a = Number(after || 0);
  const news = s.messages.filter(m => m.i > a);
  res.json({
    items: news,
    awaitingOperator: isAwaitingOperator(s)
  });
});

// Debrief: revelar condición y transcript
app.get('/debrief/:id', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Sesión no encontrada' });
  res.json({
    sessionId: s.id,
    condition: s.condition,
    createdAt: s.createdAt,
    transcript: s.messages
  });
});

// Exportar todas las sesiones
app.get('/export', requireBasicAuth, (req, res) => {
  const all = [...sessions.values()];
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="sessions.json"`);
  res.send(JSON.stringify(all, null, 2));
});

// --- Panel de operador (en el backend) ---
app.use('/operator', requireBasicAuth, express.static('public'));

// Listado de sesiones humanas con mensajes por responder
app.get('/api/operator/inbox', requireBasicAuth, (req, res) => {
  const items = [];
  for (const s of sessions.values()) {
    if (s.condition !== 'human') continue;
    if (isAwaitingOperator(s)) {
      const lastUser = [...s.messages].reverse().find(m => m.role === 'user');
      items.push({
        sessionId: s.id,
        lastUserText: lastUser?.text || '',
        lastAt: lastUser?.t || s.createdAt
      });
    }
  }
  items.sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
  res.json({ items });
});

// Ver transcript completo de una sesión
app.get('/api/operator/messages', requireBasicAuth, (req, res) => {
  const { sessionId } = req.query;
  const s = sessions.get(sessionId);
  if (!s) return res.status(404).json({ error: 'Sesión no encontrada' });
  res.json({ sessionId: s.id, messages: s.messages, condition: s.condition });
});

// Enviar respuesta del operador (humano)
app.post('/api/operator/reply', requireBasicAuth, (req, res) => {
  const { sessionId, text } = req.body || {};
  const s = sessions.get(sessionId);
  if (!s) return res.status(404).json({ error: 'Sesión no encontrada' });
  if (s.condition !== 'human') return res.status(400).json({ error: 'La sesión no es humana' });
  if (!text) return res.status(400).json({ error: 'Texto requerido' });
  pushMessage(s, 'human', String(text).slice(0, 2000));
  s.awaitingOperator = false;
  res.json({ ok: true });
});

// Iniciar
app.listen(PORT, () => {
  console.log(`Backend on http://localhost:${PORT}`);
});
