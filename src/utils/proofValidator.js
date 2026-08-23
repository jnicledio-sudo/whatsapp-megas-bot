/**
 * Validador de mensagens de texto de comprovativos de transferência (M-Pesa, E-Mola, Banco, etc.)
 */

/**
 * Verifica se o texto recebido tem características de uma confirmação de pagamento/transferência.
 * @param {string} text - O conteúdo da mensagem de texto recebida.
 * @param {Array<string>} keywords - Lista de palavras-chave configuradas.
 * @returns {boolean}
 */
export function isPaymentProof(text, keywords = []) {
  if (!text || typeof text !== 'string') return false;

  const normalizedText = text.toLowerCase().trim();

  // Se o texto for muito curto (menos de 15 caracteres), provavelmente não é um comprovativo
  if (normalizedText.length < 15) return false;

  // 1. Contagem de palavras-chave encontradas
  let matchedKeywordCount = 0;
  for (const keyword of keywords) {
    if (normalizedText.includes(keyword.toLowerCase())) {
      matchedKeywordCount++;
    }
  }

  // 2. Padrões comuns de comprovativos de carteiras móveis (M-Pesa, E-Mola, mKesh, Banco, etc.)
  const hasCurrencyPattern = /\b\d+(?:[\.,]\d{1,2})?\s*(?:mt|meticais|mz|mzn)\b/i.test(normalizedText);
  const hasTransactionIdPattern = /(?:ref(?:erencia)?|txid|transac[ca]o|codigo|código|id|n[oº]\.?)\s*[:\.]?\s*[a-z0-9]{4,}/i.test(normalizedText);
  const hasConfirmationWords = /(?:confirmad[ao]|transferid[ao]|sucesso|recebid[ao]|enviad[ao]|efetuad[ao]|efectuad[ao])\b/i.test(normalizedText);
  // Padrão específico E-Mola / carteira: provider + valor + ref (mesmo sem "confirmado" explícito)
  const hasMobileWalletPattern = /(?:e[-\s]?mola|m[-\s]?pesa|mkesh|mcel\s*money|bim\s*movel).*\b\d+/i.test(normalizedText);

  // É considerado comprovativo se encontrar pelo menos 2 palavras-chave configuradas
  // OU padrões estruturados de moeda + confirmação/referência
  // OU nome de carteira móvel com valor
  if (matchedKeywordCount >= 2) return true;
  if (hasMobileWalletPattern && (hasCurrencyPattern || hasTransactionIdPattern)) return true;
  if (hasConfirmationWords && (hasCurrencyPattern || hasTransactionIdPattern)) return true;

  return false;
}

/**
 * Extrai dados úteis do comprovativo para exibição no grupo (se disponível).
 * @param {string} text 
 */
export function parseProofDetails(text) {
  const result = {
    rawText: text,
    transactionCode: null,
    amount: null
  };

  // Tentativa de extrair código da transação (ex: Ref: 9A81726GB)
  const txMatch = text.match(/(?:ref|txid|código|codigo|transaccao)\s*[:\.]?\s*([a-z0-9]{6,15})/i);
  if (txMatch) {
    result.transactionCode = txMatch[1];
  }

  // Tentativa de extrair valor em MT (ex: 100.00MT ou 100 MT)
  const amountMatch = text.match(/(\d+(?:[\.,]\d{1,2})?)\s*(?:mt|meticais)\b/i);
  if (amountMatch) {
    result.amount = amountMatch[1] + ' MT';
  }

  return result;
}
