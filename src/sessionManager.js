import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import path from 'path';
import fs from 'fs';
import { logger } from './utils/logger.js';
import { handleIncomingMessage } from './botEngine.js';

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

  // Criar Socket do Baileys
  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false, // Gerenciamos a exibição do QR Code manualmente
    logger: pino({ level: 'silent' }), // Silenciar logs internos verbosos do Baileys
    browser: ['Megas Bot Multi-Session', 'Chrome', '1.0.0'],
    generateHighQualityLinkPreview: true
  });

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
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      const userPhone = sock.user?.id ? sock.user.id.split(':')[0] : 'Desconhecido';
      logger.info(`✅ [${sessionName}] CONECTADO COM SUCESSO! Número: +${userPhone}`);
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      logger.warn(`[${sessionName}] Conexão fechada. Código: ${statusCode}. Reconectar? ${shouldReconnect}`);

      if (shouldReconnect) {
        logger.info(`[${sessionName}] Tentando reconectar em 5 segundos...`);
        setTimeout(() => {
          startWhatsAppSession(sessionConfig, globalConfig);
        }, 5000);
      } else {
        logger.error(`❌ [${sessionName}] Sessão desconectada/desconectada pelo celular (Logged Out). Será necessário escanear o QR Code novamente.`);
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
