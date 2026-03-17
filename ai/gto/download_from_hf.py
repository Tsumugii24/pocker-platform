#!/usr/bin/env python3
"""
Download solver cache parquet files from the configured dataset sources.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Optional

try:
    from huggingface_hub import HfApi, hf_hub_download
except ImportError:
    print("Please install huggingface_hub: pip install -U huggingface_hub")
    sys.exit(1)


SCRIPT_DIR = Path(__file__).parent.resolve()
AI_DIR = SCRIPT_DIR.parent
if str(AI_DIR) not in sys.path:
    sys.path.insert(0, str(AI_DIR))

from runtime_config import (
    get_dataset_repo_id,
    get_download_source_config,
    list_download_source_names,
)


DEFAULT_REPO = get_dataset_repo_id()
DEFAULT_CACHE = str((SCRIPT_DIR / "cache" / "dataset").resolve())


def parse_repo_id(repo_arg: str) -> str:
    """Normalize a dataset repo URL or repo id into a canonical repo id."""
    repo_arg = repo_arg.strip()
    match = re.search(
        r"huggingface\.co/datasets/([a-zA-Z0-9_-]+/[a-zA-Z0-9_.-]+)",
        repo_arg,
        re.IGNORECASE,
    )
    if match:
        return match.group(1)
    if "/" in repo_arg and " " not in repo_arg:
        return repo_arg
    raise ValueError(f"Could not parse dataset repo id from: {repo_arg}")


def board_to_filename(board: str) -> str:
    return board.replace(",", "")


def _get_endpoint_for_source(source_name: str) -> Optional[str]:
    source_config = get_download_source_config(source_name)
    endpoint = source_config.get("endpoint")
    return str(endpoint) if endpoint else None


def _get_source_label(source_name: str) -> str:
    source_config = get_download_source_config(source_name)
    return str(source_config.get("label") or source_name)


def list_repo_files_with_fallback(repo_id: str, preferred_source: str = None) -> tuple[list[str] | None, str | None, Exception | None]:
    last_error: Exception | None = None
    for source_name in list_download_source_names(preferred_source):
        endpoint = _get_endpoint_for_source(source_name)
        try:
            api = HfApi(endpoint=endpoint) if endpoint else HfApi()
            files = api.list_repo_files(repo_id=repo_id, repo_type="dataset")
            return files, source_name, None
        except Exception as exc:
            last_error = exc
            print(f"[Download] Repo listing failed via {_get_source_label(source_name)}: {exc}")
    return None, None, last_error


def find_file_in_repo(repo_id: str, board: str, preferred_source: str = None) -> Optional[str]:
    files, _, last_error = list_repo_files_with_fallback(repo_id, preferred_source)
    if files is None:
        print(f"[Download] Repo listing failed for all configured sources: {last_error}")
        return None

    filename = board_to_filename(board).lower()
    for file_path in files:
        if not file_path.lower().endswith(".parquet"):
            continue
        if Path(file_path).stem.lower() == filename:
            return file_path
    return None


def read_boards_from_cards(cards_path: Path) -> list[str]:
    if not cards_path.exists():
        raise FileNotFoundError(f"Cards file does not exist: {cards_path}")

    boards: list[str] = []
    with open(cards_path, "r", encoding="utf-8") as handle:
        for line in handle:
            board = line.strip()
            if board:
                boards.append(board)
    return boards


def download_board_from_hf(
    board: str,
    cache_dir: str = DEFAULT_CACHE,
    repo_id: str = DEFAULT_REPO,
    preferred_source: str = None,
) -> Optional[Path]:
    """
    Download a single board parquet into the target cache directory.
    """
    board = board.strip()
    cache_path = Path(cache_dir).resolve()
    cache_path.mkdir(parents=True, exist_ok=True)

    remote_path = find_file_in_repo(repo_id, board, preferred_source)
    if not remote_path:
        print(f"[Download] No parquet file was found for board: {board}")
        return None

    last_error: Exception | None = None
    for source_name in list_download_source_names(preferred_source):
        endpoint = _get_endpoint_for_source(source_name)
        try:
            local_path = hf_hub_download(
                repo_id=repo_id,
                filename=remote_path,
                repo_type="dataset",
                local_dir=str(cache_path),
                local_dir_use_symlinks=False,
                force_download=False,
                endpoint=endpoint,
            )
            print(f"[Download] {board} fetched via {_get_source_label(source_name)}")
            return Path(local_path)
        except Exception as exc:
            last_error = exc
            print(f"[Download] Fetch failed via {_get_source_label(source_name)}: {exc}")

    print(f"[Download] Fetch failed for all configured sources: {last_error}")
    return None


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Download board parquet files into the local cache.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python download_from_hf.py AcAdAh AcAdKc
  python download_from_hf.py 1 2 3 --cards configs/cards.txt
  python download_from_hf.py AcAdAh --cache-dir ./my_cache
        """,
    )
    parser.add_argument(
        "boards",
        nargs="+",
        help="Board names such as AcAdAh, or numeric indexes when --cards is used.",
    )
    parser.add_argument(
        "--repo",
        type=str,
        default=DEFAULT_REPO,
        help=f"Dataset repo id or dataset URL. Default: {DEFAULT_REPO}",
    )
    parser.add_argument(
        "--cache-dir",
        type=str,
        default=DEFAULT_CACHE,
        help=f"Local cache directory. Default: {DEFAULT_CACHE}",
    )
    parser.add_argument(
        "--cards",
        type=str,
        default=None,
        help="Path to cards.txt. When provided, positional board values may be indexes.",
    )
    parser.add_argument(
        "--source",
        type=str,
        default=None,
        help="Optional preferred source name from ai/runtime_config.json.",
    )
    args = parser.parse_args()

    try:
        repo_id = parse_repo_id(args.repo)
    except ValueError as exc:
        print(f"[Error] {exc}")
        sys.exit(1)

    cache_dir = Path(args.cache_dir).resolve()
    cache_dir.mkdir(parents=True, exist_ok=True)

    if args.cards:
        cards_path = Path(args.cards)
        if not cards_path.is_absolute():
            cards_path = SCRIPT_DIR.parent / args.cards
        all_boards = read_boards_from_cards(cards_path)
        boards: list[str] = []
        for raw in args.boards:
            try:
                index = int(raw)
            except ValueError:
                boards.append(raw)
                continue

            if 1 <= index <= len(all_boards):
                boards.append(all_boards[index - 1])
            else:
                print(f"[Warning] Skipping out-of-range board index: {index}")
    else:
        boards = [board.strip() for board in args.boards if board.strip()]

    if not boards:
        print("[Error] No valid boards were provided.")
        sys.exit(1)

    print(f"Repo:  https://huggingface.co/datasets/{repo_id}")
    print(f"Cache: {cache_dir}")
    print(f"Boards: {len(boards)}")
    print("-" * 50)

    success_count = 0
    failure_count = 0

    for board in boards:
        local_path = download_board_from_hf(
            board=board,
            cache_dir=str(cache_dir),
            repo_id=repo_id,
            preferred_source=args.source,
        )
        if local_path:
            print(f"[OK] {board} -> {local_path.name}")
            success_count += 1
        else:
            print(f"[FAILED] {board}")
            failure_count += 1

    print("-" * 50)
    print(f"Completed: {success_count} succeeded, {failure_count} failed")
    sys.exit(1 if failure_count else 0)


if __name__ == "__main__":
    main()
