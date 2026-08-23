/**
 * Teste de integração da API do Dashboard.
 * Inicia um servidor Express isolado (sem WhatsApp) e testa todos os endpoints.
 */
import express from 'express';
import { loadConfig, getConfig, verifySessionPassword, updateSessionMenu, getEffectiveMenu } from './src/configStore.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const app  = express();
const PORT = 3999; // porta de teste para não conflito
app.use(express.json());

const DASHBOARD_DIR = path.resolve(__dirname, 'dashboard');
app.use('/dashboard', express.static(DASHBOARD_DIR));
app.get('/api/sessions', (_req, res) => {
  const cfg = getConfig();
  res.json({ sessions: cfg.sessions.map(s => ({ id: s.id, name: s.name, enabled: s.enabled })) });
});
app.post('/api/login', (req, res) => {
  const { sessionId, password } = req.body || {};
  if (!verifySessionPassword(sessionId, password)) return res.status(401).json({ error: 'Senha incorrecta.' });
  const menu = getEffectiveMenu(sessionId);
  res.json({ success: true, menu: { packagesTable: menu.packagesTable, paymentMethods: menu.paymentMethods } });
});
app.put('/api/session/:sessionId/menu', (req, res) => {
  const { sessionId } = req.params;
  const password = req.headers['x-session-password'];
  if (!verifySessionPassword(sessionId, password)) return res.status(401).json({ error: 'Não autorizado.' });
  const { packagesTable, paymentMethods } = req.body || {};
  try {
    updateSessionMenu(sessionId, { packagesTable, paymentMethods });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

loadConfig();

const server = app.listen(PORT, async () => {
  const base = `http://localhost:${PORT}`;
  const results = [];

  async function test(label, fn) {
    try { const r = await fn(); results.push({ label, ok: r }); }
    catch (e) { results.push({ label, ok: false, err: e.message }); }
  }

  // T1: GET /api/sessions
  await test('GET /api/sessions devolve sessões', async () => {
    const r = await fetch(`${base}/api/sessions`);
    const d = await r.json();
    return r.ok && Array.isArray(d.sessions) && d.sessions.length === 5;
  });

  // T2: POST /api/login senha correcta
  await test('POST /api/login com senha correcta', async () => {
    const r = await fetch(`${base}/api/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sessao_1', password: 'almeida1' })
    });
    const d = await r.json();
    return r.ok && d.success === true && d.menu.packagesTable;
  });

  // T3: POST /api/login senha errada → 401
  await test('POST /api/login com senha errada → 401', async () => {
    const r = await fetch(`${base}/api/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sessao_1', password: 'wrong' })
    });
    return r.status === 401;
  });

  // T4: PUT /api/session/:id/menu autorizado
  await test('PUT /api/session/sessao_2/menu actualiza com sucesso', async () => {
    const r = await fetch(`${base}/api/session/sessao_2/menu`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-session-password': 'almeida2' },
      body: JSON.stringify({ packagesTable: 'TESTE123', paymentMethods: 'PAG_TESTE' })
    });
    const d = await r.json();
    return r.ok && d.success;
  });

  // T5: PUT sem autorização → 401
  await test('PUT sem senha → 401', async () => {
    const r = await fetch(`${base}/api/session/sessao_1/menu`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-session-password': 'errada' },
      body: JSON.stringify({ packagesTable: 'X' })
    });
    return r.status === 401;
  });

  // T6: Dashboard HTML existe
  await test('GET /dashboard serve ficheiro HTML', async () => {
    const r = await fetch(`${base}/dashboard/index.html`);
    const txt = await r.text();
    return r.ok && txt.includes('Almeida Net Shop');
  });

  // Restaurar sessao_2 (remover customMenu criado no T4)
  const cfg = getConfig();
  const s2 = cfg.sessions.find(s => s.id === 'sessao_2');
  if (s2) { s2.customMenu = null; import('fs').then(fs => fs.writeFileSync('config/bot_config.json', JSON.stringify(cfg, null, 2), 'utf-8')); }

  // Imprimir resultados
  console.log('\n--- TESTE DE INTEGRAÇÃO DA API DO DASHBOARD ---\n');
  let allOk = true;
  results.forEach(r => {
    const icon = r.ok ? '✅' : '❌';
    if (!r.ok) allOk = false;
    console.log(`${icon} ${r.label}${r.err ? ' — ' + r.err : ''}`);
  });
  console.log(`\n${allOk ? '🎉 TODOS OS TESTES PASSARAM!' : '⚠️ Alguns testes falharam.'}\n`);
  server.close();
});
