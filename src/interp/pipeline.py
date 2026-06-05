"""Pipeline orchestrator: connects ASR → Translation → TTS."""

import asyncio
from pathlib import Path
from typing import Optional

from rich.console import Console
from rich.table import Table

from interp.asr.base import ASRProvider
from interp.models import SegmentStatus, TranscriptSegment, TranslatedSegment
from interp.translation.base import TranslationProvider
from interp.tts.base import TTSProvider

console = Console()


class FilePipeline:
    """Translate an audio file: ASR → translate → TTS, output audio + subtitles."""

    def __init__(
        self,
        asr: ASRProvider,
        translator: TranslationProvider,
        tts: Optional[TTSProvider] = None,
        source_lang: str = "en",
        target_lang: str = "zh",
    ):
        self.asr = asr
        self.translator = translator
        self.tts = tts
        self.source_lang = source_lang
        self.target_lang = target_lang

    async def run(
        self,
        input_path: Path,
        output_audio_path: Optional[Path] = None,
        output_subtitle_path: Optional[Path] = None,
    ) -> list[TranslatedSegment]:
        # Step 1: ASR
        console.print("[bold blue]Step 1/3:[/] Transcribing audio...", highlight=False)
        segments = await self.asr.transcribe_file(input_path)
        console.print(f"  Found {len(segments)} segments.")

        # Step 2: Translate all segments
        console.print("[bold blue]Step 2/3:[/] Translating...", highlight=False)
        translated: list[TranslatedSegment] = []
        for i, seg in enumerate(segments):
            text = await self.translator.translate(
                seg.text, self.source_lang, self.target_lang
            )
            ts = TranslatedSegment(
                id=seg.id,
                source_text=seg.text,
                translated_text=text,
                status=SegmentStatus.FINAL,
                source_language=self.source_lang,
                target_language=self.target_lang,
            )
            translated.append(ts)
            console.print(f"  [{i + 1}/{len(segments)}] {seg.text[:50]}...")

        # Step 3: Generate subtitles
        if output_subtitle_path:
            self._write_srt(segments, translated, output_subtitle_path)
            console.print(
                f"[bold green]Subtitles saved:[/] {output_subtitle_path}",
                highlight=False,
            )

        # Step 4: Generate TTS audio (if TTS provider and output path given)
        if self.tts and output_audio_path:
            console.print("[bold blue]Step 3/3:[/] Synthesizing audio...", highlight=False)
            await self._synthesize_all(translated, output_audio_path)
            console.print(
                f"[bold green]Audio saved:[/] {output_audio_path}", highlight=False
            )
        elif not self.tts:
            console.print("[dim]Step 3/3: Skipped (TTS not configured)[/]")

        # Print result table
        self._print_results(segments, translated)

        return translated

    async def _synthesize_all(
        self, translated: list[TranslatedSegment], output_path: Path
    ):
        """Concatenate TTS audio for all segments into one file."""
        from pydub import AudioSegment

        combined = AudioSegment.empty()
        for i, seg in enumerate(translated):
            if not seg.translated_text.strip():
                continue
            audio_bytes = await self.tts.synthesize(seg.translated_text)
            # OpenAI TTS returns mp3 by default
            from io import BytesIO
            chunk = AudioSegment.from_file(BytesIO(audio_bytes), format="mp3")
            combined += chunk
            # Add small pause between segments
            combined += AudioSegment.silent(duration=300)

        output_path.parent.mkdir(parents=True, exist_ok=True)
        export_format = output_path.suffix.lstrip(".")
        if export_format == "":
            export_format = "mp3"
        combined.export(str(output_path), format=export_format)

    def _write_srt(
        self,
        source_segments: list[TranscriptSegment],
        translated: list[TranslatedSegment],
        output_path: Path,
    ):
        """Write bilingual SRT subtitle file."""
        output_path.parent.mkdir(parents=True, exist_ok=True)
        lines = []
        for i, (src, tr) in enumerate(zip(source_segments, translated)):
            start = self._format_srt_time(src.start_time)
            end = self._format_srt_time(src.end_time)
            lines.append(str(i + 1))
            lines.append(f"{start} --> {end}")
            lines.append(src.text)
            lines.append(tr.translated_text)
            lines.append("")

        output_path.write_text("\n".join(lines), encoding="utf-8")

    @staticmethod
    def _format_srt_time(seconds: float) -> str:
        h = int(seconds // 3600)
        m = int((seconds % 3600) // 60)
        s = int(seconds % 60)
        ms = int((seconds % 1) * 1000)
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

    def _print_results(
        self,
        source: list[TranscriptSegment],
        translated: list[TranslatedSegment],
    ):
        table = Table(title="Translation Results", show_lines=True)
        table.add_column("#", style="dim", width=4)
        table.add_column("Time", style="cyan", width=12)
        table.add_column("Source", style="white")
        table.add_column("Translation", style="green")

        for i, (src, tr) in enumerate(zip(source, translated)):
            time_str = f"{src.start_time:.1f}-{src.end_time:.1f}s"
            table.add_row(str(i + 1), time_str, src.text, tr.translated_text)

        console.print(table)
