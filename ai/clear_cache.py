import os
import shutil
from pathlib import Path

def clear_directory(directory_path):
    path = Path(directory_path)
    if not path.exists():
        print(f"Directory {directory_path} does not exist. Skipping.")
        return

    print(f"Clearing content of: {directory_path}")
    for item in path.iterdir():
        try:
            if item.is_file():
                item.unlink()
                print(f"  Deleted file: {item.name}")
            elif item.is_dir():
                shutil.rmtree(item)
                print(f"  Deleted directory: {item.name}")
        except Exception as e:
            print(f"  Error deleting {item}: {e}")

if __name__ == "__main__":
    # Get the directory where the script is located
    base_dir = Path(__file__).parent
    
    directories_to_clear = [
        base_dir / "gto" / "cache" / "configs",
        base_dir / "gto" / "cache" / "results"
    ]

    for directory in directories_to_clear:
        clear_directory(directory)
    
    print("\nCache clearing completed!")
