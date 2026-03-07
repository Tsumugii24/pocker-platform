import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { type Account, getSession, login, logout, register, seedAdminAccount } from '@/lib/auth';

interface AuthContextValue {
    user: Account | null;
    isLoading: boolean;
    login: (username: string, password: string) => { ok: boolean; error?: string };
    register: (username: string, password: string) => { ok: boolean; error?: string };
    logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<Account | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        seedAdminAccount();
        const session = getSession();
        setUser(session);
        setIsLoading(false);
    }, []);

    const handleLogin = (username: string, password: string): { ok: boolean; error?: string } => {
        const account = login(username, password);
        if (account) {
            setUser(account);
            return { ok: true };
        }
        return { ok: false, error: 'Invalid username or password.' };
    };

    const handleRegister = (username: string, password: string): { ok: boolean; error?: string } => {
        const result = register(username, password);
        if (result.ok) {
            const session = getSession();
            setUser(session);
        }
        return result;
    };

    const handleLogout = () => {
        logout();
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{ user, isLoading, login: handleLogin, register: handleRegister, logout: handleLogout }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
    return ctx;
}
