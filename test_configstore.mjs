// Teste rápido do configStore
import { loadConfig, getEffectiveMenu, verifySessionPassword, updateSessionMenu } from './src/configStore.js';

console.log('\n--- TESTE DO CONFIGSTORE ---\n');

const config = loadConfig();
console.log(`✅ Config carregada. Sessões: ${config.sessions.length}`);

// Testar senhas
const tests = [
  { id: 'sessao_1', pw: 'almeida1',  expected: true  },
  { id: 'sessao_2', pw: 'errada',    expected: false  },
  { id: 'sessao_1', pw: 'almeida2',  expected: false  },
  { id: 'sessao_5', pw: 'almeida5',  expected: true   },
];

console.log('\nTeste de verificação de senhas:');
let allPass = true;
tests.forEach(t => {
  const result = verifySessionPassword(t.id, t.pw);
  const ok = result === t.expected;
  if (!ok) allPass = false;
  console.log(`  [${t.id}] pw="${t.pw}" => ${result} ${ok ? '✅' : '❌'}`);
});

// Testar getEffectiveMenu
console.log('\nTeste do menu efectivo (sessao_1 usa defaultMenu):');
const menu = getEffectiveMenu('sessao_1');
const hasPackages = menu && menu.packagesTable && menu.packagesTable.length > 10;
const hasPayment  = menu && menu.paymentMethods && menu.paymentMethods.length > 10;
console.log(`  packagesTable presente: ${hasPackages ? '✅' : '❌'}`);
console.log(`  paymentMethods presente: ${hasPayment  ? '✅' : '❌'}`);

// Testar updateSessionMenu (restauramos depois)
console.log('\nTeste de updateSessionMenu:');
const original = { ...menu };
updateSessionMenu('sessao_1', { packagesTable: 'TESTE_PACOTES', paymentMethods: 'TESTE_PAGAMENTO' });
const updated = getEffectiveMenu('sessao_1');
const upOk = updated.packagesTable === 'TESTE_PACOTES' && updated.paymentMethods === 'TESTE_PAGAMENTO';
console.log(`  Actualização aplicada em memória: ${upOk ? '✅' : '❌'}`);

// Restaurar
updateSessionMenu('sessao_1', {
  packagesTable:  original.packagesTable,
  paymentMethods: original.paymentMethods
});
// Remover customMenu restaurado (limpar)
const cfg = loadConfig();
const s1 = cfg.sessions.find(s => s.id === 'sessao_1');
if (s1 && s1.customMenu) {
  s1.customMenu = null;
  import('fs').then(fs => {
    fs.writeFileSync('config/bot_config.json', JSON.stringify(cfg, null, 2), 'utf-8');
    console.log('  Config restaurada (customMenu=null): ✅');
  });
}

console.log(`\n${allPass && upOk && hasPackages && hasPayment ? '✅ TODOS OS TESTES PASSARAM!' : '⚠️ Alguns testes falharam.'}\n`);
