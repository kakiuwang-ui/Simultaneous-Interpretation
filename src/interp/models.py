"""Core data models used across the pipeline."""

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional
import uuid


class SegmentStatus(Enum):
    INTERIM = "interim"
    FINAL = "final"
    CORRECTED = "corrected"


@dataclass
class TranscriptSegment:
    text: str
    language: str
    start_time: float
    end_time: float
    status: SegmentStatus
    confidence: float = 1.0
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:8])


@dataclass
class TranslatedSegment:
    id: str
    source_text: str
    translated_text: str
    status: SegmentStatus
    source_language: str = ""
    target_language: str = "zh"
    previous_text: str = ""
    correction_reason: str = ""


@dataclass
class AudioChunk:
    data: bytes
    sample_rate: int = 16000
    channels: int = 1
    format: str = "pcm_s16le"
