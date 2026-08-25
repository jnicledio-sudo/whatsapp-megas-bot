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

    // 2. Classificação de Intenção da Mensagem do Cliente
    const cleanText = messageText.trim().toLowerCase();
    const proofKeywords = globalConfig.proofKeywords || [];
    const isProof = isPaymentProof(messageText, proofKeywords);

    // Detecção de Saudações comuns
    const greetingPatterns = [
      /^(ol[aá]|oi|oii+|hey|boas|viva|opa|al[oô]|salve|hello|hi)\b/i,
      /^(bom\s*dia|boa\s*tarde|boa\s*noite|tudo\s*bem|como\s*est[aá]|como\s*vai)\b/i
    ];
    const isGreeting = greetingPatterns.some((pattern) => pattern.test(cleanText));

    // Detecção de Pedido de Tabela/Pacotes/Megas
    const catalogKeywords = ['1', 'tabela', 'pacote', 'pacotes', 'megas', 'mega', 'preco', 'precos', 'preço', 'preços', 'dados', 'comprar', 'net', 'internet', 'valores', 'menu', 'vodacom', 'movitel', 'quero'];
    const isCatalogRequest = catalogKeywords.some((kw) => cleanText === kw || cleanText.includes(kw));

    // Detecção de Solicitação de Atendimento Humano / Dúvidas
    const supportKeywords = ['2', 'atendente', 'humano', 'suporte', 'ajuda', 'operador', 'falar', 'duvida', 'dúvida'];
    const isSupportRequest = supportKeywords.some((kw) => cleanText === kw || cleanText.startsWith(kw));

    // 3. Aplicação do Módulo Anti-Ban (Simulação de Digitação Humana)
    if (antiBanConfig.simulateTyping) {
      await sock.sendPresenceUpdate('composing', remoteJid);
      const delayTime = getRandomDelay(antiBanConfig.minDelayMs || 1500, antiBanConfig.maxDelayMs || 3500);
      await sleep(delayTime);
    }

    const menu = sessionConfig.customMenu || globalConfig.defaultMenu;
    const supportGroupJid = globalConfig.supportGroupJid;

    if (isProof) {
      // ==========================================
      // CASO 1: COMPROVATIVO DE PAGAMENTO RECEBIDO
      // ==========================================
      logger.info(`[${sessionConfig.name}] 💸 Comprovativo detectado de +${senderPhoneNumber}!`);

      // Resposta imediata ao cliente
      const ackMessage = menu.proofReceivedAck || "✅ *Comprovativo recebido com sucesso!*\n\nA sua mensagem foi encaminhada aos nossos atendentes para activação imediata dos megas. Por favor aguarde!";
      await sock.sendMessage(remoteJid, { text: ackMessage }, { quoted: msg });

      // Reencaminhamento rico para o Grupo de Atendimento
      if (supportGroupJid && supportGroupJid.includes('@g.us')) {
        const proofInfo = parseProofDetails(messageText);

        const groupNotification = 
`📩 *NOVA ENCOMENDA / COMPROVATIVO RECEBIDO!*

📱 *Canal de Entrada:* ${sessionConfig.name}
👤 *Cliente:* https://wa.me/${senderPhoneNumber} (+${senderPhoneNumber})
${proofInfo.amount ? `💰 *Valor Detectado:* ${proofInfo.amount}\n` : ''}${proofInfo.transactionCode ? `🔑 *Código:* ${proofInfo.transactionCode}\n` : ''}
📄 *Texto Enviado pelo Cliente (Comprovativo e Dados):*
\`\`\`
${messageText}
\`\`\`

⚡ *Atendentes: Por favor, efectuem a transferência dos megas para o número indicado!*`;

        await sock.sendMessage(supportGroupJid, { text: groupNotification });
        logger.info(`[${sessionConfig.name}] ➡️ Encomenda reencaminhada para o grupo (${supportGroupJid})!`);
      }

    } else if (isGreeting && !isCatalogRequest) {
      // ==========================================
      // CASO 2: SAUDAÇÃO INICIAL (HUMANIZADA)
      // ==========================================
      logger.info(`[${sessionConfig.name}] Saudação recebida de +${senderPhoneNumber}`);

      // Determinar período do dia
      const hour = new Date().getHours() + 2; // fuso Moçambique (UTC+2)
      let timeGreeting = "Olá";
      if (hour >= 5 && hour < 12) timeGreeting = "Bom dia";
      else if (hour >= 12 && hour < 18) timeGreeting = "Boa tarde";
      else timeGreeting = "Boa noite";

      const greetingReply =
`👋 *${timeGreeting}! Tudo bem?*
Seja muito bem-vindo(a) à *Almeida Net Shop*! 😊

Como posso ajudar hoje?

👉 *Digite 1* (ou *Tabela*) para ver a nossa Tabela de Pacotes de Internet & Preços
👉 *Digite 2* para falar directamente com um atendente humano

_Se já fez o pagamento, envie o comprovativo em texto junto com o número de destino para activação rápida!_ 🚀`;

      await sock.sendMessage(remoteJid, { text: greetingReply }, { quoted: msg });

    } else if (isSupportRequest && cleanText === '2') {
      // ==========================================
      // CASO 3: PEDIDO DE ATENDIMENTO HUMANO
      // ==========================================
      logger.info(`[${sessionConfig.name}] Pedido de suporte humano de +${senderPhoneNumber}`);

      const supportReply =
`👤 *Atendimento Humano Solicitado!*

Um dos nossos assistentes foi notificado e responderá aqui em breve. 

Por favor, escreva a sua dúvida ou necessidade abaixo para agilizar o atendimento! 👇`;

      await sock.sendMessage(remoteJid, { text: supportReply }, { quoted: msg });

      if (supportGroupJid && supportGroupJid.includes('@g.us')) {
        const helpNotification =
`🔔 *SOLICITAÇÃO DE ATENDIMENTO HUMANO*

📱 *Canal:* ${sessionConfig.name}
👤 *Cliente:* https://wa.me/${senderPhoneNumber} (+${senderPhoneNumber})
💬 *Mensagem:* "${messageText}"

👉 *Por favor, atendam este cliente no privado!*`;
        await sock.sendMessage(supportGroupJid, { text: helpNotification });
      }

    } else {
      // ==========================================
      // CASO 4: TABELA DE PACOTES, PREÇOS E PEDIDO
      // ==========================================
      logger.info(`[${sessionConfig.name}] Enviando tabela e fluxo de pedido para +${senderPhoneNumber}`);

      // Mensagem 1: Cabeçalho e Tabela de Preços
      const msg1 = `${menu.welcomeHeader}\n\n${menu.packagesTable}`;
      await sock.sendMessage(remoteJid, { text: msg1 }, { quoted: msg });

      // Intervalo humanizado
      await sock.sendPresenceUpdate('composing', remoteJid);
      await sleep(getRandomDelay(1500, 2500));

      // Mensagem 2: Formas de Pagamento
      await sock.sendMessage(remoteJid, { text: menu.paymentMethods });

      // Mensagem 3: Instrução do Número de Destino
      if (menu.destinationRequest) {
        await sock.sendPresenceUpdate('composing', remoteJid);
        await sleep(getRandomDelay(1200, 2200));
        await sock.sendMessage(remoteJid, { text: menu.destinationRequest });
      }
    }


    // Parar o status de digitação
    await sock.sendPresenceUpdate('paused', remoteJid);

  } catch (error) {
    logger.error(`[${sessionConfig.name}] Erro ao processar mensagem:`, error);
  }
}
