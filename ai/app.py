import base64
import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import time
import traceback
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen

from flask import Flask, Response, jsonify, request, stream_with_context
from flask_cors import CORS
import functools
import itertools
import sys
import threading
from pathlib import Path


current_dir = Path(__file__).parent
gto_dir = current_dir / "gto"
if gto_dir.exists() and str(gto_dir) not in sys.path:
    sys.path.insert(0, str(gto_dir))

from flop_isomorphism import (
    FlopIsomorphismMapping,
    ensure_unique_cards,
    hand_conflicts_with_board,
    map_action_path_deal_cards,
    map_card_actual_to_canonical,
    map_hand_actual_to_canonical,
    map_hand_canonical_to_actual,
    map_range_dict_keys,
    normalize_board_cards,
    solve_flop_isomorphism,
)

app = Flask(__name__)
CORS(app)


@functools.lru_cache(maxsize=32)
def _get_parsed_config_data(config_path_str: str):
    from parse_solver_result import parse_config, _expand_range_to_hands

    config_data = parse_config(config_path_str)
    board_list = [card.strip() for card in config_data.get("board", "").split(",") if card.strip()]
    ip_range = _expand_range_to_hands(config_data.get("ip_range", {}), board_list)
    oop_range = _expand_range_to_hands(config_data.get("oop_range", {}), board_list)

    initial_pot = 5.0
    effective_stack = 100.0
    with open(config_path_str, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line.startswith("set_pot"):
                initial_pot = float(line.split()[1])
            elif line.startswith("set_effective_stack"):
                effective_stack = float(line.split()[1])

    return config_data, ip_range, oop_range, initial_pot, effective_stack


_data_load_lock = threading.Lock()


@functools.lru_cache(maxsize=32)
def _get_loaded_game_data(data_file_str: str):
    from query_action_line import _load_data

    return _load_data(Path(data_file_str))


currently_solving = set()
solve_lock = threading.Lock()

CHATGPT_OAUTH_MODELS = "gpt-5.5,gpt-5.4"
CHATGPT_OAUTH_PROXY_PORT = 10531
CHATGPT_OAUTH_PROXY_BASE_URL = f"http://127.0.0.1:{CHATGPT_OAUTH_PROXY_PORT}/v1"
CHATGPT_OAUTH_CALLBACK_HOST = os.getenv("CHATGPT_OAUTH_CALLBACK_HOST", "127.0.0.1")
CHATGPT_OAUTH_CALLBACK_PORT = int(os.getenv("CHATGPT_OAUTH_CALLBACK_PORT", "1455"))
CHATGPT_OAUTH_REDIRECT_URI = f"http://localhost:{CHATGPT_OAUTH_CALLBACK_PORT}/auth/callback"
CHATGPT_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
CHATGPT_OAUTH_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize"
CHATGPT_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token"
CHATGPT_OAUTH_SCOPE = "openid profile email offline_access"
CHATGPT_OAUTH_JWT_CLAIM_PATH = "https://api.openai.com/auth"
CHATGPT_OAUTH_LOCK = threading.Lock()
CHATGPT_OAUTH_STATE: dict = {
    "login_process": None,
    "login_url": None,
    "login_code": None,
    "login_mode": "pkce",
    "login_verifier": None,
    "login_state": None,
    "callback_code": None,
    "callback_error": None,
    "callback_server": None,
    "login_output": [],
    "proxy_process": None,
    "proxy_output": [],
}


def _resolve_executable(name: str) -> str:
    return shutil.which(f"{name}.cmd") or shutil.which(name) or name


def _subprocess_creation_flags() -> int:
    if os.name == "nt":
        return getattr(subprocess, "CREATE_NO_WINDOW", 0)
    return 0


def _append_process_output(output_key: str, line: str) -> None:
    with CHATGPT_OAUTH_LOCK:
        output = CHATGPT_OAUTH_STATE.setdefault(output_key, [])
        output.append(line.rstrip())
        del output[:-120]


def _watch_chatgpt_oauth_process(process: subprocess.Popen, output_key: str) -> None:
    try:
        if process.stdout is None:
            return
        for line in process.stdout:
            _append_process_output(output_key, line)
    finally:
        try:
            process.wait(timeout=1)
        except Exception:
            pass


def _start_process(command: list[str], output_key: str) -> subprocess.Popen:
    process = subprocess.Popen(
        command,
        cwd=str(current_dir.parent),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=_subprocess_creation_flags(),
    )
    watcher = threading.Thread(
        target=_watch_chatgpt_oauth_process,
        args=(process, output_key),
        daemon=True,
    )
    watcher.start()
    return process


def _chatgpt_oauth_auth_paths() -> list[Path]:
    home = Path.home()
    paths: list[Path] = []
    for env_name in ("CHATGPT_LOCAL_HOME", "CODEX_HOME"):
        env_value = os.getenv(env_name)
        if env_value:
            paths.append(Path(env_value) / "auth.json")
    paths.extend(
        [
            home / ".chatgpt-local" / "auth.json",
            home / ".codex" / "auth.json",
        ]
    )
    return paths


def _has_chatgpt_oauth_auth_file() -> bool:
    for auth_path in _chatgpt_oauth_auth_paths():
        if auth_path.exists() and auth_path.is_file():
            try:
                return auth_path.stat().st_size > 0
            except OSError:
                return True
    return False


def _is_process_running(process: subprocess.Popen | None) -> bool:
    return process is not None and process.poll() is None


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _generate_pkce() -> tuple[str, str]:
    verifier = _b64url(secrets.token_bytes(32))
    challenge = _b64url(hashlib.sha256(verifier.encode("ascii")).digest())
    return verifier, challenge


def _decode_jwt_payload(token: str) -> dict:
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return {}
        payload = parts[1]
        payload += "=" * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload.encode("ascii")).decode("utf-8"))
    except Exception:
        return {}


def _extract_chatgpt_account_id(access_token: str) -> str | None:
    payload = _decode_jwt_payload(access_token)
    auth_claim = payload.get(CHATGPT_OAUTH_JWT_CLAIM_PATH)
    if not isinstance(auth_claim, dict):
        return None
    account_id = auth_claim.get("chatgpt_account_id")
    return account_id if isinstance(account_id, str) and account_id else None


def _parse_authorization_input(value: str) -> tuple[str | None, str | None]:
    raw_value = (value or "").strip()
    if not raw_value:
        return None, None

    try:
        parsed = urlparse(raw_value)
        if parsed.query:
            params = parse_qs(parsed.query)
            return params.get("code", [None])[0], params.get("state", [None])[0]
    except Exception:
        pass

    if "#" in raw_value and "code=" not in raw_value:
        code, state = raw_value.split("#", 1)
        return code.strip() or None, state.strip() or None

    if "code=" in raw_value:
        params = parse_qs(raw_value)
        return params.get("code", [None])[0], params.get("state", [None])[0]

    return raw_value, None


def _write_chatgpt_oauth_auth(tokens: dict) -> None:
    access_token = tokens.get("access_token")
    refresh_token = tokens.get("refresh_token")
    id_token = tokens.get("id_token")
    if not access_token or not refresh_token:
        raise RuntimeError("Token response did not include access_token and refresh_token.")

    account_id = _extract_chatgpt_account_id(access_token)
    if not account_id:
        raise RuntimeError("Could not extract ChatGPT account id from the access token.")

    auth_path = _chatgpt_oauth_auth_paths()[0]
    auth_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "auth_mode": "chatgpt",
        "OPENAI_API_KEY": None,
        "tokens": {
            "id_token": id_token,
            "access_token": access_token,
            "refresh_token": refresh_token,
            "account_id": account_id,
        },
        "last_refresh": datetime.now(timezone.utc).isoformat(),
    }
    with open(auth_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)


def _exchange_chatgpt_oauth_code(code: str, verifier: str) -> None:
    body = urlencode(
        {
            "grant_type": "authorization_code",
            "client_id": CHATGPT_OAUTH_CLIENT_ID,
            "code": code,
            "code_verifier": verifier,
            "redirect_uri": CHATGPT_OAUTH_REDIRECT_URI,
        }
    ).encode("utf-8")
    request = Request(
        CHATGPT_OAUTH_TOKEN_URL,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=20) as response:
            tokens = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise RuntimeError(f"Token exchange failed: {exc}") from exc

    _write_chatgpt_oauth_auth(tokens)


def _close_chatgpt_oauth_callback_server() -> None:
    with CHATGPT_OAUTH_LOCK:
        server = CHATGPT_OAUTH_STATE.get("callback_server")
        CHATGPT_OAUTH_STATE["callback_server"] = None
    if server is not None:
        try:
            server.shutdown()
            server.server_close()
        except Exception:
            pass


def _start_chatgpt_oauth_callback_server(expected_state: str) -> bool:
    _close_chatgpt_oauth_callback_server()

    class CallbackHandler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args) -> None:
            return

        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            if parsed.path != "/auth/callback":
                self.send_response(404)
                self.end_headers()
                self.wfile.write(b"Not found")
                return

            params = parse_qs(parsed.query)
            state = params.get("state", [None])[0]
            code = params.get("code", [None])[0]
            if state != expected_state:
                with CHATGPT_OAUTH_LOCK:
                    CHATGPT_OAUTH_STATE["callback_error"] = "State mismatch."
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b"State mismatch. You can close this page and retry login.")
                return
            if not code:
                with CHATGPT_OAUTH_LOCK:
                    CHATGPT_OAUTH_STATE["callback_error"] = "Missing authorization code."
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b"Missing authorization code. You can close this page and retry login.")
                return

            with CHATGPT_OAUTH_LOCK:
                CHATGPT_OAUTH_STATE["callback_code"] = code
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"<html><body>ChatGPT OAuth completed. You can close this window.</body></html>")

    try:
        server = HTTPServer((CHATGPT_OAUTH_CALLBACK_HOST, CHATGPT_OAUTH_CALLBACK_PORT), CallbackHandler)
    except OSError as exc:
        with CHATGPT_OAUTH_LOCK:
            CHATGPT_OAUTH_STATE["callback_error"] = (
                f"Could not bind {CHATGPT_OAUTH_CALLBACK_HOST}:{CHATGPT_OAUTH_CALLBACK_PORT}; "
                "manual paste is required."
            )
            CHATGPT_OAUTH_STATE["login_output"] = [str(exc)]
        return False

    with CHATGPT_OAUTH_LOCK:
        CHATGPT_OAUTH_STATE["callback_server"] = server
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return True


def _build_chatgpt_oauth_authorize_url() -> str:
    verifier, challenge = _generate_pkce()
    state = secrets.token_urlsafe(24)
    params = {
        "response_type": "code",
        "client_id": CHATGPT_OAUTH_CLIENT_ID,
        "redirect_uri": CHATGPT_OAUTH_REDIRECT_URI,
        "scope": CHATGPT_OAUTH_SCOPE,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": state,
        "id_token_add_organizations": "true",
        "codex_cli_simplified_flow": "true",
        "originator": "openclaw_compatible",
    }
    auth_url = f"{CHATGPT_OAUTH_AUTHORIZE_URL}?{urlencode(params)}"
    with CHATGPT_OAUTH_LOCK:
        CHATGPT_OAUTH_STATE["login_url"] = auth_url
        CHATGPT_OAUTH_STATE["login_code"] = None
        CHATGPT_OAUTH_STATE["login_mode"] = "pkce"
        CHATGPT_OAUTH_STATE["login_verifier"] = verifier
        CHATGPT_OAUTH_STATE["login_state"] = state
        CHATGPT_OAUTH_STATE["callback_code"] = None
        CHATGPT_OAUTH_STATE["callback_error"] = None
        CHATGPT_OAUTH_STATE["login_output"] = [
            "Open the authorization URL, then either let the local callback complete or paste the final redirect URL/code."
        ]
    _start_chatgpt_oauth_callback_server(state)
    return auth_url


def _complete_chatgpt_oauth_login(authorization_input: str | None = None) -> dict:
    with CHATGPT_OAUTH_LOCK:
        verifier = CHATGPT_OAUTH_STATE.get("login_verifier")
        expected_state = CHATGPT_OAUTH_STATE.get("login_state")
        callback_code = CHATGPT_OAUTH_STATE.get("callback_code")

    if not verifier:
        raise RuntimeError("No pending ChatGPT OAuth login flow. Click Login first.")

    code, state = _parse_authorization_input(authorization_input or "")
    if not code:
        code = callback_code
    if state and state != expected_state:
        raise RuntimeError("State mismatch. Start a new ChatGPT OAuth login.")
    if not code:
        raise RuntimeError("No authorization code was provided yet.")

    _exchange_chatgpt_oauth_code(code, verifier)
    _close_chatgpt_oauth_callback_server()
    with CHATGPT_OAUTH_LOCK:
        CHATGPT_OAUTH_STATE["login_verifier"] = None
        CHATGPT_OAUTH_STATE["login_state"] = None
        CHATGPT_OAUTH_STATE["callback_code"] = None
        CHATGPT_OAUTH_STATE["callback_error"] = None
        CHATGPT_OAUTH_STATE["login_output"] = ["ChatGPT OAuth login completed."]
    return _get_chatgpt_oauth_status()


def _is_chatgpt_oauth_proxy_running() -> bool:
    import urllib.request

    try:
        with urllib.request.urlopen(
            f"{CHATGPT_OAUTH_PROXY_BASE_URL}/models",
            timeout=1.5,
        ) as response:
            return 200 <= response.status < 500
    except Exception:
        return False


def _get_chatgpt_oauth_status() -> dict:
    with CHATGPT_OAUTH_LOCK:
        login_process = CHATGPT_OAUTH_STATE.get("login_process")
        proxy_process = CHATGPT_OAUTH_STATE.get("proxy_process")
        login_url = CHATGPT_OAUTH_STATE.get("login_url")
        login_code = CHATGPT_OAUTH_STATE.get("login_code")
        login_mode = CHATGPT_OAUTH_STATE.get("login_mode")
        callback_error = CHATGPT_OAUTH_STATE.get("callback_error")
        callback_code = CHATGPT_OAUTH_STATE.get("callback_code")
        pending_state = CHATGPT_OAUTH_STATE.get("login_state")
        login_output = list(CHATGPT_OAUTH_STATE.get("login_output", []))
        proxy_output = list(CHATGPT_OAUTH_STATE.get("proxy_output", []))

    return {
        "authenticated": _has_chatgpt_oauth_auth_file(),
        "proxyRunning": _is_chatgpt_oauth_proxy_running(),
        "loginRunning": _is_process_running(login_process),
        "proxyProcessRunning": _is_process_running(proxy_process),
        "authUrl": login_url,
        "deviceCode": login_code,
        "loginMode": login_mode,
        "authorizationPending": bool(pending_state),
        "callbackReceived": bool(callback_code),
        "callbackError": callback_error,
        "proxyBaseUrl": CHATGPT_OAUTH_PROXY_BASE_URL,
        "models": CHATGPT_OAUTH_MODELS.split(","),
        "loginOutputTail": login_output[-10:],
        "proxyOutputTail": proxy_output[-10:],
    }


class ApiRouteError(Exception):
    def __init__(self, status_code: int, payload: dict):
        super().__init__(payload.get("error", "API route error"))
        self.status_code = status_code
        self.payload = payload


def _stream_json_line(event_type: str, **payload) -> str:
    return json.dumps({"type": event_type, **payload}, ensure_ascii=False) + "\n"


def _print_request_summary(request_type: str, actual_path: str, query_path: str, remaining_stack: float) -> None:
    print("\n" + "=" * 60)
    print(f"Request Type: {request_type}")
    print(f"Actual Path:  {actual_path}")
    print(f"Query Path:   {query_path}")
    print(f"Remaining:    {remaining_stack:.2f} BB")
    print("=" * 60)


def _format_cards_inline(cards: list[str] | tuple[str, ...]) -> str:
    return ",".join(cards)


def _build_range_remap_samples(
    canonical_range: dict[str, float],
    mapping: FlopIsomorphismMapping,
    *,
    limit: int = 5,
) -> list[str]:
    samples: list[str] = []
    for canonical_hand in canonical_range.keys():
        actual_hand = map_hand_canonical_to_actual(canonical_hand, mapping)
        if actual_hand != canonical_hand:
            samples.append(f"{canonical_hand}->{actual_hand}")
        if len(samples) >= limit:
            break
    return samples


def _log_flop_isomorphism_context(
    *,
    actual_flop_cards: list[str],
    mapping: FlopIsomorphismMapping,
    actual_ai_hand: str,
    canonical_ai_hand: str,
    action_path: list[str],
    ip_range: dict[str, float],
    oop_range: dict[str, float],
) -> None:
    canonical_flop_cards = list(mapping.canonical_ordered_flop_cards)
    canonical_action_path = map_action_path_deal_cards(
        action_path,
        mapping,
        direction="actual_to_canonical",
    )
    mapped_deals = [
        f"{actual_step}->{canonical_step}"
        for actual_step, canonical_step in zip(
            action_path,
            canonical_action_path,
        )
        if actual_step != canonical_step
    ]

    print("\n" + "-" * 60)
    print("[Flop ISO] Request mapping")
    print(f"[Flop ISO] Actual flop:     {_format_cards_inline(actual_flop_cards)}")
    print(f"[Flop ISO] Canonical flop:  {_format_cards_inline(canonical_flop_cards)}")
    print(f"[Flop ISO] Canonical file:  {mapping.canonical_flop}")
    print(f"[Flop ISO] Suit map A->C:   {mapping.actual_to_canonical_suits}")
    print(f"[Flop ISO] Suit map C->A:   {mapping.canonical_to_actual_suits}")
    if actual_ai_hand:
        print(f"[Flop ISO] Hand A->C:      {actual_ai_hand} -> {canonical_ai_hand}")
    if mapped_deals:
        print(f"[Flop ISO] Deal map A->C:  {', '.join(mapped_deals[:6])}")

    ip_samples = _build_range_remap_samples(ip_range, mapping)
    oop_samples = _build_range_remap_samples(oop_range, mapping)
    if ip_samples:
        print(f"[Flop ISO] IP range C->A:  {', '.join(ip_samples)}")
    if oop_samples:
        print(f"[Flop ISO] OOP range C->A: {', '.join(oop_samples)}")
    print("-" * 60)


def _infer_flop_board_from_path(data_path: Path) -> str:
    """Infer the flop board from a JSON/Parquet file name if possible."""
    stem = data_path.stem
    ranks = set("23456789TJQKAtjqka")
    suits = set("cdhs")
    cards = []
    index = 0
    while index < len(stem) - 1 and stem[index] in ranks and stem[index + 1] in suits:
        cards.append(stem[index : index + 2])
        index += 2
    if len(cards) >= 3:
        return ",".join(cards[:3])
    return ""


def _get_dataset_cache_dir() -> Path:
    return gto_dir / "cache" / "dataset"


def _get_legacy_dataset_cache_dir() -> Path:
    return gto_dir / "cache"


def _list_cached_board_names() -> set[str]:
    dataset_cache_dir = _get_dataset_cache_dir()
    legacy_cache_dir = _get_legacy_dataset_cache_dir()
    board_names: set[str] = set()
    for cache_root in (dataset_cache_dir, legacy_cache_dir):
        if not cache_root.exists():
            continue
        for file in cache_root.glob("*.parquet"):
            if file.is_file():
                board_names.add(file.stem)
    return board_names


def _resolve_existing_dataset_file(flop_cards: list[str]) -> tuple[Path | None, str]:
    requested_board = "".join(flop_cards)
    dataset_cache_dir = _get_dataset_cache_dir()
    legacy_cache_dir = _get_legacy_dataset_cache_dir()
    search_roots = [dataset_cache_dir, legacy_cache_dir]

    for cache_root in search_roots:
        direct_candidate = cache_root / f"{requested_board}.parquet"
        if direct_candidate.exists():
            return direct_candidate, requested_board

    if len(flop_cards) != 3:
        return None, requested_board

    for cache_root in search_roots:
        for perm in itertools.permutations(flop_cards):
            permuted_board = "".join(perm)
            candidate = cache_root / f"{permuted_board}.parquet"
            if candidate.exists():
                if permuted_board != requested_board:
                    print(
                        f"[Dataset] Matched cached flop by permutation: "
                        f"{permuted_board} (requested: {requested_board})"
                    )
                return candidate, permuted_board

    return None, requested_board


def _map_range_dict_to_actual(
    range_dict: dict[str, float],
    mapping: FlopIsomorphismMapping | None,
    *,
    uses_isomorphic_flop_tree: bool,
) -> dict[str, float]:
    if not range_dict:
        return {}
    if not uses_isomorphic_flop_tree or mapping is None:
        return dict(range_dict)
    return map_range_dict_keys(
        dict(range_dict),
        mapping,
        direction="canonical_to_actual",
    )


def _sync_current_ranges_with_node(
    current_node: dict | None,
    current_ip_range: dict[str, float],
    current_oop_range: dict[str, float],
    querier,
) -> tuple[dict[str, float], dict[str, float], dict[str, float], dict[str, float]]:
    if current_node and isinstance(current_node.get("ranges", {}), dict):
        ranges_info = current_node.get("ranges", {})
        if ranges_info.get("ip_range"):
            current_ip_range = dict(ranges_info["ip_range"])
        if ranges_info.get("oop_range"):
            current_oop_range = dict(ranges_info["oop_range"])

    current_ip_range_actual = _map_range_dict_to_actual(
        current_ip_range,
        getattr(querier, "flop_isomorphism", None),
        uses_isomorphic_flop_tree=getattr(querier, "uses_isomorphic_flop_tree", False),
    )
    current_oop_range_actual = _map_range_dict_to_actual(
        current_oop_range,
        getattr(querier, "flop_isomorphism", None),
        uses_isomorphic_flop_tree=getattr(querier, "uses_isomorphic_flop_tree", False),
    )
    return current_ip_range, current_oop_range, current_ip_range_actual, current_oop_range_actual


def _resolve_solver_data_path(
    board_str: str,
    dataset_source: str | None,
) -> tuple[Path, str, list[str], FlopIsomorphismMapping]:
    board_cards = [card.strip() for card in board_str.split(",") if card.strip()]
    flop_cards = list(normalize_board_cards(board_cards[:3]))
    mapping = solve_flop_isomorphism(flop_cards)
    canonical_flop_cards = list(mapping.canonical_ordered_flop_cards)
    data_path, flop_board = _resolve_existing_dataset_file(canonical_flop_cards)

    if data_path and data_path.exists():
        return data_path, flop_board, flop_cards, mapping

    cache_dir_path = _get_dataset_cache_dir()

    try:
        from download_from_hf import download_board_from_hf

        downloaded = download_board_from_hf(
            mapping.canonical_flop,
            cache_dir=str(cache_dir_path),
            preferred_source=dataset_source,
        )
    except ImportError as exc:
        raise FileNotFoundError(
            f"Solver data is missing for {flop_board}. "
            f"Install huggingface_hub to enable automatic downloads."
        ) from exc

    if downloaded and downloaded.exists():
        print(f"[Dataset] Downloaded missing flop cache: {downloaded.name}")
        return downloaded, mapping.canonical_flop, flop_cards, mapping

    raise FileNotFoundError(
        f"Solver data is missing and could not be downloaded: {mapping.canonical_flop}"
    )


def _resolve_config_path(data_file: str, flop_board: str) -> str | None:
    from query_action_line import _auto_detect_config

    config_path = _auto_detect_config(data_file)
    if config_path:
        return config_path

    candidates = [
        gto_dir / f"solver/configs/{flop_board}.txt",
        gto_dir / f"configs/{flop_board}.txt",
        gto_dir / "docs/flop_config.txt",
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return None


def _build_path_strings(resolved_actions: list[tuple[str, str]]) -> tuple[str, str]:
    actual_path = "ROOT -> " + (
        " -> ".join(actual for actual, _ in resolved_actions) if resolved_actions else "(empty)"
    )

    query_parts = []
    for actual, matched in resolved_actions:
        if actual == matched or actual.upper().startswith("DEAL"):
            query_parts.append(matched)
        else:
            query_parts.append(f"[{matched}]")
    query_path = "ROOT -> " + (" -> ".join(query_parts) if query_parts else "(empty)")
    return actual_path, query_path


def _refresh_querier_from_solver_output(querier, result_path: Path, config_path: str):
    from parse_solver_result import parse_config
    from query_action_line import _load_data_with_retry

    loaded_data = _load_data_with_retry(result_path)
    if not loaded_data:
        raise RuntimeError(f"Solver output was empty: {result_path.name}")

    querier.data = loaded_data
    querier.data_path = result_path
    querier.config_path = Path(config_path)

    cfg = parse_config(str(config_path))
    querier.board = cfg.get("board", "")
    querier.actual_board = querier.board
    querier.uses_isomorphic_flop_tree = False
    with open(str(config_path), "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line.startswith("set_pot"):
                querier.initial_pot = float(line.split()[1])
            elif line.startswith("set_effective_stack"):
                querier.effective_stack = float(line.split()[1])

    return loaded_data


def _wait_for_realtime_solver(street_name: str, config_path: str, dump_name: str, run_solver_fn, script_dir: Path) -> Path:
    import time

    result_path = script_dir / "cache" / "results" / dump_name
    solver_result = None
    wait_start = time.time()
    waiting_logged = False

    while not result_path.exists() and (time.time() - wait_start < 60):
        with solve_lock:
            if not result_path.exists() and dump_name not in currently_solving:
                currently_solving.add(dump_name)
                should_start = True
            else:
                should_start = False

        if result_path.exists():
            break

        if should_start:
            try:
                print(f"[Solver] Starting realtime {street_name.lower()} solve: {dump_name}")
                solver_result = run_solver_fn(
                    str(Path(config_path).resolve()),
                    output_dir=str(script_dir / "cache" / "results"),
                )
            finally:
                with solve_lock:
                    currently_solving.discard(dump_name)
            break

        if not waiting_logged:
            print(f"[Solver] Waiting for ongoing realtime {street_name.lower()} solve: {dump_name}")
            waiting_logged = True
        time.sleep(1)

    if result_path.exists():
        return result_path

    detail = (
        solver_result.get("error")
        if isinstance(solver_result, dict)
        else f"Timed out waiting for {street_name.lower()} solver output"
    )
    raise RuntimeError(f"{street_name} solve failed for {dump_name}: {detail}")


def _prepare_query_context(data: dict) -> dict:
    board_str = data.get("board", "")
    action_path = data.get("path", [])
    ai_hand = data.get("hand", "")
    fe_eff_stack = data.get("effective_stack")
    dataset_source = data.get("datasetSource")

    if not board_str:
        raise ApiRouteError(400, {"error": "Missing initial board"})
    if action_path is None:
        raise ApiRouteError(400, {"error": "Missing action path"})

    try:
        board_cards = list(normalize_board_cards(board_str.split(",")))
    except ValueError as exc:
        raise ApiRouteError(400, {"error": str(exc)}) from exc

    if len(board_cards) < 3:
        raise ApiRouteError(400, {"error": "Missing flop cards in the board"})

    try:
        data_path, flop_board, flop_cards, flop_iso_mapping = _resolve_solver_data_path(
            board_str,
            dataset_source,
        )
    except FileNotFoundError as exc:
        raise ApiRouteError(404, {"error": str(exc)}) from exc
    except ValueError as exc:
        raise ApiRouteError(400, {"error": str(exc)}) from exc

    if ai_hand:
        try:
            ai_hand = ai_hand.strip()
            if hand_conflicts_with_board(ai_hand, board_cards):
                raise ApiRouteError(400, {"error": "AI hand conflicts with the board"})
        except ValueError as exc:
            raise ApiRouteError(400, {"error": str(exc)}) from exc

    data_file = str(data_path)

    from query_action_line import ActionLineQuery
    from interactive_strategy import (
        _calc_street_state,
        _export_river_config_at_turn_end,
        _export_turn_config_at_flop_end,
        _get_path_and_initial_for_pot,
        _match_action,
        extract_amount_from_action,
    )
    from run_solver import SCRIPT_DIR, run_solver

    config_path = _resolve_config_path(data_file, flop_board)
    if not config_path:
        raise ApiRouteError(404, {"error": "No config found for board"})

    _, ip_rng, oop_rng, init_pot, eff_stack = _get_parsed_config_data(config_path)
    canonical_ai_hand = map_hand_actual_to_canonical(ai_hand, flop_iso_mapping) if ai_hand else ""
    _log_flop_isomorphism_context(
        actual_flop_cards=flop_cards,
        mapping=flop_iso_mapping,
        actual_ai_hand=ai_hand,
        canonical_ai_hand=canonical_ai_hand,
        action_path=action_path,
        ip_range=ip_rng,
        oop_range=oop_rng,
    )
    with _data_load_lock:
        cached_data = _get_loaded_game_data(data_file)

    querier = ActionLineQuery(data_file, config_path)
    querier.data = cached_data
    querier.data_path = Path(data_file)
    querier.config_path = Path(config_path)
    querier.initial_ranges = {
        "ip": ip_rng.copy(),
        "oop": oop_rng.copy(),
    }
    querier.initial_pot = init_pot
    querier.effective_stack = eff_stack
    querier.board = ",".join(flop_iso_mapping.canonical_ordered_flop_cards)
    querier.actual_board = ",".join(flop_cards)
    querier.flop_isomorphism = flop_iso_mapping
    querier.uses_isomorphic_flop_tree = True

    current_node = querier.data
    board_count = 3
    effective_call_amount = 0.0
    current_ip_range = querier.initial_ranges["ip"].copy()
    current_oop_range = querier.initial_ranges["oop"].copy()
    current_ip_range_actual = _map_range_dict_to_actual(
        current_ip_range,
        flop_iso_mapping,
        uses_isomorphic_flop_tree=True,
    )
    current_oop_range_actual = _map_range_dict_to_actual(
        current_oop_range,
        flop_iso_mapping,
        uses_isomorphic_flop_tree=True,
    )
    step_path_so_far: list[str] = []
    resolved_actions: list[tuple[str, str]] = []

    for step in action_path:
        node_type = current_node.get("node_type", "")
        (
            current_ip_range,
            current_oop_range,
            current_ip_range_actual,
            current_oop_range_actual,
        ) = _sync_current_ranges_with_node(
            current_node,
            current_ip_range,
            current_oop_range,
            querier,
        )

        if node_type == "action_node":
            actions = current_node.get("actions", [])
            if not actions:
                path_so_far = " -> ".join(step_path_so_far) if step_path_so_far else "ROOT"
                print(f"[API Error] Action node has no available actions at path: {path_so_far}")
                raise ApiRouteError(500, {"error": "Action node has no available actions"})

            tree_action = _match_action(step, actions)
            if not tree_action and step.upper().startswith("ALLIN"):
                allin_amount = None
                if " " in step:
                    try:
                        allin_amount = float(step.split(" ", 1)[1])
                    except ValueError:
                        allin_amount = None

                has_aggressive_tree_action = any(
                    action.startswith("BET") or action.startswith("RAISE")
                    for action in actions
                    if action not in ("CALL", "FOLD", "CHECK")
                )
                if "CALL" in actions and not has_aggressive_tree_action:
                    tree_action = "CALL"
                    print(f"[Normalize] Mapped ALLIN to CALL (available actions: {actions})")
                elif allin_amount is not None:
                    synthetic_step = (
                        f"RAISE {allin_amount}"
                        if any(action.startswith("RAISE") for action in actions)
                        else f"BET {allin_amount}"
                    )
                    tree_action = _match_action(synthetic_step, actions)
                    if tree_action:
                        print(
                            f"[Normalize] Mapped ALLIN {allin_amount:g} "
                            f"to {tree_action} (available actions: {actions})"
                        )

            if not tree_action:
                print(f"[API Error] Action '{step}' is not valid at this node. Available: {actions}")
                raise ApiRouteError(400, {"error": f"Invalid action: {step}"})

            resolved_actions.append((step, tree_action))
            if tree_action.upper().startswith(("BET", "RAISE", "DONK")):
                amount = extract_amount_from_action(step)
                effective_call_amount = amount if amount is not None else 0.0
            else:
                effective_call_amount = 0.0

            current_node = current_node.get("childrens", {}).get(tree_action)

        elif node_type == "chance_node":
            if not step.upper().startswith("DEAL:"):
                print(f"[API Error] Expected a DEAL action at chance node, got: {step}")
                raise ApiRouteError(400, {"error": f"Expected DEAL action at chance node, got: {step}"})

            actual_card = step.split(":", 1)[1].strip()
            card = actual_card
            if getattr(querier, "uses_isomorphic_flop_tree", False):
                try:
                    card = map_card_actual_to_canonical(actual_card, flop_iso_mapping)
                except ValueError as exc:
                    raise ApiRouteError(400, {"error": str(exc)}) from exc
            dealcards = current_node.get("dealcards", {})
            if card not in dealcards:
                print(f"[API Error] Deal card '{card}' was not found. Available: {list(dealcards.keys())[:20]}")
                raise ApiRouteError(400, {"error": f"Invalid deal card: {actual_card}"})

            resolved_actions.append((step, f"DEAL:{card}"))
            next_node = dealcards[card]

            is_flop_to_turn = (
                board_count == 3 and step_path_so_far and "DEAL" not in "".join(step_path_so_far)
            )
            is_turn_to_river = (
                board_count == 4 and step_path_so_far and "".join(step_path_so_far).count("DEAL") == 1
            )

            if is_flop_to_turn and next_node and next_node.get("node_type") != "terminal":
                turn_ranges = next_node.get("ranges", {})
                path_flop = [action for action in step_path_so_far if not action.upper().startswith("DEAL")]
                export_result = _export_turn_config_at_flop_end(
                    querier,
                    path_flop,
                    next_node,
                    actual_card,
                    _map_range_dict_to_actual(
                        turn_ranges.get("oop_range") or current_oop_range,
                        flop_iso_mapping,
                        uses_isomorphic_flop_tree=getattr(querier, "uses_isomorphic_flop_tree", False),
                    ),
                    _map_range_dict_to_actual(
                        turn_ranges.get("ip_range") or current_ip_range,
                        flop_iso_mapping,
                        uses_isomorphic_flop_tree=getattr(querier, "uses_isomorphic_flop_tree", False),
                    ),
                )
                if export_result:
                    turn_config_path, turn_dump_name = export_result
                    try:
                        turn_result_path = _wait_for_realtime_solver(
                            "TURN",
                            str(turn_config_path),
                            turn_dump_name,
                            run_solver,
                            SCRIPT_DIR,
                        )
                        next_node = _refresh_querier_from_solver_output(
                            querier,
                            turn_result_path,
                            str(turn_config_path),
                        )
                        board_count = 4
                    except RuntimeError as exc:
                        print(f"[API Error] {exc}")
                        raise ApiRouteError(
                            500,
                            {
                                "error": f"Turn solve failed for {turn_dump_name}",
                                "details": str(exc),
                            },
                        ) from exc

            elif is_turn_to_river and (not next_node or next_node.get("node_type") != "terminal"):
                river_ranges = (next_node or {}).get("ranges", {})
                river_node = next_node or {
                    "node_type": "action_node",
                    "ranges": {
                        "oop_range": current_oop_range,
                        "ip_range": current_ip_range,
                    },
                }
                export_result = _export_river_config_at_turn_end(
                    querier,
                    step_path_so_far,
                    river_node,
                    actual_card,
                    river_ranges.get("oop_range") or current_oop_range_actual,
                    river_ranges.get("ip_range") or current_ip_range_actual,
                )
                if export_result:
                    river_config_path, river_dump_name = export_result
                    try:
                        river_result_path = _wait_for_realtime_solver(
                            "RIVER",
                            str(river_config_path),
                            river_dump_name,
                            run_solver,
                            SCRIPT_DIR,
                        )
                        next_node = _refresh_querier_from_solver_output(
                            querier,
                            river_result_path,
                            str(river_config_path),
                        )
                        board_count = 5
                    except RuntimeError as exc:
                        print(f"[API Error] {exc}")
                        raise ApiRouteError(
                            500,
                            {
                                "error": f"River solve failed for {river_dump_name}",
                                "details": str(exc),
                            },
                        ) from exc

            current_node = next_node
            (
                current_ip_range,
                current_oop_range,
                current_ip_range_actual,
                current_oop_range_actual,
            ) = _sync_current_ranges_with_node(
                current_node,
                current_ip_range,
                current_oop_range,
                querier,
            )
            effective_call_amount = 0.0

        step_path_so_far.append(step)
        if not current_node:
            break

    (
        current_ip_range,
        current_oop_range,
        current_ip_range_actual,
        current_oop_range_actual,
    ) = _sync_current_ranges_with_node(
        current_node,
        current_ip_range,
        current_oop_range,
        querier,
    )

    q_path_state, q_init_pot = _get_path_and_initial_for_pot(
        step_path_so_far,
        board_count,
        querier.initial_pot,
        querier.effective_stack,
    )
    pot, oop_added, ip_added = _calc_street_state(q_path_state, q_init_pot)
    calc_remaining_stack = max(0.0, querier.effective_stack - max(oop_added, ip_added))
    final_remaining_stack = float(fe_eff_stack) if fe_eff_stack is not None else calc_remaining_stack

    actual_path_str, query_path_str = _build_path_strings(resolved_actions)
    node_type = current_node.get("node_type", "") if current_node else "missing"

    return {
        "board_str": board_str,
        "board_cards": board_cards,
        "actual_flop_board": ",".join(flop_cards),
        "canonical_flop_board": ",".join(flop_iso_mapping.canonical_ordered_flop_cards),
        "action_path": action_path,
        "ai_hand": ai_hand,
        "actual_ai_hand": ai_hand,
        "canonical_ai_hand": canonical_ai_hand if ai_hand else ai_hand,
        "use_mdf": data.get("use_mdf", False),
        "flop_iso_mapping": flop_iso_mapping,
        "querier": querier,
        "current_node": current_node,
        "node_type": node_type,
        "board_count": board_count,
        "pot": pot,
        "effective_call_amount": effective_call_amount,
        "current_ip_range": current_ip_range,
        "current_oop_range": current_oop_range,
        "current_ip_range_actual": current_ip_range_actual,
        "current_oop_range_actual": current_oop_range_actual,
        "current_tree_uses_isomorphic_flop": getattr(querier, "uses_isomorphic_flop_tree", False),
        "step_path_so_far": step_path_so_far,
        "resolved_actions": resolved_actions,
        "actual_path_str": actual_path_str,
        "query_path_str": query_path_str,
        "final_remaining_stack": final_remaining_stack,
    }


def _resolve_strategy_context(context: dict, ai_hand: str) -> dict:
    import random

    from interactive_strategy import (
        _get_ev_for_hand,
        _get_probs_for_hand,
        _pick_hand_from_strategy,
        filter_invalid_raise_actions,
    )

    current_node = context["current_node"] or {}
    actions = current_node.get("actions", [])
    strategy_dict = current_node.get("strategy", {}).get("strategy", {})
    evs_dict = current_node.get("evs", {}).get("evs", {})
    uses_isomorphic_flop = bool(context.get("current_tree_uses_isomorphic_flop"))
    flop_iso_mapping = context.get("flop_iso_mapping")
    lookup_hand = (
        context.get("canonical_ai_hand") if uses_isomorphic_flop else ai_hand
    ) or ai_hand
    if uses_isomorphic_flop and ai_hand and lookup_hand != ai_hand:
        print(f"[Flop ISO] Strategy lookup A->C: {ai_hand} -> {lookup_hand}")
    acting_player = current_node.get("player")
    acting_range = (
        context["current_ip_range"]
        if acting_player == 1
        else context["current_oop_range"]
    )
    decision_source = "gto_exact"
    decision_detail = "Used the exact queried hand from the GTO strategy."
    strategy_hand_used = ai_hand

    if not actions or not strategy_dict:
        return {
            "fallback_response": {
                "action": "check",
                "strategy": {},
                "decision_source": "fallback_default",
                "decision_detail": "missing_actions_or_strategy",
                "strategy_hand_used": None,
            }
        }

    probs = _get_probs_for_hand(lookup_hand, strategy_dict, actions)
    hand_ev_dict = _get_ev_for_hand(lookup_hand, evs_dict, actions) or {}

    if not probs or len(actions) != len(probs):
        proxy_hand = _pick_hand_from_strategy(strategy_dict, acting_range)
        if not proxy_hand:
            proxy_hand = random.choice(list(strategy_dict.keys()))
        probs = _get_probs_for_hand(proxy_hand, strategy_dict, actions)
        hand_ev_dict = _get_ev_for_hand(proxy_hand, evs_dict, actions) or {}
        strategy_hand_used = (
            map_hand_canonical_to_actual(proxy_hand, flop_iso_mapping)
            if uses_isomorphic_flop and flop_iso_mapping is not None
            else proxy_hand
        )
        if uses_isomorphic_flop and flop_iso_mapping is not None:
            print(f"[Flop ISO] Proxy hand C->A: {proxy_hand} -> {strategy_hand_used}")
        decision_source = "gto_proxy_hand"
        acting_side = "IP" if acting_player == 1 else "OOP" if acting_player == 0 else str(acting_player)
        decision_detail = (
            f"Exact hand strategy was unavailable, so a proxy hand was selected "
            f"from the acting player's {acting_side} range: {strategy_hand_used}."
        )

    if not probs or len(actions) != len(probs):
        return {
            "fallback_response": {
                "action": "check",
                "strategy": {},
                "decision_source": "fallback_default",
                "decision_detail": "missing_probabilities",
                "strategy_hand_used": strategy_hand_used if strategy_hand_used != ai_hand else None,
            }
        }

    if context["effective_call_amount"] > 0:
        filtered_actions, filtered_probs, filtered_evs = filter_invalid_raise_actions(
            actions,
            probs,
            context["effective_call_amount"],
            hand_ev_dict,
        )
        if filtered_actions:
            actions = filtered_actions
            probs = filtered_probs
            if filtered_evs:
                hand_ev_dict = filtered_evs

    return {
        "actions": actions,
        "probs": probs,
        "hand_ev_dict": hand_ev_dict,
        "strategy": dict(zip(actions, probs)),
        "decision_source": decision_source,
        "decision_detail": decision_detail,
        "strategy_hand_used": strategy_hand_used,
        "fallback_response": None,
    }


def _log_fallback_decision(context: dict, ai_hand: str, payload: dict) -> None:
    actual_path_full = f"{context['actual_path_str']} -> CHECK"
    query_path_full = f"{context['query_path_str']} -> CHECK"
    _print_request_summary("fallback_decision", actual_path_full, query_path_full, context["final_remaining_stack"])
    print(f"Hand:            {ai_hand}")
    print(f"Decision Source: {payload['decision_source']}")
    print(f"Decision Detail: {payload['decision_detail']}")


def _cap_action_to_stack(action_name: str, final_remaining_stack: float) -> tuple[str, bool]:
    from interactive_strategy import extract_amount_from_action

    if action_name.upper().startswith(("BET", "RAISE", "DONK")):
        chosen_amount = extract_amount_from_action(action_name)
        if chosen_amount is not None and chosen_amount > final_remaining_stack:
            capped_action = f"{action_name.split()[0]} {final_remaining_stack:.2f}"
            print(
                f"[Sanity Cap] Sampled {action_name}, but remaining stack is "
                f"{final_remaining_stack:.2f}. Using {capped_action} instead."
            )
            return capped_action, True
    return action_name, False


def _log_decision_summary(
    *,
    request_type: str,
    context: dict,
    ai_hand: str,
    actions: list[str],
    probs: list[float],
    sampled_action: str,
    applied_action: str,
    decision_source: str,
    decision_detail: str,
    strategy_hand_used: str,
) -> None:
    actual_path_full = f"{context['actual_path_str']} -> {applied_action}"
    query_path_full = f"{context['query_path_str']} -> {sampled_action}"

    _print_request_summary(request_type, actual_path_full, query_path_full, context["final_remaining_stack"])
    print(f"Hand:            {ai_hand}")
    print(f"Actions:         {actions}")
    print(f"Decision Source: {decision_source}")
    print(f"Decision Detail: {decision_detail}")
    if strategy_hand_used != ai_hand:
        print(f"Strategy Hand:   {strategy_hand_used} (proxy for {ai_hand})")
    print("\nStrategy:")
    for action, probability in zip(actions, probs):
        bar = "#" * int(probability * 20)
        print(f"  {action:<25} {probability:>6.1%}  {bar}")

    chosen_prob = next((prob for action, prob in zip(actions, probs) if action == sampled_action), 0.0)
    print(f"\nAI Output: {applied_action} ({chosen_prob:.1%} sampled probability)")


def _sample_baseline_decision(context: dict, ai_hand: str, strategy_context: dict) -> dict:
    from interactive_strategy import _sample_action_by_probs

    fallback_response = strategy_context.get("fallback_response")
    if fallback_response:
        _log_fallback_decision(context, ai_hand, fallback_response)
        return fallback_response

    actions = strategy_context["actions"]
    probs = strategy_context["probs"]
    hand_ev_dict = strategy_context["hand_ev_dict"]
    decision_source = strategy_context["decision_source"]
    decision_detail = strategy_context["decision_detail"]
    strategy_hand_used = strategy_context["strategy_hand_used"]
    action_chosen = ""
    mdf_triggered = False

    if (
        context["use_mdf"]
        and context["board_count"] == 3
        and context["effective_call_amount"] > 0
        and context["step_path_so_far"]
    ):
        previous_action = context["step_path_so_far"][-1].upper()
        is_bet = previous_action.startswith("BET") or previous_action.startswith("DONK")
        is_raise = previous_action.startswith("RAISE")

        if is_bet or is_raise:
            pot_before = context["pot"] - context["effective_call_amount"]
            if pot_before > 0:
                proportion = context["effective_call_amount"] / pot_before
                mdf_condition_met = (is_bet and proportion > 0.66) or (is_raise and proportion > 1.33)

                if mdf_condition_met:
                    mdf = pot_before / context["pot"]
                    fold_action = next((action for action in actions if action.upper() == "FOLD"), None)
                    fold_ev = hand_ev_dict.get(fold_action, 0.0) if fold_action else 0.0
                    adjusted_evs = {action: ev - fold_ev for action, ev in hand_ev_dict.items()}

                    call_action = next((action for action in actions if action.upper() == "CALL"), None)
                    if not call_action:
                        call_action = next(
                            (
                                action
                                for action in actions
                                if action.upper() not in ["FOLD"]
                                and not action.upper().startswith(("BET", "RAISE", "DONK"))
                            ),
                            None,
                        )

                    if call_action and fold_action:
                        max_defend_ev = max(
                            [ev for action, ev in adjusted_evs.items() if action != fold_action],
                            default=0.0,
                        )
                        threshold = pot_before * mdf

                        print("\n" + "=" * 40)
                        print("[MDF] Starting override evaluation")
                        print(
                            f"[MDF] Trigger: facing a {'bet' if is_bet else 'raise'} "
                            f"for {context['effective_call_amount']:.0f} into {pot_before:.0f} "
                            f"({proportion:.2f}x pot-before-call)"
                        )
                        print(
                            f"[MDF] Threshold formula: {pot_before:.0f} / "
                            f"({pot_before:.0f} + {context['effective_call_amount']:.0f}) = {mdf:.3f}"
                        )
                        print(f"[MDF] Fold EV baseline: {fold_ev:.3f}")
                        print("[MDF] Adjusted EVs (fold normalized to 0):")
                        for action in actions:
                            print(f"  {action}: {adjusted_evs.get(action, 0.0):.3f}")
                        print(f"[MDF] Defend threshold: {pot_before:.0f} * {mdf:.3f} = {threshold:.3f}")

                        if max_defend_ev >= threshold:
                            action_chosen = call_action
                            print(
                                f"[MDF] Decision: defend, because {max_defend_ev:.3f} "
                                f">= {threshold:.3f}. Choosing {action_chosen}."
                            )
                        else:
                            action_chosen = fold_action
                            print(
                                f"[MDF] Decision: fold, because {max_defend_ev:.3f} "
                                f"< {threshold:.3f}. Choosing {action_chosen}."
                            )

                        print("[MDF] Override evaluation finished")
                        print("=" * 40)
                        mdf_triggered = True
                        decision_source = "mdf_override"
                        decision_detail = (
                            f"MDF override was applied after facing a {'bet' if is_bet else 'raise'}."
                        )

    if not mdf_triggered:
        action_chosen = _sample_action_by_probs(actions, probs)

    sampled_action = action_chosen
    action_chosen, was_capped = _cap_action_to_stack(action_chosen, context["final_remaining_stack"])
    if was_capped:
        decision_detail = f"{decision_detail} The sampled action was capped to the remaining stack."

    _log_decision_summary(
        request_type="decision",
        context=context,
        ai_hand=ai_hand,
        actions=actions,
        probs=probs,
        sampled_action=sampled_action,
        applied_action=action_chosen,
        decision_source=decision_source,
        decision_detail=decision_detail,
        strategy_hand_used=strategy_hand_used,
    )

    return {
        "action": action_chosen,
        "strategy": dict(zip(actions, probs)),
        "decision_source": decision_source,
        "decision_detail": decision_detail,
        "strategy_hand_used": strategy_hand_used,
    }


def _map_llm_frequencies_to_actions(
    raw_map: dict[str, float],
    available_actions: list[str],
) -> tuple[dict[str, float], dict[str, float], dict[str, float], float]:
    from interactive_strategy import _match_action

    matched: dict[str, float] = {}
    ignored: dict[str, float] = {}

    for proposed_action, frequency in raw_map.items():
        mapped_action = _match_action(str(proposed_action), available_actions)
        if not mapped_action:
            ignored[proposed_action] = frequency
            continue
        matched[mapped_action] = matched.get(mapped_action, 0.0) + float(frequency)

    if not matched:
        raise ValueError("The LLM output did not contain any action that matched the available solver actions.")

    literal_percentages = {
        action: float(frequency)
        for action, frequency in matched.items()
        if float(frequency) > 0
    }
    total = sum(literal_percentages.values())
    if total <= 0:
        raise ValueError("The LLM output produced non-positive action frequencies.")

    if abs(total - 100.0) <= 1.0:
        normalized_for_sampling = dict(literal_percentages)
    else:
        normalized_for_sampling = {
            action: (frequency / total) * 100.0
            for action, frequency in literal_percentages.items()
        }
    return literal_percentages, normalized_for_sampling, ignored, total


def _sample_llm_decision(context: dict, ai_hand: str, strategy_context: dict, llm_strategy: dict[str, float], model: str) -> dict:
    from interactive_strategy import _sample_action_by_probs

    actions = list(llm_strategy.keys())
    probs = [llm_strategy[action] / 100.0 for action in actions]
    strategy_hand_used = strategy_context["strategy_hand_used"]
    baseline_source = strategy_context["decision_source"]
    sampled_action = _sample_action_by_probs(actions, probs)
    applied_action, was_capped = _cap_action_to_stack(sampled_action, context["final_remaining_stack"])

    decision_source = "llm_river_exploit"
    decision_detail = (
        f"River exploit adjustment generated by {model} using the {baseline_source} baseline."
    )
    if was_capped:
        decision_detail = f"{decision_detail} The sampled action was capped to the remaining stack."

    _log_decision_summary(
        request_type="river_llm_decision",
        context=context,
        ai_hand=ai_hand,
        actions=actions,
        probs=probs,
        sampled_action=sampled_action,
        applied_action=applied_action,
        decision_source=decision_source,
        decision_detail=decision_detail,
        strategy_hand_used=strategy_hand_used,
    )

    return {
        "action": applied_action,
        "strategy": {action: frequency / 100.0 for action, frequency in llm_strategy.items()},
        "decision_source": decision_source,
        "decision_detail": decision_detail,
        "strategy_hand_used": strategy_hand_used,
    }


@app.route("/api/action", methods=["POST"])
def get_action():
    data = request.json or {}
    try:
        context = _prepare_query_context(data)
        ai_hand = context["ai_hand"]

        if not context["current_node"]:
            last_actual = context["resolved_actions"][-1][0] if context["resolved_actions"] else ""
            if context["resolved_actions"] and not last_actual.upper().startswith("DEAL"):
                _print_request_summary(
                    "leaf",
                    context["actual_path_str"],
                    context["query_path_str"],
                    context["final_remaining_stack"],
                )
                print("[API Debug] Reached a leaf node. No further action is available.")
                return jsonify({
                    "status": "complete",
                    "node_type": "terminal",
                    "leaf": True,
                    "reason": "no further child node",
                    "pre_solve": True,
                }), 200

            print("[API Error] Path replay ended on a missing node.")
            return jsonify({"error": "Path replay reached a missing node"}), 404

        if context["node_type"] != "action_node" or not ai_hand:
            request_type = "terminal_or_chance" if context["node_type"] != "action_node" else "pre_solve"
            reason = (
                "Reached a terminal or chance node."
                if context["node_type"] != "action_node"
                else "Pre-solve request received without an AI hand."
            )
            _print_request_summary(
                request_type,
                context["actual_path_str"],
                context["query_path_str"],
                context["final_remaining_stack"],
            )
            print(f"[API Debug] {reason} No action was sampled.")
            return jsonify({"status": "complete", "node_type": context["node_type"], "pre_solve": True}), 200

        strategy_context = _resolve_strategy_context(context, ai_hand)
        return jsonify(_sample_baseline_decision(context, ai_hand, strategy_context)), 200

    except ApiRouteError as exc:
        return jsonify(exc.payload), exc.status_code
    except Exception as exc:
        traceback.print_exc()
        return jsonify({"error": str(exc)}), 500


@app.route("/api/river-exploit-stream", methods=["POST"])
def river_exploit_stream():
    data = request.json or {}

    try:
        context = _prepare_query_context(data)
        ai_hand = context["ai_hand"]

        if context["board_count"] != 5:
            return jsonify({"error": "River exploit is only available on the river."}), 400
        if not context["current_node"]:
            return jsonify({"error": "River exploit could not reach a valid action node."}), 404
        if context["node_type"] != "action_node":
            return jsonify({"error": "River exploit requires an action node."}), 400
        if not ai_hand:
            return jsonify({"error": "Missing AI hand for river exploit."}), 400

        strategy_context = _resolve_strategy_context(context, ai_hand)

        hero_position = str(data.get("heroPosition") or data.get("hero_position") or "BB")
        villain_position = str(data.get("villainPosition") or data.get("villain_position") or "UTG")
        actor_position = str(data.get("actorPosition") or data.get("actor_position") or villain_position)
        opponent_position = str(data.get("opponentPosition") or data.get("opponent_position") or hero_position)
        prompt_language_raw = data.get("promptLanguage")
        if prompt_language_raw is None:
            prompt_language_raw = data.get("prompt_language")
        model_raw = data.get("model")
        if model_raw is None:
            model_raw = data.get("riverExploitModel")
        provider_raw = data.get("provider")
        if provider_raw is None:
            provider_raw = data.get("riverExploitProvider")
        timeout_seconds_raw = data.get("timeoutSeconds")
        if timeout_seconds_raw is None:
            timeout_seconds_raw = data.get("timeout_seconds")
        reasoning_override_raw = data.get("enableReasoning")
        if reasoning_override_raw is None:
            reasoning_override_raw = data.get("enable_reasoning")
        reasoning_override = None if reasoning_override_raw is None else bool(reasoning_override_raw)

        from river_llm_exploit import (
            build_user_prompt,
            create_reasoning_summary_response,
            extract_json_block,
            get_system_prompt,
            normalize_prompt_language,
            normalize_frequency_map,
            normalize_llm_provider,
            normalize_timeout_seconds,
            supports_reasoning_summary,
            supports_visible_reasoning_output,
            stream_reasoning_and_output,
        )
        selected_provider = normalize_llm_provider(str(provider_raw or "modelscope").strip() or "modelscope")
        prompt_language = normalize_prompt_language(
            None if prompt_language_raw is None else str(prompt_language_raw)
        )
        selected_model = None if model_raw is None else str(model_raw).strip()
        if selected_model == "":
            selected_model = None
        try:
            timeout_seconds = normalize_timeout_seconds(timeout_seconds_raw)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        system_prompt = get_system_prompt(prompt_language)

        user_prompt = build_user_prompt(
            board_cards=context["board_cards"],
            path_actions=context["action_path"],
            ai_hand=ai_hand,
            hero_position=hero_position,
            villain_position=villain_position,
            actor_position=actor_position,
            opponent_position=opponent_position,
            actions=strategy_context.get("actions", []),
            probs=strategy_context.get("probs", []),
            strategy_hand_used=strategy_context.get("strategy_hand_used", ai_hand),
            baseline_source=strategy_context.get("decision_source", "fallback_default"),
            baseline_detail=strategy_context.get("decision_detail", "No baseline was available."),
            language=prompt_language,
        )
        reasoning_supported = supports_visible_reasoning_output(
            selected_provider,
            selected_model,
            reasoning_override,
        )

        @stream_with_context
        def generate():
            yield _stream_json_line(
                "status",
                status="loading",
                message="Preparing the river exploit request.",
            )
            yield _stream_json_line(
                "system_markdown",
                content=system_prompt.strip(),
            )
            yield _stream_json_line(
                "user_markdown",
                content=user_prompt,
            )

            fallback_response = strategy_context.get("fallback_response")
            if fallback_response:
                print("[River LLM] Skipping the LLM call because a usable baseline strategy was unavailable.")
                yield _stream_json_line(
                    "warning",
                    message="Skipping the LLM exploit step because a usable GTO baseline was unavailable.",
                )
                decision_payload = _sample_baseline_decision(context, ai_hand, strategy_context)
                yield _stream_json_line("decision", **decision_payload)
                yield _stream_json_line("complete", status="complete")
                return

            reasoning_parts: list[str] = []
            final_parts: list[str] = []

            try:
                use_reasoning_summary = supports_reasoning_summary(
                    selected_provider,
                    selected_model,
                    reasoning_override,
                )
                if use_reasoning_summary:
                    try:
                        reasoning_text, final_text, model = create_reasoning_summary_response(
                            system_prompt=system_prompt,
                            user_prompt=user_prompt,
                            provider=selected_provider,
                            model=selected_model,
                            reasoning_enabled=reasoning_override,
                            timeout_seconds=timeout_seconds,
                        )
                        print(
                            f"[River LLM] Completed Responses API exploit request for {ai_hand} "
                            f"with model: {model}, timeout: {timeout_seconds:.1f}s"
                        )
                        yield _stream_json_line(
                            "meta",
                            model=model,
                            provider=selected_provider,
                            decision_mode="river_llm_exploit",
                            reasoning_supported=reasoning_supported,
                        )
                        if reasoning_text:
                            reasoning_parts.append(reasoning_text)
                            yield _stream_json_line("reasoning_delta", content=reasoning_text)
                        else:
                            no_summary_message = (
                                "The Responses API request completed, but this provider did not return "
                                "a reasoning summary. OpenAI does not expose raw reasoning tokens; only "
                                "`reasoning.summary` can be displayed when the provider returns it."
                            )
                            reasoning_parts.append(no_summary_message)
                            yield _stream_json_line("reasoning_delta", content=no_summary_message)
                            yield _stream_json_line(
                                "warning",
                                message="No reasoning summary was returned by the selected provider.",
                            )
                        if final_text:
                            final_parts.append(final_text)
                            yield _stream_json_line("final_delta", content=final_text)
                    except Exception as summary_exc:
                        print(f"[River LLM] Reasoning summary request failed: {summary_exc}")
                        yield _stream_json_line(
                            "warning",
                            message=(
                                f"Reasoning summary was unavailable from {selected_provider}; "
                                "continuing with final output only."
                            ),
                        )
                        use_reasoning_summary = False

                if not use_reasoning_summary:
                    llm_stream, model = stream_reasoning_and_output(
                        system_prompt=system_prompt,
                        user_prompt=user_prompt,
                        provider=selected_provider,
                        model=selected_model,
                        reasoning_enabled=reasoning_override,
                        timeout_seconds=timeout_seconds,
                    )
                    print(
                        f"[River LLM] Starting exploit stream for {ai_hand} "
                        f"with model: {model}, timeout: {timeout_seconds:.1f}s"
                    )
                    yield _stream_json_line(
                        "meta",
                        model=model,
                        provider=selected_provider,
                        decision_mode="river_llm_exploit",
                        reasoning_supported=selected_provider == "modelscope" and reasoning_supported,
                    )

                    for chunk in llm_stream:
                        if not chunk.choices:
                            continue

                        delta = chunk.choices[0].delta
                        reasoning_delta = getattr(delta, "reasoning_content", "") or ""
                        content_delta = delta.content or ""

                        if reasoning_delta:
                            reasoning_parts.append(reasoning_delta)
                            yield _stream_json_line("reasoning_delta", content=reasoning_delta)

                        if content_delta:
                            final_parts.append(content_delta)
                            yield _stream_json_line("final_delta", content=content_delta)

                final_text = "".join(final_parts)
                parsed_output = extract_json_block(final_text)
                normalized_output = normalize_frequency_map(parsed_output)
                literal_strategy, sampling_strategy, ignored_actions, literal_total = _map_llm_frequencies_to_actions(
                    normalized_output,
                    strategy_context["actions"],
                )
                if ignored_actions:
                    yield _stream_json_line(
                        "warning",
                        message=(
                            "Some LLM actions did not match the available solver actions and were ignored: "
                            + ", ".join(sorted(ignored_actions.keys()))
                        ),
                    )

                if abs(literal_total - 100.0) > 1.0:
                    yield _stream_json_line(
                        "warning",
                        message=(
                            "The parsed LLM frequencies were interpreted on a 0-100 percentage scale, "
                            f"but they summed to {literal_total:.1f}. The backend renormalized them for decision sampling."
                        ),
                    )

                yield _stream_json_line("parsed_output", strategy=literal_strategy)
                decision_payload = _sample_llm_decision(
                    context,
                    ai_hand,
                    strategy_context,
                    sampling_strategy,
                    model,
                )
                yield _stream_json_line("decision", **decision_payload)
                yield _stream_json_line("complete", status="complete")
            except Exception as exc:
                print(f"[River LLM] Stream failed: {exc}")
                traceback.print_exc()
                yield _stream_json_line(
                    "warning",
                    message=f"River LLM exploit failed: {exc}. Falling back to the baseline strategy.",
                )
                decision_payload = _sample_baseline_decision(context, ai_hand, strategy_context)
                yield _stream_json_line("decision", **decision_payload)
                yield _stream_json_line("complete", status="complete")

        return Response(generate(), mimetype="application/x-ndjson")

    except ApiRouteError as exc:
        return jsonify(exc.payload), exc.status_code
    except Exception as exc:
        traceback.print_exc()
        return jsonify({"error": str(exc)}), 500


def _get_solved_boards_from_hf(preferred_source=None):
    from runtime_config import get_dataset_repo_id, get_download_source_config, list_download_source_names

    repo_id = get_dataset_repo_id()

    def _fetch(endpoint=None):
        from huggingface_hub import HfApi

        api = HfApi(endpoint=endpoint) if endpoint else HfApi()
        if hasattr(api, "list_repo_tree"):
            file_paths: list[str] = []
            for entry in api.list_repo_tree(repo_id=repo_id, repo_type="dataset", recursive=True):
                path = getattr(entry, "path", None)
                if isinstance(path, str):
                    file_paths.append(path)
        else:
            file_paths = api.list_repo_files(repo_id=repo_id, repo_type="dataset")
        return [file.split(".")[0] for file in file_paths if file.endswith(".parquet")]

    last_error = None
    for source_name in list_download_source_names(preferred_source):
        source_config = get_download_source_config(source_name)
        endpoint = source_config.get("endpoint")
        try:
            return _fetch(str(endpoint) if endpoint else None)
        except Exception as exc:
            last_error = exc
            print(f"[API Error] Failed to fetch boards via {source_config.get('label', source_name)}: {exc}")

    print(f"[API Error] All configured board sources failed: {last_error}")
    return []


@app.route("/api/solved-boards", methods=["GET"])
def get_solved_boards():
    source = request.args.get("source")
    boards = _get_solved_boards_from_hf(source)
    return jsonify({"boards": boards}), 200


@app.route("/api/cached-boards", methods=["GET"])
def get_cached_boards():
    """List all cached dataset parquet files under cache/dataset, with legacy fallback."""
    boards = sorted(_list_cached_board_names(), key=str.lower)
    return jsonify({"boards": boards}), 200


@app.route("/api/flop-isomorphism", methods=["POST"])
def get_flop_isomorphism():
    data = request.json or {}
    board_str = str(data.get("board") or "")
    board_cards = [card.strip() for card in board_str.split(",") if card.strip()]
    if len(board_cards) != 3:
        return jsonify({"error": "Flop isomorphism requires exactly 3 board cards."}), 400

    try:
        normalized_cards = list(normalize_board_cards(board_cards))
        mapping = solve_flop_isomorphism(normalized_cards)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except FileNotFoundError as exc:
        return jsonify({"error": str(exc)}), 500

    cached_board_names = _list_cached_board_names()
    canonical_flop = mapping.canonical_flop
    return jsonify(
        {
            "actualFlop": "".join(normalized_cards),
            "canonicalFlop": canonical_flop,
            "canonicalFlopCards": list(mapping.canonical_ordered_flop_cards),
            "actualFlopCards": list(mapping.actual_ordered_flop_cards),
            "cached": canonical_flop in cached_board_names,
            "cachedBoardCount": len(cached_board_names),
        }
    ), 200


@app.route("/api/test-hf-connection", methods=["GET"])
def test_hf_connection():
    import requests
    import time
    from runtime_config import get_dataset_repo_id, get_download_source_config, list_download_source_names

    results = {}

    repo_id = get_dataset_repo_id()
    for source_name in list_download_source_names():
        source_config = get_download_source_config(source_name)
        endpoint = source_config.get("endpoint")
        base_url = str(endpoint).rstrip("/") if endpoint else "https://huggingface.co"
        api_url = f"{base_url}/api/datasets/{repo_id}"
        result_key = source_name.replace("-", "_")

        start = time.time()
        try:
            requests.get(api_url, timeout=3)
            results[result_key] = {
                "status": "ok",
                "latency_ms": int((time.time() - start) * 1000),
            }
        except Exception as exc:
            results[result_key] = {"status": "failed", "error": str(exc)}

    return jsonify(results), 200


@app.route("/api/chatgpt-oauth/status", methods=["GET"])
def chatgpt_oauth_status():
    with CHATGPT_OAUTH_LOCK:
        callback_code = CHATGPT_OAUTH_STATE.get("callback_code")
        verifier = CHATGPT_OAUTH_STATE.get("login_verifier")
    if callback_code and verifier:
        try:
            return jsonify(_complete_chatgpt_oauth_login()), 200
        except Exception as exc:
            with CHATGPT_OAUTH_LOCK:
                CHATGPT_OAUTH_STATE["callback_error"] = str(exc)
    return jsonify(_get_chatgpt_oauth_status()), 200


@app.route("/api/chatgpt-oauth/login/start", methods=["POST"])
def start_chatgpt_oauth_login():
    _build_chatgpt_oauth_authorize_url()
    return jsonify(_get_chatgpt_oauth_status()), 200


@app.route("/api/chatgpt-oauth/login/complete", methods=["POST"])
def complete_chatgpt_oauth_login():
    data = request.json or {}
    authorization_input = str(data.get("authorizationInput") or data.get("code") or "").strip()
    try:
        return jsonify(_complete_chatgpt_oauth_login(authorization_input)), 200
    except Exception as exc:
        status = _get_chatgpt_oauth_status()
        status["error"] = str(exc)
        return jsonify(status), 400


@app.route("/api/chatgpt-oauth/proxy/start", methods=["POST"])
def start_chatgpt_oauth_proxy():
    if _is_chatgpt_oauth_proxy_running():
        return jsonify(_get_chatgpt_oauth_status()), 200

    npx = _resolve_executable("npx")
    with CHATGPT_OAUTH_LOCK:
        process = CHATGPT_OAUTH_STATE.get("proxy_process")
        if not _is_process_running(process):
            CHATGPT_OAUTH_STATE["proxy_output"] = []
            CHATGPT_OAUTH_STATE["proxy_process"] = _start_process(
                [
                    npx,
                    "-y",
                    "openai-oauth",
                    "--port",
                    str(CHATGPT_OAUTH_PROXY_PORT),
                    "--models",
                    CHATGPT_OAUTH_MODELS,
                ],
                "proxy_output",
            )

    deadline = time.time() + 12
    while time.time() < deadline:
        status = _get_chatgpt_oauth_status()
        if status.get("proxyRunning"):
            return jsonify(status), 200
        time.sleep(0.5)

    status = _get_chatgpt_oauth_status()
    if not status.get("proxyRunning"):
        status["error"] = "Started openai-oauth, but the local proxy is not ready yet."
    return jsonify(status), 202


if __name__ == "__main__":
    app.run(port=5000, debug=True)
