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

    // 2. Classificação Natural da Conversa
    const cleanText = messageText.trim().toLowerCase();
    const proofKeywords = globalConfig.proofKeywords || [];
    const isProof = isPaymentProof(messageText, proofKeywords);

    // Identificar saudações puras (quando a pessoa apenas cumprimenta)
    const pureGreetingRegex = /^(ol[aá]|oi|oii+|hey|boas|viva|opa|al[oô]|salve|bom\s*dia|boa\s*tarde|boa\s*noite|tudo\s*bem|tudo\s*bom|como\s*est[aá]|como\s*vai|boa|ola\s*tudo\s*bem|oi\s*tudo\s*bem)[!?.\s]*$/i;
    const isPureGreeting = pureGreetingRegex.test(cleanText);

    // Identificar intenção de comprar/ver megas de forma natural (ex: "quero megas", "sim", "manda", "tabela", "preço", "quanto custa", "tens megas?")
    const interestKeywords = [
      'mega', 'megas', 'pacote', 'pacotes', 'preco', 'precos', 'preço', 'preços',
      'tabela', 'dados', 'net', 'internet', 'comprar', 'quero', 'manda', 'envia',
      'mostra', 'quais', 'quanto', 'valor', 'valores', 'sim', 'bora', 'vodacom',
      'movitel', 'tmcel', 'disponivel', 'disponível', 'promocao', 'promoção', 'gigas', 'gb', 'mb'
    ];
    const isInterestedInPackages = interestKeywords.some((kw) => cleanText.includes(kw));

    // 3. Simulação de Digitação Humana
    if (antiBanConfig.simulateTyping) {
      await sock.sendPresenceUpdate('composing', remoteJid);
      const delayTime = getRandomDelay(antiBanConfig.minDelayMs || 1500, antiBanConfig.maxDelayMs || 3000);
      await sleep(delayTime);
    }

    const menu = sessionConfig.customMenu || globalConfig.defaultMenu;
    const supportGroupJid = globalConfig.supportGroupJid;

    if (isProof) {
      // =======================================================
      // CASO 1: COMPROVATIVO DE PAGAMENTO / PEDIDO ENVIADO
      // =======================================================
      logger.info(`[${sessionConfig.name}] 💸 Comprovativo recebido de +${senderPhoneNumber}!`);

      const ackMessage = menu.proofReceivedAck || 
`✅ *Perfeito, comprovativo recebido!*

Já encaminhei os seus dados para a nossa equipa. A activação dos seus megas será feita em instantes! 🚀

Por favor aguarde um momento. Muito obrigado pela preferência! 😊`;

      await sock.sendMessage(remoteJid, { text: ackMessage }, { quoted: msg });

      // Notificar o grupo de atendimento
      if (supportGroupJid && supportGroupJid.includes('@g.us')) {
        const proofInfo = parseProofDetails(messageText);

        const groupNotification = 
`📩 *NOVO PEDIDO / COMPROVATIVO RECEBIDO!*

📱 *Canal:* ${sessionConfig.name}
👤 *Cliente:* https://wa.me/${senderPhoneNumber} (+${senderPhoneNumber})
${proofInfo.amount ? `💰 *Valor:* ${proofInfo.amount}\n` : ''}${proofInfo.transactionCode ? `🔑 *Código:* ${proofInfo.transactionCode}\n` : ''}
📄 *Texto do Cliente:*
\`\`\`
${messageText}
\`\`\`

⚡ *Por favor, efectuem a transferência dos megas para o número indicado!*`;

        await sock.sendMessage(supportGroupJid, { text: groupNotification });
        logger.info(`[${sessionConfig.name}] ➡️ Notificação enviada ao grupo!`);
      }

    } else if (isPureGreeting && !isInterestedInPackages) {
      // =======================================================
      // CASO 2: SAUDAÇÃO NATURAL E ACOLHEDORA (SEM MENUS ROBÓTICOS)
      // =======================================================
      logger.info(`[${sessionConfig.name}] Saudação natural de +${senderPhoneNumber}`);

      const hour = new Date().getHours() + 2; // Horário de Moçambique (UTC+2)
      let timeGreeting = "Olá";
      if (hour >= 5 && hour < 12) timeGreeting = "Bom dia";
      else if (hour >= 12 && hour < 18) timeGreeting = "Boa tarde";
      else timeGreeting = "Boa noite";

      const naturalGreeting =
`👋 *${timeGreeting}! Tudo bem por aí?*

Seja muito bem-vindo(a) à *Almeida Net Shop*! 😊

Pretende ver os nossos pacotes de megas disponíveis ou tem alguma dúvida? Fique à vontade para me dizer o que precisa!`;

      await sock.sendMessage(remoteJid, { text: naturalGreeting }, { quoted: msg });

    } else {
      // =======================================================
      // CASO 3: APRESENTAÇÃO DOS PACOTES E INSTRUÇÃO NATURAL
      // =======================================================
      logger.info(`[${sessionConfig.name}] Enviando pacotes de forma natural para +${senderPhoneNumber}`);

      // Mensagem 1: Apresentação acolhedora + Tabela de Pacotes
      const msg1 = `Com certeza! Aqui estão os nossos pacotes de internet disponíveis com os melhores preços:\n\n${menu.packagesTable}`;
      await sock.sendMessage(remoteJid, { text: msg1 }, { quoted: msg });

      // Pequena pausa natural
      await sock.sendPresenceUpdate('composing', remoteJid);
      await sleep(getRandomDelay(1500, 2500));

      // Mensagem 2: Formas de Pagamento e como finalizar
      const paymentAndOrderText = 
`${menu.paymentMethods}

📲 *Como finalizar o seu pedido:*
Assim que fizer o pagamento, envie aqui o *comprovativo em texto* junto com o *número de telefone* onde pretende receber os megas! 

A nossa activação é super rápida! 🚀 Qualquer dúvida, estou por aqui.`;

      await sock.sendMessage(remoteJid, { text: paymentAndOrderText });
    }


    // Parar o status de digitação
    await sock.sendPresenceUpdate('paused', remoteJid);

  } catch (error) {
    logger.error(`[${sessionConfig.name}] Erro ao processar mensagem:`, error);
  }
}
