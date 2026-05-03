from __future__ import annotations

import copy
import functools
import json
import os
import sys
from pathlib import Path
from typing import Any

from dotenv import load_dotenv


AI_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = AI_DIR.parent
RUNTIME_CONFIG_PATH = AI_DIR / "runtime_config.json"

DEFAULT_RUNTIME_CONFIG: dict[str, Any] = {
    "solver": {
        "realtime_dump_format": "auto",
    },
    "llm": {
        "river_exploit": {
            "provider": "modelscope",
            "model": "Qwen/Qwen3-32B",
            "timeout_seconds": 60,
            "extra_body": {
                "enable_thinking": True,
            },
            "providers": {
                "modelscope": {
                    "label": "ModelScope",
                    "model": "Qwen/Qwen3-32B",
                    "api_key_env": "MODELSCOPE_API_KEY",
                    "base_url_env": "MODELSCOPE_BASE_URL",
                    "base_url": None,
                    "extra_body": {
                        "enable_thinking": True,
                    },
                },
                "zenmux": {
                    "label": "ZenMux",
                    "model": "openai/gpt-5.5",
                    "api_key_env": "ZENMUX_API_KEY",
                    "base_url_env": "ZENMUX_BASE_URL",
                    "base_url": "https://zenmux.ai/api/v1",
                    "extra_body": None,
                    "daily_limit": 10,
                },
                "chatgpt-oauth": {
                    "label": "ChatGPT OAuth",
                    "model": "gpt-5.5",
                    "api_key_env": "CHATGPT_OAUTH_API_KEY",
                    "base_url_env": "CHATGPT_OAUTH_BASE_URL",
                    "base_url": "http://127.0.0.1:10531/v1",
                    "extra_body": None,
                },
            },
        }
    },
    "downloads": {
        "dataset_repo": "Tsumugii/sia-100bb",
        "default_source": "huggingface",
        "mirror_source": "hf-mirror",
        "backup_source": "backup",
        "sources": {
            "huggingface": {
                "label": "HuggingFace",
                "endpoint": None,
                "enabled": True,
            },
            "hf-mirror": {
                "label": "HF-Mirror",
                "endpoint": "https://hf-mirror.com",
                "enabled": True,
            },
            "backup": {
                "label": "Backup Source",
                "endpoint": None,
                "enabled": False,
            },
        },
    },
}


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    merged = copy.deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


@functools.lru_cache(maxsize=1)
def load_runtime_config() -> dict[str, Any]:
    if not RUNTIME_CONFIG_PATH.exists():
        return copy.deepcopy(DEFAULT_RUNTIME_CONFIG)

    with open(RUNTIME_CONFIG_PATH, "r", encoding="utf-8") as handle:
        raw = json.load(handle)
    if not isinstance(raw, dict):
        raise RuntimeError("runtime_config.json must contain a top-level JSON object.")
    return _deep_merge(DEFAULT_RUNTIME_CONFIG, raw)


@functools.lru_cache(maxsize=1)
def load_ai_env() -> tuple[str, ...]:
    loaded_files: list[str] = []
    for candidate in (AI_DIR / ".env", PROJECT_ROOT / ".env"):
        if candidate.exists():
            load_dotenv(candidate, override=False)
            loaded_files.append(str(candidate))
    return tuple(loaded_files)


def normalize_llm_provider(provider_name: str | None = None) -> str:
    config = get_river_exploit_config()
    providers = config.get("providers", {})
    selected = str(provider_name or config.get("provider") or "modelscope").strip().lower()
    if selected == "openai-oauth":
        selected = "chatgpt-oauth"
    if selected in providers:
        return selected
    return "modelscope"


def get_river_exploit_provider_config(provider_name: str | None = None) -> dict[str, Any]:
    config = get_river_exploit_config()
    providers = config.get("providers", {})
    provider = normalize_llm_provider(provider_name)
    provider_config = providers.get(provider)
    if not isinstance(provider_config, dict):
        provider_config = {}
    return copy.deepcopy(provider_config)


def get_openai_credentials(provider_name: str | None = None) -> tuple[str | None, str | None]:
    load_ai_env()
    provider_config = get_river_exploit_provider_config(provider_name)
    api_key_env = str(provider_config.get("api_key_env") or "MODELSCOPE_API_KEY")
    api_key_fallback_env = provider_config.get("api_key_fallback_env")
    base_url_env = str(provider_config.get("base_url_env") or "MODELSCOPE_BASE_URL")
    base_url_fallback_env = provider_config.get("base_url_fallback_env")
    api_key = os.getenv(api_key_env)
    if not api_key and api_key_fallback_env:
        api_key = os.getenv(str(api_key_fallback_env))
    base_url = os.getenv(base_url_env)
    if not base_url and base_url_fallback_env:
        base_url = os.getenv(str(base_url_fallback_env))
    if not base_url:
        configured_base_url = provider_config.get("base_url")
        base_url = str(configured_base_url) if configured_base_url else None
    return api_key, base_url


def get_river_exploit_config() -> dict[str, Any]:
    config = load_runtime_config()
    return copy.deepcopy(config["llm"]["river_exploit"])


def get_solver_config() -> dict[str, Any]:
    config = load_runtime_config()
    return copy.deepcopy(config["solver"])


def get_realtime_solver_dump_format(platform_name: str | None = None) -> str:
    config = get_solver_config()
    raw_value = str(config.get("realtime_dump_format", "auto")).strip().lower()
    if raw_value not in {"auto", "json", "parquet"}:
        raise RuntimeError(
            "solver.realtime_dump_format must be one of: auto, json, parquet."
        )

    current_platform = platform_name or sys.platform
    if raw_value == "auto":
        return "json" if current_platform == "win32" else "parquet"
    if raw_value == "parquet" and current_platform == "win32":
        return "json"
    return raw_value


def get_download_config() -> dict[str, Any]:
    config = load_runtime_config()
    return copy.deepcopy(config["downloads"])


def get_dataset_repo_id() -> str:
    return str(get_download_config()["dataset_repo"])


def list_download_source_names(preferred_source: str | None = None) -> list[str]:
    config = get_download_config()
    sources = config.get("sources", {})

    ordered_names: list[str] = []
    for candidate in (
        preferred_source,
        config.get("default_source"),
        config.get("mirror_source"),
        config.get("backup_source"),
    ):
        if not candidate or candidate in ordered_names:
            continue
        source_config = sources.get(candidate)
        if not isinstance(source_config, dict):
            continue
        if not source_config.get("enabled", True):
            continue
        ordered_names.append(candidate)

    if not ordered_names:
        ordered_names.append("huggingface")
    return ordered_names


def get_download_source_config(source_name: str) -> dict[str, Any]:
    sources = get_download_config().get("sources", {})
    source_config = sources.get(source_name)
    if not isinstance(source_config, dict):
        raise KeyError(f"Unknown download source: {source_name}")
    return copy.deepcopy(source_config)
