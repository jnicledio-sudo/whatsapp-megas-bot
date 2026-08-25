import { isPaymentProof, parseProofDetails } from './utils/proofValidator.js';
import { logger } from './utils/logger.js';

const getRandomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Mapa em memória para guardar comprovativos pendentes que aguardam o número de destino
const pendingProofs = new Map();

/**
 * Procura um número de telefone de Moçambique no texto (Vodacom: 84/85, TMCEL: 82/83, Movitel: 86/87)
 * @param {string} text 
 * @returns {string|null} Número no formato 84XXXXXXX ou null
 */
function extractMozPhone(text) {
  if (!text) return null;
  // Limpar espaços, hífens e pontos entre dígitos
  const clean = text.replace(/[\s\-\.]/g, '');
  
  // Procura padrão +2588XXXXXXXX ou 2588XXXXXXXX ou 8XXXXXXXX
  const match = clean.match(/(?:(?:\+?258)|(?:\b))(8[2-7]\d{7})\b/);
  if (match && match[1]) {
    return match[1];
  }
  return null;
}

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
      return;
    }

    // Obter o texto da mensagem enviada pelo cliente em conversa privada
    const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || '';
    if (!messageText.trim()) return;

    const senderPhoneNumber = remoteJid.split('@')[0];
    const antiBanConfig = globalConfig.antiBan || {};
    const menu = sessionConfig.customMenu || globalConfig.defaultMenu;
    const supportGroupJid = globalConfig.supportGroupJid;

    // Simulação de Digitação Humana Ultra-Rápida e Segura
    if (antiBanConfig.simulateTyping) {
      try {
        await sock.sendPresenceUpdate('composing', remoteJid);
        const delayTime = getRandomDelay(antiBanConfig.minDelayMs || 800, antiBanConfig.maxDelayMs || 1600);
        await sleep(delayTime);
      } catch (e) {
        // Ignorar se falhar presença
      }
    }

    const cleanText = messageText.trim().toLowerCase();
    const proofKeywords = globalConfig.proofKeywords || [];
    const isProof = isPaymentProof(messageText, proofKeywords);

    // =========================================================================
    // CENÁRIO A: O CLIENTE TEM UM COMPROVATIVO PENDENTE À ESPERA DO NÚMERO
    // =========================================================================
    if (pendingProofs.has(senderPhoneNumber) && !isProof) {
      const pendingData = pendingProofs.get(senderPhoneNumber);
      const destinationNumber = extractMozPhone(messageText);

      if (destinationNumber) {
        // Número de destino válido fornecido!
        logger.info(`[${sessionConfig.name}] 📲 Número de destino +258 ${destinationNumber} confirmado para comprovativo pendente de +${senderPhoneNumber}`);
        
        pendingProofs.delete(senderPhoneNumber);

        // 1. Mensagem de Confirmação ao Cliente
        const confirmationReply =
`✅ *PEDIDO E NÚMERO CONFIRMADOS COM SUCESSO!* 🚀

📲 *Número para envio dos megas:* +258 ${destinationNumber}
${pendingData.proofInfo.amount ? `💰 *Valor:* ${pendingData.proofInfo.amount}\n` : ''}
Os seus dados e comprovativo foram encaminhados agora para a nossa equipa. A activação será feita em instantes!

Muito obrigado pela preferência na *Almeida Net Shop*! 😊`;

        await sock.sendMessage(remoteJid, { text: confirmationReply }, { quoted: msg });

        // 2. Encaminhar Pedido Completo ao Grupo de Atendimento
        if (supportGroupJid && supportGroupJid.includes('@g.us')) {
          const groupNotification =
`📩 *NOVO PEDIDO COMPLETO RECEBIDO!*

📱 *Canal de Entrada:* ${sessionConfig.name}
👤 *Cliente:* https://wa.me/${senderPhoneNumber} (+${senderPhoneNumber})
📲 *NÚMERO DE DESTINO (RECEBER MEGAS):* +258 ${destinationNumber}
${pendingData.proofInfo.amount ? `💰 *Valor:* ${pendingData.proofInfo.amount}\n` : ''}${pendingData.proofInfo.transactionCode ? `🔑 *Código:* ${pendingData.proofInfo.transactionCode}\n` : ''}
📄 *Comprovativo de Pagamento:*
\`\`\`
${pendingData.proofText}
\`\`\`

⚡ *Por favor, efectuem a transferência dos megas para o número: +258 ${destinationNumber}!*`;

          await sock.sendMessage(supportGroupJid, { text: groupNotification });
        }

        await sock.sendPresenceUpdate('paused', remoteJid);
        return;
      } else {
        // O cliente mandou uma mensagem mas não era um número de telefone válido
        const askPhoneAgain =
`⚠️ *POR FAVOR, DIGITE O NÚMERO DE DESTINO!* ⚠️

Para podermos ativar os seus megas, precisamos que nos envie o **número de telemóvel** (com 9 dígitos) para onde os dados devem ser transferidos.

_Exemplo:_ *841234567* ou *871234567*

_(Mesmo que seja para este seu próprio número de onde fala, confirme-o aqui)._`;

        await sock.sendMessage(remoteJid, { text: askPhoneAgain }, { quoted: msg });
        await sock.sendPresenceUpdate('paused', remoteJid);
        return;
      }
    }

    // =========================================================================
    // CENÁRIO B: RECEBIMENTO DE NOVO COMPROVATIVO DE PAGAMENTO
    // =========================================================================
    if (isProof) {
      logger.info(`[${sessionConfig.name}] 💸 Comprovativo detectado de +${senderPhoneNumber}!`);
      const proofInfo = parseProofDetails(messageText);
      const destinationNumber = extractMozPhone(messageText);

      if (destinationNumber) {
        // O comprovativo JÁ veio acompanhado do número de destino no mesmo texto!
        const successMsg =
`✅ *COMPROVATIVO E NÚMERO RECEBIDOS COM SUCESSO!* 🚀

📲 *Número para envio dos megas:* +258 ${destinationNumber}
${proofInfo.amount ? `💰 *Valor:* ${proofInfo.amount}\n` : ''}
A sua encomenda foi encaminhada para a nossa equipa. A activação dos seus megas será feita em instantes!

Muito obrigado pela preferência na *Almeida Net Shop*! 😊`;

        await sock.sendMessage(remoteJid, { text: successMsg }, { quoted: msg });

        if (supportGroupJid && supportGroupJid.includes('@g.us')) {
          const groupNotification =
`📩 *NOVO PEDIDO COMPLETO RECEBIDO!*

📱 *Canal:* ${sessionConfig.name}
👤 *Cliente:* https://wa.me/${senderPhoneNumber} (+${senderPhoneNumber})
📲 *NÚMERO DE DESTINO (RECEBER MEGAS):* +258 ${destinationNumber}
${proofInfo.amount ? `💰 *Valor:* ${proofInfo.amount}\n` : ''}${proofInfo.transactionCode ? `🔑 *Código:* ${proofInfo.transactionCode}\n` : ''}
📄 *Texto do Cliente:*
\`\`\`
${messageText}
\`\`\`

⚡ *Por favor, efectuem a transferência dos megas para o número: +258 ${destinationNumber}!*`;

          await sock.sendMessage(supportGroupJid, { text: groupNotification });
        }
      } else {
        // O comprovativo veio SEM o número de destino -> Guardar estado e exigir o número
        pendingProofs.set(senderPhoneNumber, {
          proofText: messageText,
          proofInfo: proofInfo,
          timestamp: Date.now()
        });

        const requirePhoneMsg =
`⚠️ *COMPROVATIVO RECEBIDO, MAS FALTA O NÚMERO DE DESTINO!* ⚠️
${proofInfo.amount ? `💰 *Valor Detectado:* ${proofInfo.amount}\n` : ''}
Por favor, **digite agora o número de telemóvel** (Vodacom / Movitel / TMCEL) para onde devemos transferir os seus megas.

🚨 *Importante:* Não temos como concluir o envio dos megas sem a confirmação do número de destino (mesmo que seja este seu próprio número, por favor confirme-o aqui abaixo). 👇`;

        await sock.sendMessage(remoteJid, { text: requirePhoneMsg }, { quoted: msg });
      }

      await sock.sendPresenceUpdate('paused', remoteJid);
      return;
    }

    // =========================================================================
    // CENÁRIO C: SAUDAÇÃO NATURAL (HUMANIZADA)
    // =========================================================================
    const pureGreetingRegex = /^(ol[aá]|oi|oii+|hey|boas|viva|opa|al[oô]|salve|bom\s*dia|boa\s*tarde|boa\s*noite|tudo\s*bem|tudo\s*bom|como\s*est[aá]|como\s*vai|boa|ola\s*tudo\s*bem|oi\s*tudo\s*bem)[!?.\s]*$/i;
    const isPureGreeting = pureGreetingRegex.test(cleanText);

    const interestKeywords = [
      'mega', 'megas', 'pacote', 'pacotes', 'preco', 'precos', 'preço', 'preços',
      'tabela', 'dados', 'net', 'internet', 'comprar', 'quero', 'manda', 'envia',
      'mostra', 'quais', 'quanto', 'valor', 'valores', 'sim', 'bora', 'vodacom',
      'movitel', 'tmcel', 'disponivel', 'disponível', 'promocao', 'promoção', 'gigas', 'gb', 'mb'
    ];
    const isInterestedInPackages = interestKeywords.some((kw) => cleanText.includes(kw));

    if (isPureGreeting && !isInterestedInPackages) {
      logger.info(`[${sessionConfig.name}] Saudação natural de +${senderPhoneNumber}`);

      const hour = new Date().getHours() + 2; // Fuso Moçambique (UTC+2)
      let timeGreeting = "Olá";
      if (hour >= 5 && hour < 12) timeGreeting = "Bom dia";
      else if (hour >= 12 && hour < 18) timeGreeting = "Boa tarde";
      else timeGreeting = "Boa noite";

      const naturalGreeting =
`👋 *${timeGreeting}! Tudo bem por aí?*

Seja muito bem-vindo(a) à *Almeida Net Shop*! 😊

Pretende ver os nossos pacotes de megas disponíveis ou tem alguma dúvida? Fique à vontade para me dizer o que precisa!`;

      await sock.sendMessage(remoteJid, { text: naturalGreeting });

    } else {
      // =========================================================================
      // CENÁRIO D: APRESENTAÇÃO DOS PACOTES E INSTRUÇÃO NATURAL
      // =========================================================================
      logger.info(`[${sessionConfig.name}] Enviando pacotes para +${senderPhoneNumber}`);

      const msg1 = `Com certeza! Aqui estão os nossos pacotes de internet disponíveis com os melhores preços:\n\n${menu.packagesTable || ''}`;
      await sock.sendMessage(remoteJid, { text: msg1 });

      await sleep(1000);

      const paymentAndOrderText = 
`${menu.paymentMethods || ''}

📲 *Como finalizar o seu pedido:*
Assim que fizer o pagamento, envie aqui o *comprovativo em texto* junto com o *número de telefone* onde pretende receber os megas! 

A nossa activação é super rápida! 🚀 Qualquer dúvida, estou por aqui.`;

      await sock.sendMessage(remoteJid, { text: paymentAndOrderText });
    }

  } catch (error) {
    logger.error(`[${sessionConfig.name}] Erro ao processar mensagem:`, error);
  } finally {
    try {
      const remoteJid = msg.key?.remoteJid;
      if (remoteJid) {
        await sock.sendPresenceUpdate('paused', remoteJid);
      }
    } catch (e) {
      // ignorar
    }
  }
}
