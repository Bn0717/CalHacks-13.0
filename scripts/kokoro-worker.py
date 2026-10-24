"""Local Heart synthesis. JSON lines in, base64 PCM WAV JSON lines out."""
import base64
import io
import json
from pathlib import Path
import sys

import soundfile as sf
from kokoro_onnx import Kokoro

root = Path(__file__).resolve().parent.parent / ".kokoro"
# Keep library diagnostics off the JSON protocol channel.
protocol = sys.stdout
sys.stdout = sys.stderr
model = Kokoro(str(root / "kokoro-v1.0.onnx"), str(root / "voices-v1.0.bin"))
for line in sys.stdin:
    request = {}
    try:
        request = json.loads(line)
        text = request["text"]
        if not isinstance(text, str) or not 0 < len(text) <= 2000:
            raise ValueError("Speech text must contain 1–2000 characters")
        samples, rate = model.create(text, voice="af_heart", speed=1.0, lang="en-us")
        audio = io.BytesIO()
        sf.write(audio, samples, rate, format="WAV", subtype="PCM_16")
        result = {"id": request["id"], "audio": base64.b64encode(audio.getvalue()).decode("ascii")}
    except Exception as error:
        result = {"id": request.get("id"), "error": str(error)}
    protocol.write(json.dumps(result) + "\n")
    protocol.flush()
