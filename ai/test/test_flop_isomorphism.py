from __future__ import annotations

import sys
import tempfile
import unittest
from itertools import combinations
from pathlib import Path
from unittest.mock import patch


AI_DIR = Path(__file__).parent.parent
GTO_DIR = AI_DIR / "gto"
if str(AI_DIR) not in sys.path:
    sys.path.insert(0, str(AI_DIR))
if str(GTO_DIR) not in sys.path:
    sys.path.insert(0, str(GTO_DIR))

import app as ai_app
import query_action_line
from flop_isomorphism import (
    load_canonical_flop_count,
    map_action_path_deal_cards,
    map_card_actual_to_canonical,
    map_hand_actual_to_canonical,
    map_hand_canonical_to_actual,
    solve_flop_isomorphism,
)
from interactive_strategy import (
    _export_river_config_at_turn_end,
    _export_turn_config_at_flop_end,
)


class FakeActionLineQuery:
    def __init__(self, data_path: str, config_path: str | None = None):
        self.data_path = Path(data_path)
        self.config_path = Path(config_path) if config_path else None
        self.data = None
        self.initial_ranges = {"ip": {}, "oop": {}}
        self.board = ""
        self.actual_board = ""
        self.flop_isomorphism = None
        self.uses_isomorphic_flop_tree = False
        self.initial_pot = 5.0
        self.effective_stack = 100.0


class FlopIsomorphismTests(unittest.TestCase):
    def test_cards_txt_has_expected_canonical_flop_count(self) -> None:
        self.assertEqual(load_canonical_flop_count(), 1755)

    def test_all_flops_map_to_exactly_one_canonical_board(self) -> None:
        ranks = "23456789TJQKA"
        suits = "cdhs"
        cards = [f"{rank}{suit}" for rank in ranks for suit in suits]

        mapped = set()
        for flop in combinations(cards, 3):
            mapping = solve_flop_isomorphism(flop)
            mapped.add(mapping.canonical_flop)

        self.assertEqual(len(mapped), 1755)

    def test_hand_and_deal_cards_roundtrip_through_mapping(self) -> None:
        mapping = solve_flop_isomorphism(("Ah", "As", "Ks"))
        actual_hand = "QhJd"

        canonical_hand = map_hand_actual_to_canonical(actual_hand, mapping)
        roundtrip_hand = map_hand_canonical_to_actual(canonical_hand, mapping)

        self.assertEqual(roundtrip_hand, actual_hand)
        self.assertEqual(
            map_action_path_deal_cards(
                ["CHECK", "DEAL:Qh", "BET 5"],
                mapping,
                direction="actual_to_canonical",
            ),
            ["CHECK", f"DEAL:{map_card_actual_to_canonical('Qh', mapping)}", "BET 5"],
        )

    def test_api_action_accepts_non_canonical_flop_and_returns_actual_hand(self) -> None:
        actual_flop = ("Ah", "As", "Ks")
        mapping = solve_flop_isomorphism(actual_flop)
        actual_hand = map_hand_canonical_to_actual("QcJd", mapping)
        canonical_board = mapping.canonical_flop

        fake_tree = {
            "node_type": "action_node",
            "player": 1,
            "actions": ["CHECK"],
            "strategy": {
                "strategy": {
                    "QcJd": [1.0],
                }
            },
            "evs": {"evs": {"QcJd": [0.25]}},
            "ranges": {
                "ip_range": {"QcJd": 1.0},
                "oop_range": {},
            },
        }

        with tempfile.TemporaryDirectory() as tmp_dir:
            cache_dir = Path(tmp_dir)
            (cache_dir / f"{canonical_board}.parquet").write_text("", encoding="utf-8")

            with (
                patch.object(ai_app, "_get_dataset_cache_dir", return_value=cache_dir),
                patch.object(ai_app, "_get_legacy_dataset_cache_dir", return_value=cache_dir),
                patch.object(ai_app, "_get_loaded_game_data", return_value=fake_tree),
                patch.object(
                    ai_app,
                    "_get_parsed_config_data",
                    return_value=(
                        {"board": ",".join(mapping.canonical_ordered_flop_cards)},
                        {"QcJd": 1.0},
                        {},
                        5.0,
                        100.0,
                    ),
                ),
                patch.object(ai_app, "_resolve_config_path", return_value="dummy_config.txt"),
                patch.object(query_action_line, "ActionLineQuery", FakeActionLineQuery),
            ):
                client = ai_app.app.test_client()
                response = client.post(
                    "/api/action",
                    json={
                        "board": ",".join(actual_flop),
                        "path": [],
                        "hand": actual_hand,
                    },
                )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["action"], "CHECK")
        self.assertEqual(payload["decision_source"], "gto_exact")
        self.assertEqual(payload["strategy_hand_used"], actual_hand)
        self.assertEqual(payload["strategy"], {"CHECK": 1.0})

    def test_gto_baseline_query_can_return_distribution_without_sampling(self) -> None:
        actual_flop = ("Ah", "As", "Ks")
        mapping = solve_flop_isomorphism(actual_flop)
        actual_hand = map_hand_canonical_to_actual("QcJd", mapping)
        canonical_board = mapping.canonical_flop

        fake_tree = {
            "node_type": "action_node",
            "player": 1,
            "actions": ["CHECK", "BET 5"],
            "strategy": {
                "strategy": {
                    "QcJd": [0.25, 0.75],
                }
            },
            "evs": {"evs": {"QcJd": [0.1, 0.6]}},
            "ranges": {
                "ip_range": {"QcJd": 1.0},
                "oop_range": {},
            },
        }

        with tempfile.TemporaryDirectory() as tmp_dir:
            cache_dir = Path(tmp_dir)
            (cache_dir / f"{canonical_board}.parquet").write_text("", encoding="utf-8")

            with (
                patch.object(ai_app, "_get_dataset_cache_dir", return_value=cache_dir),
                patch.object(ai_app, "_get_legacy_dataset_cache_dir", return_value=cache_dir),
                patch.object(ai_app, "_get_loaded_game_data", return_value=fake_tree),
                patch.object(
                    ai_app,
                    "_get_parsed_config_data",
                    return_value=(
                        {"board": ",".join(mapping.canonical_ordered_flop_cards)},
                        {"QcJd": 1.0},
                        {},
                        5.0,
                        100.0,
                    ),
                ),
                patch.object(ai_app, "_resolve_config_path", return_value="dummy_config.txt"),
                patch.object(query_action_line, "ActionLineQuery", FakeActionLineQuery),
            ):
                client = ai_app.app.test_client()
                response = client.post(
                    "/api/v1/gto-baseline/query",
                    json={
                        "board": ",".join(actual_flop),
                        "path": [],
                        "hand": actual_hand,
                        "sample": False,
                    },
                )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["baseline_available"], True)
        self.assertEqual(payload["sampled_action"], None)
        self.assertEqual(payload["actions"], ["CHECK", "BET 5"])
        self.assertEqual(payload["strategy"], {"CHECK": 0.25, "BET 5": 0.75})
        self.assertEqual(payload["evs"], {"CHECK": 0.1, "BET 5": 0.6})
        self.assertEqual(payload["decision_source"], "gto_exact")
        self.assertEqual(payload["strategy_hand_used"], actual_hand)
        self.assertEqual(payload["actual_path"], "ROOT -> (empty)")
        self.assertEqual(payload["query_path"], "ROOT -> (empty)")

    def test_gto_baseline_query_rejects_missing_api_key_when_configured(self) -> None:
        with patch.dict(ai_app.os.environ, {"GTO_BASELINE_API_KEYS": "public-test-key"}):
            client = ai_app.app.test_client()
            response = client.post(
                "/api/v1/gto-baseline/query",
                json={
                    "board": "Ah,As,Ks",
                    "path": [],
                    "hand": "QcJd",
                },
            )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["error"], "Unauthorized")

    def test_turn_and_river_config_exports_use_actual_board_and_ranges(self) -> None:
        class DummyQuerier:
            def __init__(self, board: str, actual_board: str):
                self.board = board
                self.actual_board = actual_board
                self.initial_pot = 5.0
                self.effective_stack = 100.0

        flop_querier = DummyQuerier("Ac,Ad,Kh", "Ah,As,Ks")
        turn_querier = DummyQuerier("Ac,Ad,Kh,Qc", "Ah,As,Ks,Qh")

        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir = Path(tmp_dir)

            turn_result = _export_turn_config_at_flop_end(
                flop_querier,
                ["CHECK", "CHECK"],
                {"node_type": "action_node"},
                "Jd",
                {"QhJc": 1.0},
                {"Td9h": 1.0},
                output_dir=output_dir,
            )
            self.assertIsNotNone(turn_result)
            turn_config_path, _ = turn_result
            turn_text = turn_config_path.read_text(encoding="utf-8")
            self.assertIn("set_board Ah,As,Ks,Jd", turn_text)
            self.assertIn("QhJc", turn_text)
            self.assertIn("Td9h", turn_text)
            self.assertNotIn("set_board Ac,Ad,Kh,Jd", turn_text)

            river_result = _export_river_config_at_turn_end(
                turn_querier,
                ["CHECK", "CHECK", "DEAL:Qh", "CHECK", "CHECK"],
                {"node_type": "action_node"},
                "Tc",
                {"QhJc": 1.0},
                {"Td9h": 1.0},
                output_dir=output_dir,
            )
            self.assertIsNotNone(river_result)
            river_config_path, _ = river_result
            river_text = river_config_path.read_text(encoding="utf-8")
            self.assertIn("set_board Ah,As,Ks,Qh,Tc", river_text)
            self.assertIn("QhJc", river_text)
            self.assertIn("Td9h", river_text)
            self.assertNotIn("set_board Ac,Ad,Kh,Qc,Tc", river_text)


if __name__ == "__main__":
    unittest.main()
