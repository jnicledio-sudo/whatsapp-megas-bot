import { isPaymentProof, parseProofDetails } from './utils/proofValidator.js';
import { logger } from './utils/logger.js';

const getRandomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Processa mensagens recebidas por uma instância do Baileys.
 * 
 * @param {import('@whiskeysockets/baileys').WASocket} sock - Instância do socket do Baileys.
 * @param {object} msg - Objeto da mensagem recebida (upsert.messages[0]).
 * @param {object} sessionConfig - Configuração específica da sessão.
 * @param {object} globalConfig - Configuração global do bot.
 */
export async function handleIncomingMessage(sock, msg, sessionConfig, globalConfig) {
  try {
    // 1. Ignorar mensagens sem conteúdo, broadcasts ou mensagens enviadas pelo próprio bot
    if (!msg.message || msg.key.fromMe) return;

    // Detectar jid do remetente
    const remoteJid = msg.key.remoteJid;
    if (!remoteJid) return;

    // Se for mensagem de status ou broadcast, ignorar
    if (remoteJid === 'status@broadcast' || remoteJid.endsWith('@newsletter')) return;

    // Se for mensagem de um Grupo de WhatsApp, verificar se é o grupo de suporte ou grupo normal
    const isGroup = remoteJid.endsWith('@g.us');
    
    // Se o bot estiver no grupo de suporte e alguém digitar "!jid", ele responde mostrando o JID do Grupo
    if (isGroup) {
      const textMessage = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
      if (textMessage.trim().toLowerCase() === '!jid') {
        logger.info(`[${sessionConfig.name}] Comando !jid recebido no grupo: ${remoteJid}`);
        await sock.sendMessage(remoteJid, {
          text: `📌 *ID DESTE GRUPO (JID):*\n\`\`\`${remoteJid}\`\`\`\n\nCopia este ID e cola no ficheiro \`config/bot_config.json\` no campo \`supportGroupJid\`!`
        });
      }
      // O bot não responde menus automáticos dentro de grupos para evitar spam no grupo
      return;
    }

    // Obter o texto da mensagem enviada pelo cliente em conversa privada
    const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || '';
    if (!messageText.trim()) return;

    const senderPhoneNumber = remoteJid.split('@')[0];
    const antiBanConfig = globalConfig.antiBan || {};

    logger.info(`[${sessionConfig.name}] Mensagem recebida de +${senderPhoneNumber}: "${messageText.substring(0, 40)}..."`);

    // 2. Verificar se a mensagem é um Comprovativo de Pagamento
    const proofKeywords = globalConfig.proofKeywords || [];
    const isProof = isPaymentProof(messageText, proofKeywords);

    // 3. Aplicação do Módulo Anti-Ban (Simulação de Digitação Humana)
    if (antiBanConfig.simulateTyping) {
      await sock.sendPresenceUpdate('composing', remoteJid);
      const delayTime = getRandomDelay(antiBanConfig.minDelayMs || 2000, antiBanConfig.maxDelayMs || 5000);
      await sleep(delayTime);
    }

    const menu = sessionConfig.customMenu || globalConfig.defaultMenu;
    const supportGroupJid = globalConfig.supportGroupJid;

    if (isProof) {
      // --- FLUXO DE COMPROVATIVO RECEBIDO ---
      logger.info(`[${sessionConfig.name}] 💸 Comprovativo detectado do número +${senderPhoneNumber}!`);

      // A) Resposta ao cliente
      const ackMessage = menu.proofReceivedAck || "✅ Comprovativo recebido com sucesso!";
      await sock.sendMessage(remoteJid, { text: ackMessage }, { quoted: msg });

      // B) Reencaminhamento para o Grupo de Atendimento
      if (supportGroupJid && supportGroupJid.includes('@g.us')) {
        const proofInfo = parseProofDetails(messageText);

        const groupNotification = 
`📩 *NOVO COMPROVATIVO RECEBIDO!*

📱 *Canal de Entrada:* ${sessionConfig.name} (+${sock.user?.id?.split(':')[0] || 'Bot'})
👤 *Cliente:* https://wa.me/${senderPhoneNumber} (+${senderPhoneNumber})
${proofInfo.amount ? `💰 *Valor Detectado:* ${proofInfo.amount}\n` : ''}${proofInfo.transactionCode ? `🔑 *Código:* ${proofInfo.transactionCode}\n` : ''}
📄 *Texto do Comprovativo:*
\`\`\`
${messageText}
\`\`\`

⚡ *Atendentes: Por favor, efetuar a ativação dos megas para este cliente!*`;

        await sock.sendMessage(supportGroupJid, { text: groupNotification });
        logger.info(`[${sessionConfig.name}] ➡️ Comprovativo reencaminhado para o grupo (${supportGroupJid})!`);
      } else {
        logger.warn(`[${sessionConfig.name}] ⚠️ O Grupo de Atendimento ainda não está configurado! Adicione o bot a um grupo e digite !jid no grupo para pegar o ID.`);
      }

    } else {
      // --- FLUXO DE MENU E ATENDIMENTO ---
      logger.info(`[${sessionConfig.name}] Enviando tabela de preços e menu para +${senderPhoneNumber}`);

      // Mensagem 1: Saudação + Cabeçalho + Tabela de Preços
      const greeting = menu.greeting || "👋 *Olá! Seja muito bem-vindo(a) ao Atendimento Automático!*";
      const msg1 = `${greeting}\n\n${menu.welcomeHeader}\n\n${menu.packagesTable}`;
      await sock.sendMessage(remoteJid, { text: msg1 }, { quoted: msg });

      // Pequeno delay entre mensagens para parecer mais humano
      await sock.sendPresenceUpdate('composing', remoteJid);
      await sleep(getRandomDelay(1500, 3000));

      // Mensagem 2: Formas de Pagamento
      await sock.sendMessage(remoteJid, { text: menu.paymentMethods });

      // Mensagem 3: Instrução de envio do número de destino (se configurada)
      if (menu.destinationRequest) {
        await sock.sendPresenceUpdate('composing', remoteJid);
        await sleep(getRandomDelay(1200, 2500));
        await sock.sendMessage(remoteJid, { text: menu.destinationRequest });
      }
    }


    // Parar o status de digitação
    await sock.sendPresenceUpdate('paused', remoteJid);

  } catch (error) {
    logger.error(`[${sessionConfig.name}] Erro ao processar mensagem:`, error);
  }
}
