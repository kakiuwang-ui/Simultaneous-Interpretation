"""OpenAI TTS provider."""

from collections.abc import AsyncIterator
from pathlib import Path

from openai import OpenAI

from interp.tts.base import TTSProvider


class OpenAITTS(TTSProvider):
    def __init__(
        self,
        api_key: str,
        model: str = "tts-1",
        speed: float = 1.0,
        response_format: str = "mp3",
    ):
        self._client = OpenAI(api_key=api_key)
        self._model = model
        self._speed = speed
        self._response_format = response_format

    async def synthesize(self, text: str, voice: str = "alloy") -> bytes:
        if not text.strip():
            return b""

        response = self._client.audio.speech.create(
            model=self._model,
            voice=voice,
            input=text,
            speed=self._speed,
            response_format=self._response_format,
        )
        return response.content

    async def synthesize_stream(
        self, text: str, voice: str = "alloy"
    ) -> AsyncIterator[bytes]:
        if not text.strip():
            return

        with self._client.audio.speech.with_streaming_response.create(
            model=self._model,
            voice=voice,
            input=text,
            speed=self._speed,
            response_format=self._response_format,
        ) as response:
            for chunk in response.iter_bytes(chunk_size=4096):
                yield chunk

    async def synthesize_to_file(
        self, text: str, output_path: Path, voice: str = "alloy"
    ) -> Path:
        audio_data = await self.synthesize(text, voice)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(audio_data)
        return output_path
