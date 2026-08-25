import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import express from 'express';
import { logger } from './utils/logger.js';
import {
  startWhatsAppSession,
  getSessionState,
  requestNewSessionQR
} from './sessionManager.js';
import {
  loadConfig,
  getConfig,
  verifySessionPassword,
  updateSessionMenu,
  getEffectiveMenu
} from './configStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  console.log(`
=============================================================
 🚀 INICIANDO BOT MULTI-SESSÃO DE VENDA DE MEGAS (WHATSAPP)
=============================================================
  `);

  // Carregar config via configStore (singleton partilhado)
  const config = loadConfig();
  const globalConfig = config.globalSettings || {};
  const sessions = config.sessions || [];
  const enabledSessions = sessions.filter(s => s.enabled);

  if (enabledSessions.length === 0) {
    logger.warn('Nenhuma sessão ativada encontrada em bot_config.json!');
    process.exit(0);
  }

  logger.info(`Encontradas ${enabledSessions.length} sessões ativas configuradas.`);

  // ─────────────────────────────────────────────────
  // Express App + Dashboard + API
  // ─────────────────────────────────────────────────
  const app = express();
  const PORT = process.env.PORT || 3000;
  const DASHBOARD_DIR = path.resolve(__dirname, '..', 'dashboard');

  app.use(express.json());

  // Servir ficheiros estáticos do dashboard
  app.use('/dashboard', express.static(DASHBOARD_DIR));
  app.get('/dashboard', (_req, res) => {
    res.sendFile(path.join(DASHBOARD_DIR, 'index.html'));
  });

  // Health Check
  app.get('/', (_req, res) => {
    const cfg = getConfig();
    res.json({
      status: 'online',
      app: 'Almeida Net Shop — WhatsApp Bot',
      activeSessions: cfg.sessions.filter(s => s.enabled).length,
      dashboard: `http://localhost:${PORT}/dashboard`
    });
  });

  // ── API: Listar sessões (com status em tempo real) ──────────────────────
  app.get('/api/sessions', (_req, res) => {
    const cfg = getConfig();
    const publicSessions = cfg.sessions.map(s => {
      const state = getSessionState(s.id);
      return {
        id: s.id,
        name: s.name,
        enabled: s.enabled,
        hasCustomMenu: !!s.customMenu,
        status: state.status,
        phone: state.phone
      };
    });
    res.json({ sessions: publicSessions });
  });

  // ── API: Obter Estado e QR Code em Tempo Real ──────────────────────
  app.get('/api/session/:sessionId/status', (req, res) => {
    const { sessionId } = req.params;
    const state = getSessionState(sessionId);
    res.json(state);
  });

  // ── API: Solicitar Novo QR Code / Reconectar WhatsApp ───────────────
  app.post('/api/session/:sessionId/reconnect', async (req, res) => {
    const { sessionId } = req.params;
    const password = req.headers['x-session-password'] || req.body?.password;

    if (!verifySessionPassword(sessionId, password)) {
      return res.status(401).json({ error: 'Não autorizado. Senha incorreta.' });
    }

    const cfg = getConfig();
    const session = cfg.sessions.find(s => s.id === sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Sessão não encontrada.' });
    }

    try {
      logger.info(`[API] 🔄 Requisição de reconexão autorizada para a sessão: ${sessionId}`);
      // Iniciar reset e geração de QR code em segundo plano
      requestNewSessionQR(sessionId, session, cfg.globalSettings || {});
      res.json({ success: true, message: 'Processo de reconexão iniciado. O QR Code será gerado em instantes!' });
    } catch (err) {
      logger.error(`Erro ao solicitar novo QR Code para ${sessionId}:`, err);
      res.status(500).json({ error: 'Erro ao gerar novo QR Code.' });
    }
  });

  // ── API: Login / Verificar Senha ───────────────────────────────────
  app.post('/api/login', (req, res) => {
    const { sessionId, password } = req.body || {};

    if (!sessionId || !password) {
      return res.status(400).json({ error: 'sessionId e password são obrigatórios.' });
    }

    if (!verifySessionPassword(sessionId, password)) {
      return res.status(401).json({ error: 'Senha incorrecta.' });
    }

    const cfg = getConfig();
    const session = cfg.sessions.find(s => s.id === sessionId);
    const menu = getEffectiveMenu(sessionId);

    res.json({
      success: true,
      session: { id: session.id, name: session.name, enabled: session.enabled },
      menu: {
        packagesTable: menu.packagesTable || '',
        paymentMethods: menu.paymentMethods || ''
      }
    });
  });

  // ── API: Obter menu de uma sessão ──────────────────────────────────
  app.get('/api/session/:sessionId/menu', (req, res) => {
    const { sessionId } = req.params;
    const password = req.headers['x-session-password'];

    if (!verifySessionPassword(sessionId, password)) {
      return res.status(401).json({ error: 'Não autorizado.' });
    }

    const menu = getEffectiveMenu(sessionId);
    if (!menu) return res.status(404).json({ error: 'Sessão não encontrada.' });

    res.json({
      packagesTable: menu.packagesTable || '',
      paymentMethods: menu.paymentMethods || ''
    });
  });

  // ── API: Actualizar menu de uma sessão ────────────────────────────
  app.put('/api/session/:sessionId/menu', (req, res) => {
    const { sessionId } = req.params;
    const password = req.headers['x-session-password'];

    if (!verifySessionPassword(sessionId, password)) {
      return res.status(401).json({ error: 'Não autorizado.' });
    }

    const { packagesTable, paymentMethods } = req.body || {};

    if (packagesTable === undefined && paymentMethods === undefined) {
      return res.status(400).json({ error: 'Nenhum campo para actualizar.' });
    }

    try {
      updateSessionMenu(sessionId, { packagesTable, paymentMethods });
      logger.info(`[Dashboard] ✏️  Menu da sessão "${sessionId}" actualizado via dashboard.`);
      res.json({ success: true, message: 'Menu actualizado com sucesso! O bot já está a usar as novas mensagens.' });
    } catch (err) {
      logger.error(`[Dashboard] Erro ao actualizar sessão "${sessionId}":`, err);
      res.status(500).json({ error: err.message });
    }
  });

  // Iniciar servidor
  app.listen(PORT, () => {
    logger.info(`🌐 Servidor activo na porta ${PORT}`);
    logger.info(`📊 Dashboard disponível em: http://localhost:${PORT}/dashboard`);
  });

  // ─────────────────────────────────────────────────
  // Inicializar sessões WhatsApp
  // ─────────────────────────────────────────────────
  for (let i = 0; i < enabledSessions.length; i++) {
    const sessionConfig = enabledSessions[i];
    logger.info(`\n---> [${i + 1}/${enabledSessions.length}] Carregando ${sessionConfig.name} (${sessionConfig.id})...`);

    try {
      await startWhatsAppSession(sessionConfig, globalConfig);
    } catch (err) {
      logger.error(`Erro ao iniciar sessão ${sessionConfig.name}:`, err);
    }

    if (i < enabledSessions.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

process.on('SIGINT', () => {
  logger.info('\n👋 Desligando Bot de WhatsApp...');
  process.exit(0);
});

main();
