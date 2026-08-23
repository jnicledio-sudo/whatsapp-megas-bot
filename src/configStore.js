import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONFIG_PATH = path.resolve(__dirname, '..', 'config', 'bot_config.json');

/** Config singleton em memória */
let _config = null;

/**
 * Lê o ficheiro config do disco e carrega em memória.
 * @returns {object} config completo
 */
export function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    _config = JSON.parse(raw);
    return _config;
  } catch (err) {
    throw new Error(`Erro ao carregar bot_config.json: ${err.message}`);
  }
}

/**
 * Devolve a config em memória (carrega do disco se ainda não estiver carregada).
 * @returns {object}
 */
export function getConfig() {
  if (!_config) loadConfig();
  return _config;
}

/**
 * Devolve o menu efectivo de uma sessão:
 * usa customMenu se existir, caso contrário usa defaultMenu global.
 * @param {string} sessionId
 * @returns {object|null}
 */
export function getEffectiveMenu(sessionId) {
  const config = getConfig();
  const session = config.sessions.find(s => s.id === sessionId);
  if (!session) return null;
  return session.customMenu || config.globalSettings.defaultMenu;
}

/**
 * Actualiza os campos packagesTable e/ou paymentMethods de uma sessão.
 * Escreve as alterações no ficheiro e actualiza o objecto em memória.
 * @param {string} sessionId
 * @param {{ packagesTable?: string, paymentMethods?: string }} updates
 * @returns {object} a sessão actualizada
 */
export function updateSessionMenu(sessionId, updates) {
  const config = getConfig();
  const session = config.sessions.find(s => s.id === sessionId);
  if (!session) throw new Error(`Sessão "${sessionId}" não encontrada.`);

  // Se a sessão ainda não tem customMenu, clone o defaultMenu global
  if (!session.customMenu) {
    session.customMenu = { ...config.globalSettings.defaultMenu };
  }

  if (updates.packagesTable !== undefined) {
    session.customMenu.packagesTable = updates.packagesTable;
  }
  if (updates.paymentMethods !== undefined) {
    session.customMenu.paymentMethods = updates.paymentMethods;
  }

  // Persiste no disco
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');

  return session;
}

/**
 * Verifica se a senha fornecida corresponde à sessão indicada.
 * @param {string} sessionId
 * @param {string} password
 * @returns {boolean}
 */
export function verifySessionPassword(sessionId, password) {
  if (!sessionId || !password) return false;
  const config = getConfig();
  const session = config.sessions.find(s => s.id === sessionId);
  if (!session) return false;
  return session.password === password;
}
