from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from itertools import permutations
from pathlib import Path
from typing import Iterable


RANKS = "23456789TJQKA"
SUITS = "cdhs"
CARD_LEN = 2
HAND_LEN = 4

SCRIPT_DIR = Path(__file__).parent.resolve()
AI_DIR = SCRIPT_DIR.parent
CARDS_TXT_PATH = AI_DIR / "test" / "cards.txt"


@dataclass(frozen=True)
class FlopIsomorphismMapping:
    canonical_flop: str
    actual_to_canonical_suits: dict[str, str]
    canonical_to_actual_suits: dict[str, str]
    actual_ordered_flop_cards: tuple[str, str, str]
    canonical_ordered_flop_cards: tuple[str, str, str]


@lru_cache(maxsize=1)
def load_canonical_flops() -> frozenset[str]:
    if not CARDS_TXT_PATH.exists():
        raise FileNotFoundError(f"Canonical flop list was not found: {CARDS_TXT_PATH}")

    flops = {
        line.strip()
        for line in CARDS_TXT_PATH.read_text(encoding="utf-8").splitlines()
        if line.strip()
    }
    return frozenset(flops)


@lru_cache(maxsize=1)
def load_canonical_flop_count() -> int:
    return len(load_canonical_flops())


def split_compact_cards(compact: str) -> tuple[str, ...]:
    text = compact.strip()
    if len(text) % CARD_LEN != 0:
        raise ValueError(f"Invalid compact card string: {compact}")
    return tuple(text[index : index + CARD_LEN] for index in range(0, len(text), CARD_LEN))


def normalize_card(card: str) -> str:
    text = card.strip()
    if len(text) != CARD_LEN:
        raise ValueError(f"Invalid card length: {card}")

    rank = text[0].upper()
    suit = text[1].lower()
    if rank not in RANKS or suit not in SUITS:
        raise ValueError(f"Invalid card: {card}")
    return f"{rank}{suit}"


def normalize_board_cards(cards: Iterable[str]) -> tuple[str, ...]:
    normalized = tuple(normalize_card(card) for card in cards)
    ensure_unique_cards(normalized)
    return normalized


def ensure_unique_cards(cards: Iterable[str]) -> None:
    seen: set[str] = set()
    duplicates: list[str] = []
    for raw_card in cards:
        card = normalize_card(raw_card)
        if card in seen and card not in duplicates:
            duplicates.append(card)
        seen.add(card)
    if duplicates:
        raise ValueError(f"Duplicate cards are not allowed: {', '.join(duplicates)}")


def hand_conflicts_with_board(hand: str, board_cards: Iterable[str]) -> bool:
    hand_cards = split_compact_cards(normalize_hand(hand))
    board = set(normalize_board_cards(board_cards))
    return any(card in board for card in hand_cards)


def normalize_hand(hand: str) -> str:
    text = hand.strip()
    if len(text) != HAND_LEN:
        raise ValueError(f"Invalid hand length: {hand}")
    first = normalize_card(text[:CARD_LEN])
    second = normalize_card(text[CARD_LEN:])
    if first == second:
        raise ValueError(f"Hand cannot contain the same card twice: {hand}")
    return f"{first}{second}"


def solve_flop_isomorphism(flop_cards: Iterable[str]) -> FlopIsomorphismMapping:
    actual_cards = normalize_board_cards(flop_cards)
    if len(actual_cards) != 3:
        raise ValueError("Flop isomorphism requires exactly 3 flop cards.")

    canonical_flops = load_canonical_flops()
    suit_permutations = tuple(permutations(SUITS))

    matched_canonical: str | None = None
    matched_mapping: FlopIsomorphismMapping | None = None

    for actual_order in permutations(actual_cards):
        for suit_perm in suit_permutations:
            actual_to_canonical = dict(zip(SUITS, suit_perm))
            canonical_cards = tuple(
                f"{card[0]}{actual_to_canonical[card[1]]}"
                for card in actual_order
            )
            canonical_flop = "".join(canonical_cards)
            if canonical_flop not in canonical_flops:
                continue

            if matched_canonical is None:
                canonical_to_actual = {value: key for key, value in actual_to_canonical.items()}
                matched_canonical = canonical_flop
                matched_mapping = FlopIsomorphismMapping(
                    canonical_flop=canonical_flop,
                    actual_to_canonical_suits=actual_to_canonical,
                    canonical_to_actual_suits=canonical_to_actual,
                    actual_ordered_flop_cards=tuple(actual_order),
                    canonical_ordered_flop_cards=canonical_cards,
                )
                continue

            if canonical_flop != matched_canonical:
                raise ValueError(
                    f"Flop matched multiple canonical boards: {matched_canonical} and {canonical_flop}"
                )

    if matched_mapping is None:
        actual_compact = "".join(actual_cards)
        raise ValueError(f"Flop could not be mapped to a canonical board: {actual_compact}")

    return matched_mapping


def _map_card_with_suit_map(card: str, suit_map: dict[str, str]) -> str:
    normalized = normalize_card(card)
    return f"{normalized[0]}{suit_map[normalized[1]]}"


def map_card_actual_to_canonical(card: str, mapping: FlopIsomorphismMapping) -> str:
    return _map_card_with_suit_map(card, mapping.actual_to_canonical_suits)


def map_card_canonical_to_actual(card: str, mapping: FlopIsomorphismMapping) -> str:
    return _map_card_with_suit_map(card, mapping.canonical_to_actual_suits)


def map_hand_actual_to_canonical(hand: str, mapping: FlopIsomorphismMapping) -> str:
    normalized = normalize_hand(hand)
    first = map_card_actual_to_canonical(normalized[:CARD_LEN], mapping)
    second = map_card_actual_to_canonical(normalized[CARD_LEN:], mapping)
    return f"{first}{second}"


def map_hand_canonical_to_actual(hand: str, mapping: FlopIsomorphismMapping) -> str:
    normalized = normalize_hand(hand)
    first = map_card_canonical_to_actual(normalized[:CARD_LEN], mapping)
    second = map_card_canonical_to_actual(normalized[CARD_LEN:], mapping)
    return f"{first}{second}"


def map_range_dict_keys(
    range_dict: dict[str, float],
    mapping: FlopIsomorphismMapping,
    *,
    direction: str,
) -> dict[str, float]:
    if direction not in {"actual_to_canonical", "canonical_to_actual"}:
        raise ValueError(f"Unsupported mapping direction: {direction}")

    mapper = (
        map_hand_actual_to_canonical
        if direction == "actual_to_canonical"
        else map_hand_canonical_to_actual
    )
    mapped: dict[str, float] = {}
    for hand, value in range_dict.items():
        mapped[mapper(hand, mapping)] = value
    return mapped


def map_action_path_deal_cards(
    path_actions: Iterable[str],
    mapping: FlopIsomorphismMapping,
    *,
    direction: str,
) -> list[str]:
    if direction not in {"actual_to_canonical", "canonical_to_actual"}:
        raise ValueError(f"Unsupported mapping direction: {direction}")

    card_mapper = (
        map_card_actual_to_canonical
        if direction == "actual_to_canonical"
        else map_card_canonical_to_actual
    )

    mapped_actions: list[str] = []
    for step in path_actions:
        text = step.strip()
        upper = text.upper()
        if upper.startswith("DEAL:"):
            card = text.split(":", 1)[1].strip()
            mapped_actions.append(f"DEAL:{card_mapper(card, mapping)}")
        elif upper.startswith("DEAL "):
            card = text.split(None, 1)[1].strip()
            mapped_actions.append(f"DEAL {card_mapper(card, mapping)}")
        else:
            mapped_actions.append(text)
    return mapped_actions
