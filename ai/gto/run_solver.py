"""
TexasSolver console runner utilities.

This module supports:
- auto-compiling the solver if the executable is missing
- running a single solver config
- batch-running configs under the local configs directory
- optional JSON float post-processing
"""

import os
import re
import subprocess
import sys
import time
from pathlib import Path


SCRIPT_DIR = Path(__file__).parent.resolve()
IS_WINDOWS = sys.platform == "win32"
IS_DARWIN = sys.platform == "darwin"
SOLVER_EXE = str(SCRIPT_DIR / "solver" / ("console_solver.exe" if IS_WINDOWS else "console_solver"))
RESOURCE_DIR = str(SCRIPT_DIR / "solver")
CONFIG_DIR = "configs"
RESULTS_DIR = "cache/results"
TIMEOUT = 7200
FLOAT_PRECISION = 3
POST_PROCESS = False


def auto_compile_solver() -> bool:
    """Compile the solver executable for the current platform."""
    print("\n" + "=" * 60)
    print("Solver executable was not found. Starting automatic build...")
    print("=" * 60)

    try:
        if IS_WINDOWS:
            compile_script = SCRIPT_DIR / "compile.ps1"
            if not compile_script.exists():
                print(f"[Error] Compile script was not found: {compile_script}")
                return False

            print(f"[Build] Running: powershell -ExecutionPolicy Bypass -File {compile_script}")
            result = subprocess.run(
                ["powershell", "-ExecutionPolicy", "Bypass", "-File", str(compile_script)],
                cwd=str(SCRIPT_DIR),
                capture_output=False,
            )
        else:
            compile_script = SCRIPT_DIR / ("compile_macos.sh" if IS_DARWIN else "compile.sh")
            if not compile_script.exists():
                print(f"[Error] Compile script was not found: {compile_script}")
                return False

            os.chmod(str(compile_script), 0o755)
            print(f"[Build] Running: bash {compile_script}")
            result = subprocess.run(
                ["bash", str(compile_script)],
                cwd=str(SCRIPT_DIR),
                capture_output=False,
            )

        if result.returncode == 0:
            print("\n" + "=" * 60)
            print("[Done] Solver build completed successfully.")
            print("=" * 60 + "\n")
            return True

        print(f"\n[Error] Solver build failed with exit code: {result.returncode}")
        return False

    except FileNotFoundError as exc:
        print(f"[Error] A required build tool was not found: {exc}")
        print("Please make sure the following tools are installed:")
        if IS_WINDOWS:
            print("  - CMake")
            print("  - Ninja")
            print("  - MinGW-w64 or MSVC")
        else:
            print("  - CMake")
            print("  - make")
            print("  - g++")
        return False
    except Exception as exc:
        print(f"[Error] Unexpected build failure: {exc}")
        return False


def ensure_solver_exists() -> bool:
    """Ensure the solver executable exists, compiling it if necessary."""
    if os.path.exists(SOLVER_EXE):
        return True

    print(f"[Warning] Solver executable was not found: {SOLVER_EXE}")
    if auto_compile_solver() and os.path.exists(SOLVER_EXE):
        return True

    print(f"[Error] Solver is still unavailable after the build attempt: {SOLVER_EXE}")
    return False


def format_json_floats(input_file: str, output_file: str = None, precision: int = 3) -> None:
    """Stream-process a JSON file and round float values to a fixed precision."""
    if output_file is None:
        output_file = input_file

    float_pattern = re.compile(r'(?<!["\w])(-?\d+\.\d{4,})(?!["\w])')
    action_pattern = re.compile(r'"(BET|RAISE|CALL|CHECK|FOLD|ALLIN)(\s+)(\d+\.\d+)"')
    temp_file = input_file + ".tmp"

    try:
        with open(input_file, "r", encoding="utf-8") as fin, open(temp_file, "w", encoding="utf-8") as fout:
            chunk_size = 1024 * 1024
            buffer = ""

            while True:
                chunk = fin.read(chunk_size)
                if not chunk:
                    if buffer:
                        result = action_pattern.sub(
                            lambda match: f'"{match.group(1)}{match.group(2)}{float(match.group(3)):.2f}"',
                            buffer,
                        )
                        result = float_pattern.sub(
                            lambda match: f"{float(match.group(1)):.{precision}f}",
                            result,
                        )
                        fout.write(result)
                    break

                buffer += chunk
                last_safe = max(
                    buffer.rfind(","),
                    buffer.rfind("]"),
                    buffer.rfind("}"),
                    buffer.rfind(":"),
                )

                if last_safe > 0:
                    to_process = buffer[: last_safe + 1]
                    buffer = buffer[last_safe + 1 :]
                    result = action_pattern.sub(
                        lambda match: f'"{match.group(1)}{match.group(2)}{float(match.group(3)):.2f}"',
                        to_process,
                    )
                    result = float_pattern.sub(
                        lambda match: f"{float(match.group(1)):.{precision}f}",
                        result,
                    )
                    fout.write(result)

        if os.path.exists(output_file) and output_file != temp_file:
            os.remove(output_file)
        os.rename(temp_file, output_file)
    except Exception:
        if os.path.exists(temp_file):
            os.remove(temp_file)
        raise


def _collect_dump_outputs(config_file_abs: str) -> list[str]:
    output_files: list[str] = []
    with open(config_file_abs, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line.startswith("dump_result "):
                output_files.append(line.split(None, 1)[1])
    return output_files


def run_solver(config_file: str, mode: str = "holdem", post_process: bool = None, output_dir: str = None) -> dict:
    """Run the console solver on a single config file."""
    if post_process is None:
        post_process = POST_PROCESS
    if not os.path.exists(config_file):
        return {"success": False, "error": f"Config file does not exist: {config_file}"}
    if not ensure_solver_exists():
        return {"success": False, "error": f"Solver is not available: {SOLVER_EXE}"}

    results_dir = output_dir if output_dir is not None else RESULTS_DIR
    config_file_abs = os.path.abspath(config_file)
    cmd = [SOLVER_EXE, "-i", config_file_abs, "-r", RESOURCE_DIR, "-m", mode]

    print(f"\n{'=' * 60}")
    print(f"Running solver config: {config_file_abs}")
    print(f"Output directory: {Path(results_dir).resolve()}")
    print(f"Command: {' '.join(cmd)}")
    print(f"{'=' * 60}")

    start_time = time.time()
    process = None

    try:
        Path(results_dir).mkdir(parents=True, exist_ok=True)

        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            cwd=results_dir,
        )

        for line in process.stdout:
            print(line, end="")

        process.wait(timeout=TIMEOUT)
        elapsed = time.time() - start_time

        if process.returncode != 0:
            print(f"\n[Error] Solver exited with code: {process.returncode}")
            return {
                "success": False,
                "error": f"Solver exited with code: {process.returncode}",
                "config": config_file_abs,
            }

        print(f"\n[Done] Elapsed: {elapsed:.1f}s")

        if post_process:
            for output_file in _collect_dump_outputs(config_file_abs):
                result_file = Path(results_dir) / output_file
                if not result_file.exists() or result_file.suffix.lower() != ".json":
                    continue
                print(f"[Post Process] Formatting JSON floats: {result_file.name}")
                try:
                    format_json_floats(str(result_file), precision=FLOAT_PRECISION)
                except Exception as exc:
                    print(f"  Warning: Failed to post-process {result_file.name}: {exc}")

        return {
            "success": True,
            "elapsed": elapsed,
            "config": config_file_abs,
        }
    except subprocess.TimeoutExpired:
        if process is not None:
            process.kill()
        return {
            "success": False,
            "error": f"Solver timed out (>{TIMEOUT}s)",
            "config": config_file_abs,
        }
    except Exception as exc:
        return {"success": False, "error": str(exc), "config": config_file_abs}


def run_all_configs(pattern: str = "*.txt", post_process: bool = None) -> None:
    """Run every matching config file under the local config directory."""
    if post_process is None:
        post_process = POST_PROCESS
    if not ensure_solver_exists():
        print(f"[Error] Solver is not available: {SOLVER_EXE}")
        return
    if not os.path.exists(RESOURCE_DIR):
        print(f"[Error] Resource directory does not exist: {RESOURCE_DIR}")
        return

    config_path = Path(CONFIG_DIR)
    if not config_path.exists():
        print(f"[Error] Config directory does not exist: {CONFIG_DIR}")
        return

    config_files = sorted(config_path.glob(pattern))
    if not config_files:
        print(f"No config files matched: {CONFIG_DIR}/{pattern}")
        return

    Path(RESULTS_DIR).mkdir(exist_ok=True)
    print(f"\nFound {len(config_files)} config file(s).")
    print("=" * 60)

    results = []
    start_total = time.time()

    for index, config_file in enumerate(config_files, start=1):
        print(f"\n[{index}/{len(config_files)}] Processing: {config_file.name}")
        result = run_solver(str(config_file), post_process=post_process)
        results.append(result)

        if not result["success"]:
            continue

        config_dir = config_file.parent
        for result_file in list(config_dir.glob("*.json")) + list(config_dir.glob("*.parquet")):
            destination = Path(RESULTS_DIR) / result_file.name
            try:
                result_file.rename(destination)
                print(f"  Moved result file to: {destination}")
            except Exception as exc:
                print(f"  Warning: Failed to move result file {result_file} -> {destination}: {exc}")

    elapsed_total = time.time() - start_total
    success_count = sum(1 for result in results if result["success"])

    print("\n" + "=" * 60)
    print("Batch run finished.")
    print(f"Successful runs: {success_count}/{len(config_files)}")
    print(f"Total elapsed time: {elapsed_total / 60:.1f} min")
    print("=" * 60)


def main() -> None:
    """Command-line entry point."""
    print("=" * 60)
    print("TexasSolver Console Runner")
    print("=" * 60)

    args = sys.argv[1:]
    post_process = None
    if "--no-post-process" in args:
        post_process = False
        args.remove("--no-post-process")
    elif "--post-process" in args:
        post_process = True
        args.remove("--post-process")

    if len(args) < 1:
        print("\nUsage:")
        print(f"  python {sys.argv[0]} <config_file>          Run a single config file")
        print(f"  python {sys.argv[0]} all                    Run every config in configs/*.txt")
        print(f"  python {sys.argv[0]} all config_*.txt       Run configs matching a glob pattern")
        print()
        print("Options:")
        print("  --no-post-process  Skip JSON float formatting after solving")
        print("  --post-process     Force JSON float formatting after solving")
        print()
        print("Examples:")
        print(f"  python {sys.argv[0]} configs/sia_sod_template.txt")
        print(f"  python {sys.argv[0]} configs/sia_sod_template.txt --no-post-process")
        print(f"  python {sys.argv[0]} all")
        print(f"  python {sys.argv[0]} all sia_*.txt")
        return

    arg = args[0]
    if arg == "all":
        pattern = args[1] if len(args) > 1 else "*.txt"
        run_all_configs(pattern, post_process=post_process)
        return

    result = run_solver(arg, post_process=post_process)
    if not result["success"]:
        print(f"\n[Failed] {result.get('error', 'Unknown error')}")
        sys.exit(1)


if __name__ == "__main__":
    main()
