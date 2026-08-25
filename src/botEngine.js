import { isPaymentProof, parseProofDetails } from './utils/proofValidator.js';
import { logger } from './utils/logger.js';

const getRandomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Mapa em memória para guardar comprovativos pendentes que aguardam o número de destino
const pendingProofs = new Map();

// Mapa para rastrear pedidos ativos e notificar o cliente certo quando a ativação for confirmada no grupo
// Chave: número de destino (ex: 842637783) -> Valor: { clientJid, clientPhone, timestamp }
const activeOrders = new Map();

/**
 * Procura um número de telefone de Moçambique no texto (Vodacom: 84/85, TMCEL: 82/83, Movitel: 86/87)
 * @param {string} text 
 * @returns {string|null} Número no formato 84XXXXXXX ou null
 */
function extractMozPhone(text) {
  if (!text) return null;
  const clean = text.replace(/[\s\-\.]/g, '');
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

    const isGroup = remoteJid.endsWith('@g.us');
    const supportGroupJid = globalConfig.supportGroupJid;

    // =========================================================================
    // TRATAMENTO DE MENSAGENS DO GRUPO (CONFIRMAÇÃO AUTOMÁTICA DE ATIVAÇÃO)
    // =========================================================================
    if (isGroup) {
      const groupText = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

      // Comando !jid no grupo
      if (groupText.trim().toLowerCase() === '!jid') {
        logger.info(`[${sessionConfig.name}] Comando !jid recebido no grupo: ${remoteJid}`);
        await sock.sendMessage(remoteJid, {
          text: `📌 *ID DESTE GRUPO (JID):*\n\`\`\`${remoteJid}\`\`\`\n\nCopia este ID e cola no ficheiro \`config/bot_config.json\` no campo \`supportGroupJid\`!`
        });
        return;
      }

      // Detectar mensagem de confirmação de transferência do bot de megas
      // Estrutura esperada: "Transação Concluída" / "Transferencia Processada" com Número e Megas
      const isTransferSuccess = (
        (groupText.includes('Transação Concluída') || groupText.includes('Transacao Concluida') || groupText.includes('Transferencia Processada') || groupText.includes('Transferência Processada')) &&
        (groupText.includes('Número') || groupText.includes('Numero'))
      );

      if (isTransferSuccess) {
        logger.info(`[${sessionConfig.name}] ⚡ Confirmação de transferência detectada no grupo!`);

        // Extrair os campos da mensagem do bot
        const phoneMatch = groupText.match(/(?:Número|Numero)[:* ]+([0-9]{8,12})/i);
        const megasMatch = groupText.match(/(?:Megas|Pacote)[:* ]+([^\n*]+)/i);
        const refMatch   = groupText.match(/(?:Referência|Referencia)[:* ]+([^\n*]+)/i);

        const targetPhoneRaw = phoneMatch ? phoneMatch[1].trim() : null;
        const targetMegas    = megasMatch ? megasMatch[1].trim() : 'Dados de Internet';
        const targetRef      = refMatch ? refMatch[1].trim() : null;

        if (targetPhoneRaw) {
          const cleanPhone = targetPhoneRaw.replace(/^258/, '');
          logger.info(`[${sessionConfig.name}] 🎯 Megas (${targetMegas}) transferidos para o número: +258 ${cleanPhone}`);

          // Procurar o cliente correspondente na lista de pedidos
          let clientJid = null;
          if (activeOrders.has(cleanPhone)) {
            clientJid = activeOrders.get(cleanPhone).clientJid;
            activeOrders.delete(cleanPhone);
          } else {
            // Fallback: enviar diretamente para o número que recebeu os megas
            clientJid = `258${cleanPhone}@s.whatsapp.net`;
          }

          // Mensagem calorosa de ativação com sucesso para o cliente
          const clientSuccessNotification =
`🎉 *OS SEUS MEGAS FORAM ACTIVADOS COM SUCESSO!* 🚀

📦 *Pacote Ativado:* ${targetMegas}
📲 *Número de Destino:* +258 ${cleanPhone}
${targetRef ? `🔖 *Referência:* ${targetRef}\n` : ''}
✨ Os seus dados de internet já estão disponíveis e prontos a usar!

Muito obrigado por comprar com a *Almeida Net Shop*! Volte sempre! 😊🛍️`;

          try {
            await sock.sendMessage(clientJid, { text: clientSuccessNotification });
            logger.info(`[${sessionConfig.name}] ✅ Mensagem de ativação enviada com sucesso para o cliente (${clientJid})!`);
          } catch (err) {
            logger.error(`[${sessionConfig.name}] Erro ao enviar confirmação de ativação ao cliente:`, err);
          }
        }
      }

      return;
    }

    // =========================================================================
    // TRATAMENTO DE CONVERSAS PRIVADAS (CLIENTES)
    // =========================================================================
    const isImageMessage = !!(msg.message.imageMessage || msg.message.documentMessage);
    const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || '';

    // Se o cliente enviou uma imagem/foto e não há texto de comprovativo
    if (isImageMessage && !messageText.trim()) {
      logger.info(`[${sessionConfig.name}] 📸 Imagem/Foto recebida de ${remoteJid.split('@')[0]} - Recusando formato de imagem.`);
      
      const imageRefusalMsg =
`🚨 *ATENÇÃO: NÃO ACEITAMOS COMPROVATIVOS EM FORMATO DE IMAGEM / FOTO!* 📸❌

Por favor, **copie o texto da mensagem SMS** do M-Pesa ou E-Mola que recebeu e **cole aqui em formato de texto** junto com o seu número de destino.

💡 _Dica: Abra o aplicativo de Mensagens SMS do seu telefone, copie o texto da confirmação e envie para nós aqui!_ 🚀`;

      await sock.sendMessage(remoteJid, { text: imageRefusalMsg });
      return;
    }

    if (!messageText.trim()) return;

    const senderPhoneNumber = remoteJid.split('@')[0];
    const antiBanConfig = globalConfig.antiBan || {};
    const menu = sessionConfig.customMenu || globalConfig.defaultMenu;

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

        await sock.sendMessage(remoteJid, { text: confirmationReply });

        // 2. Encaminhar Pedido Completo ao Grupo de Atendimento
        if (supportGroupJid && supportGroupJid.includes('@g.us')) {
          activeOrders.set(destinationNumber, {
            clientJid: remoteJid,
            clientPhone: senderPhoneNumber,
            timestamp: Date.now()
          });

          const groupNotification =
`📩 *NOVA ENCOMENDA RECEBIDA!*

📱 *Canal de Entrada:* ${sessionConfig.name}
👤 *Cliente:* https://wa.me/${senderPhoneNumber} (+${senderPhoneNumber})
📲 *NÚMERO DE DESTINO (RECEBER MEGAS):* +258 ${destinationNumber}
${pendingData.proofInfo.amount ? `💰 *Valor:* ${pendingData.proofInfo.amount}\n` : ''}${pendingData.proofInfo.transactionCode ? `🔑 *Código:* ${pendingData.proofInfo.transactionCode}\n` : ''}
📄 *Comprovativo de Transferência:*
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

        await sock.sendMessage(remoteJid, { text: askPhoneAgain });
        await sock.sendPresenceUpdate('paused', remoteJid);
        return;
      }
    }

    // =========================================================================
    // CENÁRIO B: RECEBIMENTO DE NOVO COMPROVATIVO DE TRANSFERÊNCIA
    // =========================================================================
    if (isProof) {
      logger.info(`[${sessionConfig.name}] 💸 Comprovativo detectado de +${senderPhoneNumber}!`);
      const proofInfo = parseProofDetails(messageText);
      const destinationNumber = extractMozPhone(messageText);

      if (destinationNumber) {
        // O comprovativo JÁ veio acompanhado do número de destino no mesmo texto!
        activeOrders.set(destinationNumber, {
          clientJid: remoteJid,
          clientPhone: senderPhoneNumber,
          timestamp: Date.now()
        });

        const successMsg =
`✅ *COMPROVATIVO E NÚMERO RECEBIDOS COM SUCESSO!* 🚀

📲 *Número para envio dos megas:* +258 ${destinationNumber}
${proofInfo.amount ? `💰 *Valor:* ${proofInfo.amount}\n` : ''}
A sua encomenda foi encaminhada para a nossa equipa. A activação dos seus megas será feita em instantes!

Muito obrigado pela preferência na *Almeida Net Shop*! 😊`;

        await sock.sendMessage(remoteJid, { text: successMsg });

        if (supportGroupJid && supportGroupJid.includes('@g.us')) {
          const groupNotification =
`📩 *NOVA ENCOMENDA RECEBIDA!*

📱 *Canal:* ${sessionConfig.name}
👤 *Cliente:* https://wa.me/${senderPhoneNumber} (+${senderPhoneNumber})
📲 *NÚMERO DE DESTINO (RECEBER MEGAS):* +258 ${destinationNumber}
${proofInfo.amount ? `💰 *Valor:* ${proofInfo.amount}\n` : ''}${proofInfo.transactionCode ? `🔑 *Código:* ${proofInfo.transactionCode}\n` : ''}
📄 *Comprovativo de Transferência:*
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
