from __future__ import annotations

import copy
import functools
import json
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv


AI_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = AI_DIR.parent
RUNTIME_CONFIG_PATH = AI_DIR / "runtime_config.json"

DEFAULT_RUNTIME_CONFIG: dict[str, Any] = {
    "llm": {
        "river_exploit": {
            "model": "Qwen/Qwen3.5-27B",
            "timeout_seconds": 60,
            "extra_body": {
                "enable_thinking": True,
            },
        }
    },
    "downloads": {
        "dataset_repo": "Tsumugii/gto-srp-100bb-v1",
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


def get_openai_credentials() -> tuple[str | None, str | None]:
    load_ai_env()
    api_key = os.getenv("OPENAI_API_KEY")
    base_url = os.getenv("BASE_URL") or os.getenv("OPENAI_BASE_URL")
    return api_key, base_url


def get_river_exploit_config() -> dict[str, Any]:
    config = load_runtime_config()
    return copy.deepcopy(config["llm"]["river_exploit"])


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
