"""Run after creating .kokoro and installing kokoro-onnx and soundfile."""
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parent.parent / ".kokoro"
root.mkdir(exist_ok=True)
base = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/"
for name in ("kokoro-v1.0.onnx", "voices-v1.0.bin"):
    target = root / name
    if target.exists():
        continue
    print(f"Downloading {name}…", flush=True)
    temporary = target.with_suffix(".part")
    subprocess.run(["/usr/bin/curl", "--fail", "--location", "--retry", "3", "--proto", "=https", "--proto-redir", "=https", "--output", str(temporary), base + name], check=True)
    temporary.replace(target)
print("Kokoro Heart is ready.")
