import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';

export default function Home() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center gap-8">
      <div className="text-center">
        <h1 className="text-5xl font-bold mb-4">Texas Hold'em Poker Test Platform</h1>
        <p className="text-gray-400 text-lg">Click to start game</p>
      </div>

      <div className="flex flex-col gap-4 w-80">
        <Button
          onClick={() => setLocation('/game')}
          size="lg"
          className="w-full h-16 bg-[#00d084] hover:bg-[#00d084]/90 text-black font-semibold text-lg"
        >
          Start Game
        </Button>
      </div>

      <div className="text-xs text-gray-600 text-center mt-8">
        <p>Minimalistic · 6-max table · Local Test Version</p>
        <p className="mt-2">Switch between single table and four tables in game</p>
      </div>
    </div>
  );
}
