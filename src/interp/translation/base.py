"""Abstract base class for translation providers."""

from abc import ABC, abstractmethod


class TranslationProvider(ABC):
    @abstractmethod
    async def translate(
        self, text: str, source_lang: str, target_lang: str
    ) -> str:
        """Translate a single text segment."""
        ...
