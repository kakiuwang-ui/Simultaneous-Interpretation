"""Local Whisper ASR provider using faster-whisper."""

from collections.abc import AsyncIterator
from pathlib import Path

from interp.asr.base import ASRProvider
from interp.models import SegmentStatus, TranscriptSegment


class WhisperLocalASR(ASRProvider):
    def __init__(self, model_size: str = "large-v3", device: str = "auto"):
        self._model_size = model_size
        self._device = device
        self._model = None

    def _get_model(self):
        if self._model is None:
            from faster_whisper import WhisperModel

            compute_type = "float16" if self._device == "cuda" else "int8"
            device = "cuda" if self._device == "cuda" else "cpu"
            if self._device == "auto":
                try:
                    import torch
                    if torch.cuda.is_available():
                        device, compute_type = "cuda", "float16"
                except ImportError:
                    pass

            self._model = WhisperModel(
                self._model_size, device=device, compute_type=compute_type
            )
        return self._model

    async def transcribe_stream(
        self, audio_chunks: AsyncIterator[bytes]
    ) -> AsyncIterator[TranscriptSegment]:
        raise NotImplementedError(
            "WhisperLocalASR does not support streaming. Use Deepgram for real-time."
        )

    async def transcribe_file(self, file_path: Path) -> list[TranscriptSegment]:
        model = self._get_model()
        segments_iter, info = model.transcribe(
            str(file_path),
            beam_size=5,
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=500),
        )

        segments = []
        for seg in segments_iter:
            segments.append(
                TranscriptSegment(
                    text=seg.text.strip(),
                    language=info.language,
                    start_time=seg.start,
                    end_time=seg.end,
                    status=SegmentStatus.FINAL,
                    confidence=seg.avg_logprob,
                )
            )

        return segments
