import { isPaymentProof, parseProofDetails } from './src/utils/proofValidator.js';

const keywords = ['confirmado','transferido','mpesa','m-pesa','e-mola','emola','referencia','transacao','transaccao'];

const testCases = [
  { label: 'M-Pesa real',     text: 'Confirmado. Voce recebeu 100.00MT de 84XXXXXXX. Transacao T3K47821GH. Saldo 50.00MT.' },
  { label: 'E-Mola',         text: 'E-Mola: Transferencia de 190MT confirmada. Ref: EM8291021B. Data: 10/08/2026.' },
  { label: 'Banco BCI',      text: 'BCI: Transferencia de 370,00 MT efectuada com sucesso. Ref 99182736. 10-08-2026 00:12h.' },
  { label: 'Mensagem normal', text: 'Boa tarde, quero saber os precos dos megas por favor' },
  { label: 'Saudacao curta', text: 'Ola!' },
  { label: 'Pedido pacote',  text: 'Quero 1GB da Vodacom' },
];

console.log('--- TESTE DE DETECCAO DE COMPROVATIVOS ---\n');
for (const tc of testCases) {
  const result = isPaymentProof(tc.text, keywords);
  const icon = result ? '✅ COMPROVATIVO DETECTADO' : '💬 Mensagem Normal';
  console.log(`[${tc.label}] => ${icon}`);
  if (result) {
    const details = parseProofDetails(tc.text);
    if (details.amount || details.transactionCode) {
      console.log(`   Valor: ${details.amount || 'n/a'} | Codigo: ${details.transactionCode || 'n/a'}`);
    }
  }
  console.log();
}

console.log('--- VERIFICACAO CONFIG ---\n');
import fs from 'fs';
import path from 'path';
const configPath = path.resolve('config', 'bot_config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
console.log(`Sessoes configuradas: ${config.sessions.length}`);
console.log(`Sessoes activas: ${config.sessions.filter(s => s.enabled).length}`);
console.log(`Grupo de suporte: ${config.globalSettings.supportGroupJid}`);
console.log(`Anti-ban min delay: ${config.globalSettings.antiBan.minDelayMs}ms`);
console.log(`Anti-ban max delay: ${config.globalSettings.antiBan.maxDelayMs}ms`);
console.log('\n✅ Configuracao OK - Bot pronto para iniciar!\n');
