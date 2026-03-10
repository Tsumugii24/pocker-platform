from flask import Flask, request, jsonify
from flask_cors import CORS
import sys
from pathlib import Path

# Add gto directory to python path
current_dir = Path(__file__).parent
gto_dir = current_dir / "gto"
if gto_dir.exists() and str(gto_dir) not in sys.path:
    sys.path.insert(0, str(gto_dir))

app = Flask(__name__)
CORS(app)

# Global cache for the querier to avoid reloading the large Parquet file
import functools
import threading

@functools.lru_cache(maxsize=32)
def _get_parsed_config_data(config_path_str: str):
    from parse_solver_result import parse_config, _expand_range_to_hands
    config_data = parse_config(config_path_str)
    board_list = [c.strip() for c in (config_data.get('board', '')).split(',') if c.strip()]
    ip_range = _expand_range_to_hands(config_data.get('ip_range', {}), board_list)
    oop_range = _expand_range_to_hands(config_data.get('oop_range', {}), board_list)
    
    initial_pot = 5.0
    effective_stack = 100.0
    with open(config_path_str, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line.startswith('set_pot'): initial_pot = float(line.split()[1])
            if line.startswith('set_effective_stack'): effective_stack = float(line.split()[1])
            
    return config_data, ip_range, oop_range, initial_pot, effective_stack

_data_load_lock = threading.Lock()

@functools.lru_cache(maxsize=32)
def _get_loaded_game_data(data_file_str: str):
    from query_action_line import _load_data
    return _load_data(Path(data_file_str))

# Global set to track currently solving tasks to avoid redundant triggers
currently_solving = set()
import threading
solve_lock = threading.Lock()

def _infer_flop_board_from_path(data_path: Path) -> str:
    """从 parquet/json 文件名推断 flop 三张公共牌"""
    stem = data_path.stem
    ranks, suits = set("23456789TJQKAtjqka"), set("cdhs")
    cards = []
    i = 0
    while i < len(stem) - 1 and stem[i] in ranks and stem[i+1] in suits:
        cards.append(stem[i : i+2])
        i += 2
    if len(cards) >= 3:
        return ",".join(cards[:3])
    return ""

@app.route('/api/action', methods=['POST'])
def get_action():
    data = request.json
    
    board_str = data.get('board', '')
    action_path = data.get('path', [])
    ai_hand = data.get('hand', '')
    fe_eff_stack = data.get('effective_stack') # Optional from frontend for precision
    
    if not board_str:
        return jsonify({"error": "Missing initial board"}), 400
    if action_path is None:
        return jsonify({"error": "Missing action path"}), 400

    # Format the board string into standard flop file name, e.g. Ac,Ad,Ah -> AcAdAh
    flop_board = "".join(board_str.split(',')[:3])
    data_file = str(gto_dir / f"cache/{flop_board}.parquet")
    data_path = Path(data_file)

    # Parquet 不存在时尝试从 HuggingFace 自动下载
    if not data_path.exists():
        try:
            from download_from_hf import download_board_from_hf
            cache_dir = str(gto_dir / "cache")
            downloaded = download_board_from_hf(flop_board, cache_dir=cache_dir)
            if downloaded and downloaded.exists():
                data_file = str(downloaded)
                data_path = downloaded
                print(f"[API Info] 已从 HuggingFace 下载: {downloaded.name}")
            else:
                return jsonify({"error": f"Parquet 不存在且下载失败: {flop_board}"}), 404
        except ImportError:
            return jsonify({"error": f"Parquet 不存在: {flop_board}（需 pip install huggingface_hub 以支持自动下载）"}), 404

    try:
        from query_action_line import ActionLineQuery, _auto_detect_config, _load_data, _load_json_with_retry, _expand_range_to_hands
        from parse_solver_result import parse_config
        from interactive_strategy import (
            _match_action, _pick_hand_from_strategy, _get_probs_for_hand, 
            _get_ev_for_hand, filter_invalid_raise_actions, _sample_action_by_probs, 
            extract_amount_from_action, _export_turn_config_at_flop_end, 
            _export_river_config_at_turn_end
        )
        from run_solver import run_solver, SCRIPT_DIR
        
        config_path = _auto_detect_config(data_file)
        if not config_path:
            candidates = [
                gto_dir / f"solver/configs/{flop_board}.txt",
                gto_dir / f"configs/{flop_board}.txt",
                gto_dir / f"docs/flop_config.txt"
            ]
            for c in candidates:
                if c.exists():
                    config_path = str(c)
                    break
                    
        if not config_path:
            return jsonify({"error": "No config found for board"}), 404
            
        # Use LRU caching to handle parallel setups on different boards instantly
        config_info = _get_parsed_config_data(str(config_path))
        with _data_load_lock:
            cached_data = _get_loaded_game_data(str(data_file))

        querier = ActionLineQuery(data_file, config_path)
        querier.data = cached_data
        querier.data_path = Path(data_file)
        querier.config_path = Path(config_path)

        config_data, ip_rng, oop_rng, init_pot, eff_stack = config_info
        querier.initial_ranges = {
            'ip': ip_rng.copy(),
            'oop': oop_rng.copy()
        }
        querier.initial_pot = init_pot
        querier.effective_stack = eff_stack
        inferred = _infer_flop_board_from_path(Path(data_file))
        querier.board = inferred if inferred else ",".join(board_str.split(',')[:3])
        
        current_node = querier.data
        board_count = 3
        effective_call_amount = 0.0
        current_ip_range = querier.initial_ranges['ip'].copy()
        current_oop_range = querier.initial_ranges['oop'].copy()
        step_path_so_far = []
        resolved_actions = [] # List of (actual, matched)

        # Replay the path
        for step in action_path:
            node_type = current_node.get('node_type', '')
            ranges_info = current_node.get('ranges', {})
            if isinstance(ranges_info, dict):
                if ranges_info.get('ip_range'): current_ip_range = ranges_info['ip_range']
                if ranges_info.get('oop_range'): current_oop_range = ranges_info['oop_range']

            if node_type == 'action_node':
                actions = current_node.get('actions', [])
                if not actions: break
                tree_action = _match_action(step, actions)
                if not tree_action:
                    print(f"[API Error] Action '{step}' not in {actions}")
                    return jsonify({"error": f"Invalid action: {step}"}), 400
                
                resolved_actions.append((step, tree_action))
                if tree_action.upper().startswith(("BET", "RAISE", "DONK")):
                    amt = extract_amount_from_action(step)
                    effective_call_amount = amt if amt is not None else 0.0
                else:
                    effective_call_amount = 0.0
                current_node = current_node.get('childrens', {}).get(tree_action)
                
            elif node_type == 'chance_node':
                if not step.upper().startswith('DEAL:'): break
                card = step.split(':')[1].strip()
                dealcards = current_node.get('dealcards', {})
                if card not in dealcards: break
                
                resolved_actions.append((step, step))
                next_node = dealcards[card]
                
                # Check for street transitions
                is_flop_to_turn = board_count == 3 and len(step_path_so_far) > 0 and 'DEAL' not in "".join(step_path_so_far)
                is_turn_to_river = board_count == 4 and len(step_path_so_far) > 0 and "".join(step_path_so_far).count('DEAL') == 1

                if is_flop_to_turn and next_node and next_node.get('node_type') != 'terminal':
                    turn_ranges = next_node.get('ranges', {})
                    path_flop = [a for a in step_path_so_far if not a.upper().startswith('DEAL')]
                    res_cfg = _export_turn_config_at_flop_end(querier, path_flop, next_node, card, turn_ranges.get('oop_range') or current_oop_range, turn_ranges.get('ip_range') or current_ip_range)
                    if res_cfg:
                        cfg_p, dump_n = res_cfg
                        t_json = SCRIPT_DIR / "cache" / "results" / dump_n
                        
                        import time
                        wait_start = time.time()
                        waiting_logged = False
                        while not t_json.exists() and (time.time() - wait_start < 60):
                             with solve_lock:
                                 if not t_json.exists() and dump_n not in currently_solving:
                                     currently_solving.add(dump_n)
                                     should_start = True
                                 else:
                                     should_start = False
                             
                             if t_json.exists(): break
                             
                             if should_start:
                                 try:
                                     print(f"[API Info] STARTING solver for TURN: {dump_n}")
                                     run_solver(str(Path(cfg_p).resolve()), output_dir=str(SCRIPT_DIR / "cache" / "results"))
                                 finally:
                                     with solve_lock: currently_solving.discard(dump_n)
                                 break
                             else:
                                 if not waiting_logged:
                                     print(f"[API Info] Waiting for ongoing TURN solver ({dump_n})...")
                                     waiting_logged = True
                                 time.sleep(1)

                        if t_json.exists():
                            turn_data = _load_json_with_retry(t_json)
                            if not turn_data: break
                            querier.data = turn_data
                            querier.data_path = Path(t_json)
                            querier.config_path = Path(cfg_p)
                            cfg = parse_config(str(cfg_p))
                            querier.board = cfg.get('board', '')
                            with open(str(cfg_p), 'r', encoding='utf-8') as f:
                                for line in f:
                                    line = line.strip()
                                    if line.startswith('set_pot'): querier.initial_pot = float(line.split()[1])
                                    elif line.startswith('set_effective_stack'): querier.effective_stack = float(line.split()[1])
                            board_count = 4
                            next_node = turn_data

                elif is_turn_to_river and (not next_node or next_node.get('node_type') != 'terminal'):
                    # next_node 可能为 None（turn 树未展开该 river 牌），用 current range 跑 river solver
                    river_ranges = (next_node or {}).get('ranges', {})
                    path_turn = step_path_so_far
                    river_node = next_node or {"node_type": "action_node", "ranges": {"oop_range": current_oop_range, "ip_range": current_ip_range}}
                    res_cfg = _export_river_config_at_turn_end(querier, path_turn, river_node, card, river_ranges.get('oop_range') or current_oop_range, river_ranges.get('ip_range') or current_ip_range)
                    if res_cfg:
                        cfg_p, dump_n = res_cfg
                        r_json = SCRIPT_DIR / "cache" / "results" / dump_n
                        
                        import time
                        wait_start = time.time()
                        waiting_logged = False
                        while not r_json.exists() and (time.time() - wait_start < 60):
                             with solve_lock:
                                 if not r_json.exists() and dump_n not in currently_solving:
                                     currently_solving.add(dump_n)
                                     should_start = True
                                 else:
                                     should_start = False
                             
                             if r_json.exists(): break
                             
                             if should_start:
                                 try:
                                     print(f"[API Info] STARTING solver for RIVER: {dump_n}")
                                     run_solver(str(Path(cfg_p).resolve()), output_dir=str(SCRIPT_DIR / "cache" / "results"))
                                 finally:
                                     with solve_lock: currently_solving.discard(dump_n)
                                 break
                             else:
                                 if not waiting_logged:
                                     print(f"[API Info] Waiting for ongoing RIVER solver ({dump_n})...")
                                     waiting_logged = True
                                 time.sleep(1)

                        if r_json.exists():
                            river_data = _load_json_with_retry(r_json)
                            if not river_data: break
                            querier.data = river_data
                            querier.data_path = Path(r_json)
                            querier.config_path = Path(cfg_p)
                            cfg = parse_config(str(cfg_p))
                            querier.board = cfg.get('board', '')
                            with open(str(cfg_p), 'r', encoding='utf-8') as f:
                                for line in f:
                                    line = line.strip()
                                    if line.startswith('set_pot'): querier.initial_pot = float(line.split()[1])
                                    elif line.startswith('set_effective_stack'): querier.effective_stack = float(line.split()[1])
                            board_count = 5
                            next_node = river_data

                current_node = next_node
                effective_call_amount = 0.0

            step_path_so_far.append(step)
            if not current_node: break

        # Calculate final stack for capping and logging
        from interactive_strategy import _get_path_and_initial_for_pot, _calc_street_state
        q_path_state, q_init_pot = _get_path_and_initial_for_pot(
            step_path_so_far, board_count, querier.initial_pot, querier.effective_stack
        )
        pot, oop_added, ip_added = _calc_street_state(q_path_state, q_init_pot)
        calc_remaining_stack = max(0.0, querier.effective_stack - max(oop_added, ip_added))
        final_remaining_stack = float(fe_eff_stack) if fe_eff_stack is not None else calc_remaining_stack

        # Prepare path strings for logging
        actual_path_str = "ROOT -> " + (" -> ".join([a[0] for a in resolved_actions]) if resolved_actions else "(empty)")
        query_parts = []
        for actual, matched in resolved_actions:
            if actual == matched or actual.upper().startswith('DEAL'):
                query_parts.append(matched)
            else:
                query_parts.append(f"[{matched}]")
        query_path_str = "ROOT -> " + (" -> ".join(query_parts) if query_parts else "(empty)")

        # 与 interactive_strategy 一致：最后一步为 action 且导致无子节点 = 到达叶子（对局结束）
        if not current_node:
            last_actual = resolved_actions[-1][0] if resolved_actions else ""
            if resolved_actions and not last_actual.upper().startswith("DEAL"):
                # 最后一步是 action（如 CALL）导致无子节点，视为正常对局结束
                print("\n" + "=" * 60)
                print(f"Actual Path: {actual_path_str}")
                print(f"Query Path:  {query_path_str}")
                print(f"Remaining:   {final_remaining_stack:.2f} BB")
                print("=" * 60)
                print("[API Debug] 对局结束 (Leaf). Returning success.")
                return jsonify({
                    "status": "complete",
                    "node_type": "terminal",
                    "leaf": True,
                    "reason": "no further child node",
                    "pre_solve": True
                }), 200
            print(f"[API Error] Replay failed: Final node is None.")
            return jsonify({"error": "Path replay reached a missing node"}), 404

        node_type = current_node.get('node_type', '')
        if node_type != 'action_node' or not ai_hand:
            print("\n" + "=" * 60)
            print(f"Actual Path: {actual_path_str}")
            print(f"Query Path:  {query_path_str}")
            print(f"Remaining:   {final_remaining_stack:.2f} BB")
            print("=" * 60)
            reason = "Terminal/Chance node" if node_type != 'action_node' else "Pre-solve request (no hand)"
            print(f"[API Debug] {reason}. Returning success.")
            return jsonify({"status": "complete", "node_type": node_type, "pre_solve": True}), 200

        # Run AI Decision Logic
        actions = current_node.get('actions', [])
        strategy_dict = current_node.get('strategy', {}).get('strategy', {})
        evs_dict = current_node.get('evs', {}).get('evs', {})

        if not actions or not strategy_dict:
            return jsonify({"action": "check"}), 200
            
        probs = _get_probs_for_hand(ai_hand, strategy_dict, actions)
        hand_ev_dict = _get_ev_for_hand(ai_hand, evs_dict, actions) or {}
        
        if not probs or len(actions) != len(probs):
            import random
            if strategy_dict:
                proxy_hand = random.choice(list(strategy_dict.keys()))
                probs = _get_probs_for_hand(proxy_hand, strategy_dict, actions)
                hand_ev_dict = _get_ev_for_hand(proxy_hand, evs_dict, actions) or {}
            if not probs or len(actions) != len(probs):
                return jsonify({"action": "check"}), 200
            
        # Filter invalid raises
        if effective_call_amount > 0:
            actions_f, probs_f, ev_dict_f = filter_invalid_raise_actions(actions, probs, effective_call_amount, hand_ev_dict)
            if actions_f: 
                actions = actions_f
                probs = probs_f
                if ev_dict_f:
                    hand_ev_dict = ev_dict_f

        # Apply MDF logic if enabled from frontend
        use_mdf = data.get('use_mdf', False)
        mdf_triggered = False

        if use_mdf and board_count == 3 and effective_call_amount > 0 and step_path_so_far:
            prev_act = step_path_so_far[-1].upper()
            is_bet = prev_act.startswith("BET") or prev_act.startswith("DONK")
            is_raise = prev_act.startswith("RAISE")
            
            if is_bet or is_raise:
                pot_before = pot - effective_call_amount
                if pot_before > 0:
                    proportion = effective_call_amount / pot_before
                    # 专业 MDF 公式: 目标防守频率 = 下注前Pot / (下注前Pot + 下注/加注额) = pot_before / pot
                    
                    has_mdf_condition = False
                    if is_bet and proportion > 0.66:
                        has_mdf_condition = True
                    elif is_raise and proportion > 1.33:
                        has_mdf_condition = True
                    
                    if has_mdf_condition:
                        mdf = pot_before / pot
                        
                        fold_action = next((a for a in actions if a.upper() == 'FOLD'), None)
                        fold_ev = hand_ev_dict.get(fold_action, 0.0) if fold_action else 0.0
                        adjusted_evs = {a: v - fold_ev for a, v in hand_ev_dict.items()}
                        
                        call_action = next((a for a in actions if a.upper() == 'CALL'), None)
                        if not call_action:
                            call_action = next((a for a in actions if a.upper() not in ['FOLD'] and not a.upper().startswith(('BET', 'RAISE', 'DONK'))), None)
                        
                        if call_action and fold_action:
                            max_defend_ev = max([v for a, v in adjusted_evs.items() if a != fold_action], default=0.0)
                            threshold = pot_before * mdf 
                            
                            print("\n" + "=" * 40)
                            print("[API] --- MDF 防守流程开始 ---")
                            print(f"[API] 触发条件: 面临 {'Bet' if is_bet else 'Raise'} (下注金额 {effective_call_amount:.0f} / 下注前底池 {pot_before:.0f} = {proportion:.2f})")
                            print(f"[API] 根据公式计算 MDF: {pot_before:.0f} / ({pot_before:.0f} + {effective_call_amount:.0f}) = {mdf:.3f}")
                            print(f"[API] 原始 Fold EV: {fold_ev:.3f}")
                            print("调整后各动作 EV (基准 Fold EV=0):")
                            for a in actions:
                                print(f"  {a}: {adjusted_evs.get(a, 0.0):.3f}")
                            print(f"\n[API] 评价防守: 下注前 Pot = {pot_before:.0f}")
                            print(f"[API] 防守阈值 (Pot(前) * MDF): {pot_before:.0f} * {mdf:.3f} = {threshold:.3f}")
                            
                            if max_defend_ev >= threshold:
                                action_chosen = call_action
                                print(f"[API] 判断结果: 存在防守 EV ({max_defend_ev:.3f}) >= 阈值，选择 {action_chosen}!")
                            else:
                                action_chosen = fold_action
                                print(f"[API] 判断结果: 防守 EV ({max_defend_ev:.3f}) < 阈值，放弃防守，选择 {action_chosen}!")
                            print("[API] --- MDF 防守流程结束 ---")
                            print("=" * 40)
                            mdf_triggered = True

        if not mdf_triggered:
            action_chosen = _sample_action_by_probs(actions, probs)
        
        # Sanity cap AI action
        if action_chosen.upper().startswith(("BET", "RAISE", "DONK")):
            chosen_amt = extract_amount_from_action(action_chosen)
            if chosen_amt is not None and chosen_amt > final_remaining_stack:
                new_action = f"{action_chosen.split()[0]} {final_remaining_stack:.2f}"
                print(f"[Sanity Cap] AI chose {action_chosen} but stack is {final_remaining_stack:.2f}. Adjusting to {new_action}")
                action_chosen = new_action

        # Final Log Output (Full Path including AI decision)
        print("\n" + "=" * 60)
        actual_path_full = f"{actual_path_str} -> {action_chosen}"
        query_path_full = f"{query_path_str} -> {action_chosen}"
        
        print(f"Actual Path: {actual_path_full}")
        print(f"Query Path:  {query_path_full}")
        print(f"Remaining:   {final_remaining_stack:.2f} BB")
        print("=" * 60)
        
        print(f"Hand: {ai_hand} | Available: {actions}")
        print("\nStrategy:")
        for act, p in zip(actions, probs):
            bar = '#' * int(p * 20)
            print(f"  {act:<25} {p:>6.1%}  {bar}")

        chosen_prob = next((p for a, p in zip(actions, probs) if a == action_chosen), 0)
        print(f"\nAI Output: {action_chosen} ({chosen_prob:.1%} probability)")
        
        return jsonify({
            "action": action_chosen,
            "strategy": dict(zip(actions, probs))
        }), 200
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

import functools
@functools.lru_cache(maxsize=1)
def _get_solved_boards_from_hf():
    import os
    try:
        from huggingface_hub import HfApi
        api = HfApi()
        files = api.list_repo_files(repo_id="Tsumugii/gto-srp-100bb-v1", repo_type="dataset")
        boards = [f.split('.')[0] for f in files if f.endswith('.parquet')]
        return boards
    except Exception as e:
        print("[API Error] huggingface.co failed to fetch boards:", e, ". Trying HF-Mirror...")
        try:
            from huggingface_hub import HfApi
            os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"
            api = HfApi(endpoint="https://hf-mirror.com")
            files = api.list_repo_files(repo_id="Tsumugii/gto-srp-100bb-v1", repo_type="dataset")
            boards = [f.split('.')[0] for f in files if f.endswith('.parquet')]
            return boards
        except Exception as e2:
            print("[API Error] hf-mirror.com also failed:", e2)
            return []

@app.route('/api/solved-boards', methods=['GET'])
def get_solved_boards():
    boards = _get_solved_boards_from_hf()
    return jsonify({"boards": boards}), 200

@app.route('/api/test-hf-connection', methods=['GET'])
def test_hf_connection():
    import time
    import requests
    results = {}
    
    start = time.time()
    try:
        requests.get("https://huggingface.co/api/datasets/Tsumugii/gto-srp-100bb-v1", timeout=3)
        results['huggingface'] = {'status': 'ok', 'latency_ms': int((time.time() - start) * 1000)}
    except Exception as e:
        results['huggingface'] = {'status': 'failed', 'error': str(e)}
        
    start = time.time()
    try:
        requests.get("https://hf-mirror.com/api/datasets/Tsumugii/gto-srp-100bb-v1", timeout=3)
        results['hf_mirror'] = {'status': 'ok', 'latency_ms': int((time.time() - start) * 1000)}
    except Exception as e:
        results['hf_mirror'] = {'status': 'failed', 'error': str(e)}
        
    return jsonify(results), 200

if __name__ == '__main__':
    app.run(port=5000, debug=True)
