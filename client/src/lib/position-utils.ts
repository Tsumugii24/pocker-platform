import type { Position, Player } from '@/types/poker';

// 6-max position order (clockwise from UTG)
const POSITION_ORDER: Position[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

// Visual seat positions on the table (0 = hero seat at bottom right)
// Seats are arranged clockwise: 0(bottom-right/hero) -> 1(left) -> 2(top-left) -> 3(top-right) -> 4(right) -> 5(bottom-left)
interface SeatPosition {
  top?: string;
  bottom?: string;
  left?: string;
  right?: string;
}

const SEAT_POSITIONS_SINGLE: SeatPosition[] = [
  { bottom: '15%', right: '25%' },  // Seat 0: Hero (bottom-right)
  { top: '40%', left: '8%' },        // Seat 1: Left
  { top: '10%', left: '20%' },       // Seat 2: Top-left
  { top: '10%', right: '20%' },      // Seat 3: Top-right
  { top: '40%', right: '8%' },       // Seat 4: Right
  { bottom: '15%', left: '25%' },    // Seat 5: Bottom-left
];

const SEAT_POSITIONS_MULTI: SeatPosition[] = [
  { bottom: '12%', right: '20%' },   // Seat 0: Hero (bottom-right)
  { top: '35%', left: '5%' },        // Seat 1: Left
  { top: '8%', left: '15%' },        // Seat 2: Top-left
  { top: '8%', right: '15%' },       // Seat 3: Top-right
  { top: '35%', right: '5%' },       // Seat 4: Right
  { bottom: '12%', left: '20%' },    // Seat 5: Bottom-left
];

/**
 * Map players to visual seat positions based on hero's position
 * Hero always sits at seat 0 (bottom-right)
 */
export function getPlayerSeats(players: Player[]): Array<{ player: Player; seatIndex: number }> {
  const heroPlayer = players.find(p => p.isHero);
  if (!heroPlayer) {
    // Fallback: use original order
    return players.map((player, index) => ({ player, seatIndex: index }));
  }
  
  const heroPositionIndex = POSITION_ORDER.indexOf(heroPlayer.position);
  
  return players.map(player => {
    const playerPositionIndex = POSITION_ORDER.indexOf(player.position);
    // Calculate relative seat: how many seats clockwise from hero
    let relativeSeat = (playerPositionIndex - heroPositionIndex + 6) % 6;
    
    return {
      player,
      seatIndex: relativeSeat
    };
  });
}

/**
 * Get CSS position styles for a seat
 */
export function getSeatPosition(seatIndex: number, isSingleView: boolean): SeatPosition {
  const positions = isSingleView ? SEAT_POSITIONS_SINGLE : SEAT_POSITIONS_MULTI;
  return positions[seatIndex] || positions[0];
}
