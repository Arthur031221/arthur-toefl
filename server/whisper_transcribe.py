#!/usr/bin/env python3
"""faster-whisper 本地轉錄:python whisper_transcribe.py <audio_path> [model_size]
輸出單行 JSON:{"text": "...", "duration": 45.2, "segments": [{"start","end","text"}]}
首次執行會從 HuggingFace 下載模型(base 約 74MB / small 約 244MB)。
"""
import json
import sys


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: whisper_transcribe.py <audio> [model]"}))
        sys.exit(2)
    path = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) > 2 else "base"

    from faster_whisper import WhisperModel

    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    segments, info = model.transcribe(path, language="en", beam_size=5, vad_filter=True)

    segs = []
    parts = []
    for s in segments:
        segs.append({"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()})
        parts.append(s.text.strip())

    print(
        json.dumps(
            {
                "text": " ".join(parts).strip(),
                "duration": round(info.duration, 2),
                "segments": segs,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
