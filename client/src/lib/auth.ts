// ─── Account management (localStorage-based) ─────────────────────────────────

export interface Account {
    username: string;
    passwordHash: string; // simple hash, not cryptographic
    createdAt: string;
    isAdmin: boolean;
}

const ACCOUNTS_KEY = 'poker_accounts';
const SESSION_KEY = 'poker_session';

// Simple deterministic hash (good enough for a local test platform)
function simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash; // convert to 32-bit int
    }
    return hash.toString(16);
}

function loadAccounts(): Account[] {
    try {
        const stored = localStorage.getItem(ACCOUNTS_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch {
        return [];
    }
}

function saveAccounts(accounts: Account[]) {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

/** Seed the default admin account if it doesn't exist yet */
export function seedAdminAccount() {
    const accounts = loadAccounts();
    const adminExists = accounts.some((a) => a.username === 'admin');
    if (!adminExists) {
        accounts.unshift({
            username: 'admin',
            passwordHash: simpleHash('admin'),
            createdAt: new Date().toISOString(),
            isAdmin: true,
        });
        saveAccounts(accounts);
    }
}

export function login(username: string, password: string): Account | null {
    const accounts = loadAccounts();
    const account = accounts.find(
        (a) => a.username === username && a.passwordHash === simpleHash(password)
    );
    if (account) {
        localStorage.setItem(SESSION_KEY, JSON.stringify(account));
        return account;
    }
    return null;
}

export function logout() {
    localStorage.removeItem(SESSION_KEY);
}

export function getSession(): Account | null {
    try {
        const stored = localStorage.getItem(SESSION_KEY);
        return stored ? JSON.parse(stored) : null;
    } catch {
        return null;
    }
}

export function register(username: string, password: string): { ok: boolean; error?: string } {
    if (!username.trim() || username.length < 2) {
        return { ok: false, error: 'Username must be at least 2 characters.' };
    }
    if (!password || password.length < 4) {
        return { ok: false, error: 'Password must be at least 4 characters.' };
    }
    const accounts = loadAccounts();
    if (accounts.some((a) => a.username === username)) {
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
    // Auto-login after register
    localStorage.setItem(SESSION_KEY, JSON.stringify(newAccount));
    return { ok: true };
}

export function listAccounts(): Account[] {
    return loadAccounts();
}

/** localStorage key for hand history scoped to a user */
export function handHistoryKey(username: string): string {
    return `poker_hand_history_${username}`;
}

/** localStorage key for quick bet sizes scoped to a user */
export function quickBetSizesKey(username: string): string {
    return `poker_quick_bet_sizes_${username}`;
}

/** localStorage key for test config scoped to a user */
export function testConfigKey(username: string): string {
    return `poker_test_config_${username}`;
}
