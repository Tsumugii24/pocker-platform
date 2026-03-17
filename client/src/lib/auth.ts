import {
  FRONTEND_AUTH_CONFIG,
  FRONTEND_STORAGE_CONFIG,
  buildScopedStorageKey,
} from '@/config/frontend-config';

export interface Account {
  username: string;
  passwordHash: string;
  createdAt: string;
  isAdmin: boolean;
}

const ACCOUNTS_STORAGE_KEY = FRONTEND_STORAGE_CONFIG.accountStoreKey;
const SESSION_STORAGE_KEY = FRONTEND_STORAGE_CONFIG.sessionStoreKey;

function simpleHash(input: string): string {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    const characterCode = input.charCodeAt(index);
    hash = (hash << 5) - hash + characterCode;
    hash = hash & hash;
  }
  return hash.toString(16);
}

function loadAccounts(): Account[] {
  try {
    const storedAccounts = localStorage.getItem(ACCOUNTS_STORAGE_KEY);
    return storedAccounts ? JSON.parse(storedAccounts) : [];
  } catch {
    return [];
  }
}

function saveAccounts(accounts: Account[]) {
  localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(accounts));
}

export function seedAdminAccount() {
  const accounts = loadAccounts();
  const adminExists = accounts.some(
    account => account.username === FRONTEND_AUTH_CONFIG.defaultAdminUsername,
  );

  if (!adminExists) {
    accounts.unshift({
      username: FRONTEND_AUTH_CONFIG.defaultAdminUsername,
      passwordHash: simpleHash(FRONTEND_AUTH_CONFIG.defaultAdminPassword),
      createdAt: new Date().toISOString(),
      isAdmin: true,
    });
    saveAccounts(accounts);
  }
}

export function login(username: string, password: string): Account | null {
  const accounts = loadAccounts();
  const account = accounts.find(
    savedAccount =>
      savedAccount.username === username &&
      savedAccount.passwordHash === simpleHash(password),
  );

  if (account) {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(account));
    return account;
  }

  return null;
}

export function logout() {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

export function getSession(): Account | null {
  try {
    const storedSession = localStorage.getItem(SESSION_STORAGE_KEY);
    return storedSession ? JSON.parse(storedSession) : null;
  } catch {
    return null;
  }
}

export function register(username: string, password: string): { ok: boolean; error?: string } {
  if (!username.trim() || username.length < FRONTEND_AUTH_CONFIG.minimumUsernameLength) {
    return {
      ok: false,
      error: `Username must be at least ${FRONTEND_AUTH_CONFIG.minimumUsernameLength} characters.`,
    };
  }

  if (!password || password.length < FRONTEND_AUTH_CONFIG.minimumPasswordLength) {
    return {
      ok: false,
      error: `Password must be at least ${FRONTEND_AUTH_CONFIG.minimumPasswordLength} characters.`,
    };
  }

  const accounts = loadAccounts();
  if (accounts.some(account => account.username === username)) {
    return { ok: false, error: 'Username already taken.' };
  }

  const newAccount: Account = {
    username: username.trim(),
    passwordHash: simpleHash(password),
    createdAt: new Date().toISOString(),
    isAdmin: false,
  };

  accounts.push(newAccount);
  saveAccounts(accounts);
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(newAccount));
  return { ok: true };
}

export function listAccounts(): Account[] {
  return loadAccounts();
}

export function handHistoryKey(username: string): string {
  return buildScopedStorageKey(FRONTEND_STORAGE_CONFIG.handHistoryStorePrefix, username);
}

export function quickBetSizesKey(username: string): string {
  return buildScopedStorageKey(FRONTEND_STORAGE_CONFIG.quickBetSizesStorePrefix, username);
}

export function testConfigKey(username: string): string {
  return buildScopedStorageKey(FRONTEND_STORAGE_CONFIG.testConfigStorePrefix, username);
}
