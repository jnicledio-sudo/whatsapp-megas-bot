import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import path from 'path';
import fs from 'fs';
import { logger } from './utils/logger.js';
import { handleIncomingMessage } from './botEngine.js';

// Estado global de conexões e QR codes para o Dashboard
const activeSockets = new Map();
const sessionStates = new Map();

/**
 * Obtém o estado atual de uma sessão (para a API do Dashboard)
 * @param {string} sessionId 
 */
export function getSessionState(sessionId) {
  return sessionStates.get(sessionId) || {
    status: 'disconnected',
    phone: null,
    qrCodeDataUrl: null,
    lastUpdate: Date.now()
  };
}

/**
 * Força a reinicialização e geração de novo QR Code para uma sessão
 */
export async function requestNewSessionQR(sessionId, sessionConfig, globalConfig) {
  logger.info(`[${sessionConfig.name}] 🔄 Solicitação de novo QR Code recebida via Dashboard!`);
  
  // 1. Fechar socket existente se houver
  if (activeSockets.has(sessionId)) {
    try {
      const existingSock = activeSockets.get(sessionId);
      existingSock.ev.removeAllListeners();
      existingSock.end(new Error('Reset solicitado pelo utilizador'));
    } catch (e) {
      // ignorar
    }
    activeSockets.delete(sessionId);
  }

  // 2. Limpar tokens antigos da sessão para gerar QR Code do zero
  const tokensDir = path.resolve('tokens', sessionId);
  if (fs.existsSync(tokensDir)) {
    try {
      fs.rmSync(tokensDir, { recursive: true, force: true });
    } catch (e) {
      logger.warn(`Erro ao limpar tokens de ${sessionId}:`, e);
    }
  }

  // 3. Atualizar estado para connecting
  sessionStates.set(sessionId, {
    status: 'connecting',
    phone: null,
    qrCodeDataUrl: null,
    lastUpdate: Date.now()
  });

  // 4. Iniciar nova sessão
  return await startWhatsAppSession(sessionConfig, globalConfig);
}

/**
 * Inicia e gerencia a conexão de uma sessão de WhatsApp.
 * 
 * @param {object} sessionConfig - Configuração da sessão individual.
 * @param {object} globalConfig - Configuração global do sistema.
 * @returns {Promise<import('@whiskeysockets/baileys').WASocket>}
 */
export async function startWhatsAppSession(sessionConfig, globalConfig) {
  const sessionId = sessionConfig.id;
  const sessionName = sessionConfig.name;
  const tokensDir = path.resolve('tokens', sessionId);

  // Garantir que a pasta de tokens exista
  if (!fs.existsSync(tokensDir)) {
    fs.mkdirSync(tokensDir, { recursive: true });
  }

  // Configurar estado de autenticação (persistência de sessão)
  const { state, saveCreds } = await useMultiFileAuthState(tokensDir);
  const { version } = await fetchLatestBaileysVersion();

  logger.info(`[${sessionName}] Inicializando sessão (Baileys v${version.join('.')})...`);

  sessionStates.set(sessionId, {
    status: 'connecting',
    phone: null,
    qrCodeDataUrl: null,
    lastUpdate: Date.now()
  });

  // Criar Socket do Baileys
  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: ['Almeida Net Shop Bot', 'Chrome', '1.0.0'],
    generateHighQualityLinkPreview: true
  });

  activeSockets.set(sessionId, sock);

  // Salvar credenciais atualizadas
  sock.ev.on('creds.update', saveCreds);

  // Monitorar atualizações de conexão
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n=============================================================');
      console.log(`📱 QR CODE PARA O NÚMERO/SESSÃO: [ ${sessionName.toUpperCase()} ] (${sessionId})`);
      console.log('👉 Abra o WhatsApp no celular -> Aparelhos Conectados -> Conectar Aparelho');
      console.log('=============================================================\n');
      qrcodeTerminal.generate(qr, { small: true });

      // Gerar imagem Base64 do QR Code para exibição no Dashboard Web
      try {
        const qrDataUrl = await QRCode.toDataURL(qr, {
          width: 320,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' }
        });

        sessionStates.set(sessionId, {
          status: 'qr_ready',
          phone: null,
          qrCodeDataUrl: qrDataUrl,
          lastUpdate: Date.now()
        });
      } catch (err) {
        logger.error(`Erro ao gerar QR Code para o dashboard:`, err);
      }
    }

    if (connection === 'open') {
      const userPhone = sock.user?.id ? sock.user.id.split(':')[0] : 'Desconhecido';
      logger.info(`✅ [${sessionName}] CONECTADO COM SUCESSO! Número: +${userPhone}`);

      sessionStates.set(sessionId, {
        status: 'connected',
        phone: userPhone,
        qrCodeDataUrl: null,
        lastUpdate: Date.now()
      });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      logger.warn(`[${sessionName}] Conexão fechada. Código: ${statusCode}. Reconectar? ${shouldReconnect}`);

      sessionStates.set(sessionId, {
        status: 'disconnected',
        phone: null,
        qrCodeDataUrl: null,
        lastUpdate: Date.now()
      });

      if (shouldReconnect) {
        logger.info(`[${sessionName}] Tentando reconectar em 5 segundos...`);
        setTimeout(() => {
          startWhatsAppSession(sessionConfig, globalConfig);
        }, 5000);
      } else {
        logger.error(`❌ [${sessionName}] Sessão desconectada/desvinculada pelo celular (Logged Out).`);
      }
    }
  });

  // Escutar mensagens recebidas
  sock.ev.on('messages.upsert', async (m) => {
    if (m.type !== 'notify') return;

    for (const msg of m.messages) {
      await handleIncomingMessage(sock, msg, sessionConfig, globalConfig);
    }
  });

  return sock;
}
