"""Abstract base class for ASR providers."""

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from pathlib import Path

from interp.models import TranscriptSegment


class ASRProvider(ABC):
    @abstractmethod
    async def transcribe_stream(
        self, audio_chunks: AsyncIterator[bytes]
    ) -> AsyncIterator[TranscriptSegment]:
        """Stream audio chunks and yield transcript segments (interim + final)."""
        ...

    @abstractmethod
    async def transcribe_file(self, file_path: Path) -> list[TranscriptSegment]:
        """Transcribe an audio file and return all segments."""
        ...
