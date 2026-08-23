# 📱 Almeida Net Shop — WhatsApp Bot + Dashboard

Sistema completo de automação de vendas de pacotes de internet (megas) via WhatsApp, com **5 números simultâneos**, **dashboard web de gestão** e **proteção anti-banimento** integrada. Desenvolvido em Node.js com Baileys.

---

## ✨ Funcionalidades

| Funcionalidade | Descrição |
|---|---|
| 🔁 **Multi-Sessão** | 5 números de WhatsApp activos em simultâneo |
| 📋 **Atendimento Automático** | Saudação + tabela de preços + formas de pagamento enviadas automaticamente |
| 💳 **Detecção de Comprovativos** | Reconhece SMS de M-Pesa, E-Mola, BCI e outros bancos |
| 📨 **Reencaminhamento para Grupo** | Envia comprovativo + contacto do cliente para o grupo de assistentes |
| 🛡️ **Anti-Ban Integrado** | Delays aleatórios + simulação de digitação humana |
| 📊 **Dashboard Web** | Painel de gestão com senha por número, acessível via browser |
| ⚡ **Edição em Tempo Real** | Alterações no dashboard entram em vigor sem reiniciar o bot |

---

## 📁 Estrutura do Projecto

```
whatsapp-megas-bot/
├── config/
│   └── bot_config.json       # ⚙️ Configuração principal (preços, senhas, sessões)
├── dashboard/
│   └── index.html            # 📊 Painel Web (HTML/CSS/JS)
├── src/
│   ├── index.js              # 🚀 Ponto de entrada + API Express
│   ├── sessionManager.js     # 📲 Gestão de sessões WhatsApp
│   ├── botEngine.js          # 🧠 Lógica de atendimento e menus
│   ├── configStore.js        # 🗄️ Singleton de config dinâmica
│   └── utils/
│       ├── logger.js         # 🖨️ Logs coloridos
│       └── proofValidator.js # ✅ Detecção de comprovativos
├── tokens/                   # 🔐 Credenciais de sessão (criada automaticamente)
├── .gitignore
├── package.json
└── README.md
```

---

## ⚡ Guia de Instalação

### Pré-requisitos
- **Node.js** v18 ou superior → [nodejs.org](https://nodejs.org)
- 5 números de WhatsApp (preferencialmente WhatsApp Business)

### Passo 1 — Instalar dependências
```bash
npm install
```

### Passo 2 — Configurar `config/bot_config.json`
Editar os campos:
- `packagesTable` → tabela de preços real
- `paymentMethods` → M-Pesa, E-Mola, dados bancários
- `supportGroupJid` → ID do grupo de assistentes (ver Passo 5)
- `password` em cada sessão → senha do dashboard por número

### Passo 3 — Iniciar o Bot
```bash
npm start
```

### Passo 4 — Escanear os QR Codes
Para cada sessão activa, o terminal exibe um QR Code:
1. Abrir WhatsApp → **Aparelhos Conectados** → **Conectar um Aparelho**
2. Apontar a câmara para o QR Code
3. Aguardar: `✅ [Contacto 1] CONECTADO!`

### Passo 5 — Obter o ID do Grupo de Suporte
1. Adicionar um dos números do bot ao grupo de atendimento
2. No grupo, digitar: `!jid`
3. O bot responde com o ID (ex: `120363XXXXX@g.us`)
4. Colar esse ID no campo `supportGroupJid` do `bot_config.json`
5. Reiniciar o bot

---

## 📊 Dashboard Web

Após iniciar o bot, o dashboard está disponível em:

```
http://localhost:3000/dashboard
```

### Como usar:
1. Abrir o endereço no browser
2. Clicar no número que pretende gerir
3. Introduzir a senha correspondente (padrão: `almeida1`, `almeida2`, etc.)
4. Editar a **Tabela de Pacotes** e/ou as **Formas de Pagamento**
5. Clicar **Guardar Alterações** → o bot actualiza na hora!

> ⚠️ **Alterar as senhas padrão** após instalação, editando o campo `"password"` de cada sessão em `bot_config.json`.

### Senhas iniciais por sessão:
| Sessão | Senha Padrão |
|---|---|
| Contacto 1 | `almeida1` |
| Contacto 2 | `almeida2` |
| Contacto 3 | `almeida3` |
| Contacto 4 | `almeida4` |
| Contacto 5 | `almeida5` |

---

## 🌐 Deploy Gratuito 24/7 — Oracle Cloud Free Tier

Para o bot e dashboard ficarem **sempre online** sem depender do teu computador pessoal:

### 1. Criar Conta Oracle Cloud (Grátis para Sempre)
- Aceder a [cloud.oracle.com](https://cloud.oracle.com) e criar conta gratuita
- Nenhum cartão de crédito necessário para o tier gratuito

### 2. Criar a Máquina Virtual (VM)
1. No painel Oracle Cloud → **Compute** → **Instances** → **Create Instance**
2. Escolher imagem: **Ubuntu 22.04 LTS**
3. Shape: **VM.Standard.E2.1.Micro** (Always Free ✅)
4. Guardar o par de chaves SSH gerado
5. Clicar **Create**
6. Aguardar a VM ficar activa e copiar o **IP Público**

### 3. Abrir a Porta 3000 no Firewall Oracle
No painel Oracle: **Networking** → **Virtual Cloud Networks** → **Security Lists** → **Add Ingress Rule**:
- Source CIDR: `0.0.0.0/0`
- Destination Port: `3000`

E no servidor Ubuntu (via SSH):
```bash
sudo iptables -I INPUT -p tcp --dport 3000 -j ACCEPT
sudo netfilter-persistent save
```

### 4. Instalar Node.js no Servidor
```bash
ssh -i <chave.pem> ubuntu@<IP_DO_SERVIDOR>

curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git
```

### 5. Fazer Upload do Projecto
```bash
# No teu computador local:
scp -i chave.pem -r ./whatsapp-megas-bot ubuntu@<IP>:~/

# Ou via Git (mais recomendado):
# No servidor:
git clone https://github.com/SEU_USUARIO/whatsapp-megas-bot.git
cd whatsapp-megas-bot
npm install
```

### 6. Instalar PM2 (Gestor de Processos)
```bash
sudo npm install -g pm2

# Iniciar o bot com PM2
pm2 start src/index.js --name megas-bot

# Guardar para reiniciar automaticamente após reboot
pm2 save
pm2 startup
# (executar o comando que o PM2 sugerir)
```

### 7. Aceder ao Dashboard Remotamente
```
http://<IP_DO_SERVIDOR>:3000/dashboard
```

> ✅ O bot e dashboard ficam activos 24h/7d sem o teu computador ligado!

---

## 🛡️ Configurações Anti-Banimento

| Parâmetro | Valor Padrão | Descrição |
|---|---|---|
| `minDelayMs` | `2500` | Atraso mínimo antes de responder |
| `maxDelayMs` | `5000` | Atraso máximo antes de responder |
| `simulateTyping` | `true` | Activa o estado "A digitar..." |
| `inboundOnly` | `true` | Bot responde apenas a quem escreveu primeiro |

> ⚠️ Nunca usar o bot para enviar mensagens em massa não solicitadas.

---

## 🔄 Fluxo de Mensagens

```
Cliente envia mensagem
    │
    ├── É comprovativo de pagamento? (M-Pesa / E-Mola / SMS banco)
    │       │
    │       ├── SIM → Responde ao cliente: "✅ Comprovativo recebido!"
    │       │         Envia ao Grupo: número + comprovativo + canal
    │       │
    │       └── NÃO → Envia Saudação + Tabela de Preços (msg 1)
    │                  Envia Formas de Pagamento (msg 2)
    │
    └── Anti-Ban: delay aleatório 2.5s–5s + simulação de digitação
```

---

## 📞 Suporte
Para dúvidas ou problemas, contactar o desenvolvedor.
