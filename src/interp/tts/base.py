"""Abstract base class for TTS providers."""

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator


class TTSProvider(ABC):
    @abstractmethod
    async def synthesize(self, text: str, voice: str = "alloy") -> bytes:
        """Synthesize text to audio bytes."""
        ...

    @abstractmethod
    async def synthesize_stream(
        self, text: str, voice: str = "alloy"
    ) -> AsyncIterator[bytes]:
        """Stream synthesized audio chunks."""
        ...
