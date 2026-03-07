import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export default function LoginPage() {
    const { login, register } = useAuth();
    const [mode, setMode] = useState<'login' | 'register'>('login');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsSubmitting(true);

        if (mode === 'register') {
            if (password !== confirmPassword) {
                setError('Passwords do not match.');
                setIsSubmitting(false);
                return;
            }
            const result = register(username, password);
            if (!result.ok) setError(result.error ?? 'Registration failed.');
        } else {
            const result = login(username, password);
            if (!result.ok) setError(result.error ?? 'Login failed.');
        }

        setIsSubmitting(false);
    };

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center p-4">
            <div className="w-full max-w-sm">
                {/* Logo / Title */}
                <div className="text-center mb-10">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#00d084]/10 border border-[#00d084]/30 mb-4">
                        <span className="text-3xl">♠</span>
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight">Texas Hold'em</h1>
                    <p className="text-gray-500 text-sm mt-1">Poker Test Platform</p>
                </div>

                {/* Tab switcher */}
                <div className="flex bg-[#111] rounded-lg p-1 mb-6 border border-[#222]">
                    {(['login', 'register'] as const).map((m) => (
                        <button
                            key={m}
                            onClick={() => { setMode(m); setError(''); }}
                            className={cn(
                                'flex-1 py-2 text-sm font-semibold rounded-md transition-all',
                                mode === m
                                    ? 'bg-[#00d084] text-black'
                                    : 'text-gray-400 hover:text-white'
                            )}
                        >
                            {m === 'login' ? 'Login' : 'Register'}
                        </button>
                    ))}
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-1.5">
                        <Label htmlFor="username" className="text-sm text-gray-300">Username</Label>
                        <Input
                            id="username"
                            autoComplete="username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="e.g. player1"
                            className="bg-[#111] border-[#333] focus:border-[#00d084] text-white h-11"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="password" className="text-sm text-gray-300">Password</Label>
                        <Input
                            id="password"
                            type="password"
                            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            className="bg-[#111] border-[#333] focus:border-[#00d084] text-white h-11"
                        />
                    </div>

                    {mode === 'register' && (
                        <div className="space-y-1.5">
                            <Label htmlFor="confirm" className="text-sm text-gray-300">Confirm Password</Label>
                            <Input
                                id="confirm"
                                type="password"
                                autoComplete="new-password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                placeholder="••••••••"
                                className="bg-[#111] border-[#333] focus:border-[#00d084] text-white h-11"
                            />
                        </div>
                    )}

                    {error && (
                        <div className="text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-md px-3 py-2">
                            {error}
                        </div>
                    )}

                    <Button
                        type="submit"
                        disabled={isSubmitting || !username || !password}
                        className="w-full h-11 bg-[#00d084] hover:bg-[#00d084]/90 text-black font-semibold mt-2"
                    >
                        {mode === 'login' ? 'Login' : 'Create Account'}
                    </Button>
                </form>

                <p className="text-center text-xs text-gray-600 mt-8">
                    Data is stored locally in your browser.
                </p>
            </div>
        </div>
    );
}
