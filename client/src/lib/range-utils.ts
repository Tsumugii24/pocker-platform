import { Card, Suit, Rank, TestConfig } from '@/types/poker';

export const DEFAULT_RANGE_OOP = "AQs:0.250,AJs:0.250,ATs:0.250,A9s,A8s,A7s,A6s,A5s,A4s:0.750,A3s:0.750,A2s:0.750,KQs:0.250,KJs:0.250,KTs:0.750,K9s:0.750,K8s,K7s,K6s,K5s,K4s,K3s,K2s,AQo:0.250,KQo:0.500,QJs:0.500,QTs:0.750,Q9s:0.750,Q8s,Q7s,Q6s,Q5s,Q4s,Q3s,Q2s,AJo:0.750,KJo,QJo,JTs:0.250,J9s:0.500,J8s,J7s,J6s,J5s,J4s,J3s,J2s,ATo:0.750,KTo,QTo,JTo,TT:0.250,T9s:0.750,T8s,T7s:0.984,T6s,T5s:0.250,T4s:0.250,T3s:0.250,T2s:0.250,A9o,K9o,Q9o,J9o,T9o,99:0.250,98s:0.750,97s,96s,95s:0.250,94s:0.250,93s:0.250,92s:0.250,A8o,98o:0.250,88,87s:0.750,86s,85s,84s:0.250,83s:0.250,82s:0.250,A7o,87o:0.250,77,76s:0.750,75s,74s:0.596,73s:0.250,72s:0.250,A6o,76o:0.250,66,65s:0.750,64s,63s:0.564,62s:0.250,A5o:0.750,65o:0.250,55,54s:0.750,53s,52s:0.552,A4o,54o:0.250,44:0.996,43s,42s:0.524,A3o,33,32s:0.250,A2o,22";

export const DEFAULT_RANGE_IP = "AA,AKs,AQs,AJs,ATs,A9s,A8s,A7s,A6s,A5s,A4s,A3s,A2s,AKo,KK,KQs,KJs,KTs,K9s,K8s,K7s,K6s,K5s,K4s,K3s,K2s,AQo,KQo,QQ,QJs,QTs,Q9s,Q8s,Q7s,Q6s,Q5s,Q4s,Q3s,Q2s,AJo,KJo,QJo,JJ,JTs,J9s,J8s,J7s,J6s,J5s,J4s,J3s,J2s,ATo,KTo,QTo,JTo,TT,T9s,T8s,T7s,T6s,T5s,T4s,T3s,A9o,K9o,Q9o,J9o,T9o,99,98s,97s,96s,95s,A8o,98o:0.500,88,87s,86s,85s,84s,A7o,87o:0.500,77,76s,75s,74s,A6o,76o:0.500,66,65s,64s,A5o,65o:0.500,55,54s,53s,A4o,54o:0.500,44,43s,A3o,33,A2o,22";

export function getCombosForRangeItem(item: string): [Card, Card][] {
    const handType = item.split(':')[0];
    const suits: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
    const combos: [Card, Card][] = [];

    if (handType.length === 2 && handType[0] === handType[1]) {
        const rank = handType[0] as Rank;
        for (let i = 0; i < suits.length; i++) {
            for (let j = i + 1; j < suits.length; j++) {
                combos.push([{ suit: suits[i], rank }, { suit: suits[j], rank }]);
            }
        }
    } else if (handType.length === 3 && handType[2] === 's') {
        const rank1 = handType[0] as Rank;
        const rank2 = handType[1] as Rank;
        for (const suit of suits) {
            combos.push([{ suit, rank: rank1 }, { suit, rank: rank2 }]);
        }
    } else if (handType.length === 3 && handType[2] === 'o') {
        const rank1 = handType[0] as Rank;
        const rank2 = handType[1] as Rank;
        for (const suit1 of suits) {
            for (const suit2 of suits) {
                if (suit1 !== suit2) {
                    combos.push([{ suit: suit1, rank: rank1 }, { suit: suit2, rank: rank2 }]);
                }
            }
        }
    }

    return combos;
}

export function getAllCombosFromRangeStr(rangeStr: string): [Card, Card][] {
    const items = rangeStr.split(',');
    const allCombos: [Card, Card][] = [];
    for (const item of items) {
        if (!item.trim()) continue;
        allCombos.push(...getCombosForRangeItem(item.trim()));
    }
    return allCombos;
}

export function pickRandomHandFromCombos(combos: [Card, Card][], excludeCards: Card[]): [Card, Card] | null {
    const validCombos = combos.filter(combo => {
        const c1 = combo[0];
        const c2 = combo[1];
        const conflict = excludeCards.some(ec => (ec.rank === c1.rank && ec.suit === c1.suit) || (ec.rank === c2.rank && ec.suit === c2.suit));
        return !conflict;
    });

    if (validCombos.length === 0) return null;

    const randomIndex = Math.floor(Math.random() * validCombos.length);
    return validCombos[randomIndex];
}

export function generateHoleCards(cfg: TestConfig, excludedCards: Card[], deckToDrawFrom: Card[]): { heroHole: [Card, Card], villainHole: [Card, Card], remainingDeck: Card[] } {
    const isHeroOOP = cfg.heroPosition === 'BB'; // Very simplified, BB is OOP against UTG.
    const allowHeroBluff = cfg.allowPlayerBluff ?? true;
    const allowVillainBluff = cfg.allowAIBluff ?? true;

    let heroHole: [Card, Card] | null = null;
    let villainHole: [Card, Card] | null = null;
    const poolExclusions = [...excludedCards];

    // Pick AI's (villain) hand first if restricted
    if (!allowVillainBluff) {
        const villainRangeStr = isHeroOOP ? DEFAULT_RANGE_IP : DEFAULT_RANGE_OOP;
        const combos = getAllCombosFromRangeStr(villainRangeStr);
        villainHole = pickRandomHandFromCombos(combos, poolExclusions);
        if (villainHole) poolExclusions.push(...villainHole);
    }
    // Pick Hero's hand if restricted
    if (!allowHeroBluff) {
        const heroRangeStr = isHeroOOP ? DEFAULT_RANGE_OOP : DEFAULT_RANGE_IP;
        const combos = getAllCombosFromRangeStr(heroRangeStr);
        heroHole = pickRandomHandFromCombos(combos, poolExclusions);
        if (heroHole) poolExclusions.push(...heroHole);
    }

    // Filter deck
    let currentDeck = deckToDrawFrom.filter(c => !poolExclusions.some(ec => ec.rank === c.rank && ec.suit === c.suit));

    // Fill missing
    if (!heroHole) {
        heroHole = [currentDeck[0], currentDeck[1]];
        currentDeck = currentDeck.slice(2);
    }
    if (!villainHole) {
        villainHole = [currentDeck[0], currentDeck[1]];
        currentDeck = currentDeck.slice(2);
    }

    return { heroHole, villainHole, remainingDeck: currentDeck };
}
