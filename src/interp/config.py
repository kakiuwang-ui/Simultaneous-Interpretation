"""Configuration management using pydantic-settings."""

from pathlib import Path
from typing import Optional

import yaml
from pydantic import BaseModel
from pydantic_settings import BaseSettings


class DeepgramConfig(BaseModel):
    model: str = "nova-3"
    language: str = "en"
    interim_results: bool = True
    endpointing: int = 800


class WhisperConfig(BaseModel):
    model_size: str = "large-v3"
    device: str = "auto"


class ASRConfig(BaseModel):
    provider: str = "deepgram"
    deepgram: DeepgramConfig = DeepgramConfig()
    whisper: WhisperConfig = WhisperConfig()


class DeepLConfig(BaseModel):
    formality: str = "default"


class CorrectionConfig(BaseModel):
    enabled: bool = True
    provider: str = "claude"
    model: str = "claude-sonnet-4-20250514"
    window_size: int = 5


class TranslationConfig(BaseModel):
    provider: str = "deepl"
    target_language: str = "zh"
    deepl: DeepLConfig = DeepLConfig()
    correction: CorrectionConfig = CorrectionConfig()


class OpenAITTSConfig(BaseModel):
    model: str = "tts-1"
    voice: str = "alloy"
    speed: float = 1.0
    response_format: str = "pcm"


class TTSConfig(BaseModel):
    enabled: bool = False
    provider: str = "openai"
    openai: OpenAITTSConfig = OpenAITTSConfig()


class PipelineConfig(BaseModel):
    chunk_min_chars: int = 10
    chunk_max_chars: int = 100
    silence_threshold_ms: int = 800
    context_window: int = 5


class AudioConfig(BaseModel):
    input_device: str = "default"
    sample_rate: int = 16000
    channels: int = 1
    chunk_duration_ms: int = 100


class AppConfig(BaseModel):
    asr: ASRConfig = ASRConfig()
    translation: TranslationConfig = TranslationConfig()
    tts: TTSConfig = TTSConfig()
    pipeline: PipelineConfig = PipelineConfig()
    audio: AudioConfig = AudioConfig()


class Settings(BaseSettings):
    deepgram_api_key: str = ""
    deepl_api_key: str = ""
    openai_api_key: str = ""
    anthropic_api_key: str = ""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


def load_config(config_path: Optional[Path] = None) -> AppConfig:
    """Load app config from YAML file, falling back to defaults."""
    if config_path is None:
        config_path = Path(__file__).parent.parent.parent / "config" / "default.yaml"

    if config_path.exists():
        with open(config_path) as f:
            data = yaml.safe_load(f) or {}
        return AppConfig(**data)

    return AppConfig()


def load_settings() -> Settings:
    """Load API keys from environment / .env file."""
    return Settings()
