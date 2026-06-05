"""CLI entry point for AI Simultaneous Interpretation Assistant."""

import asyncio
from pathlib import Path
from typing import Optional

import typer
from rich.console import Console

app = typer.Typer(
    name="interp",
    help="AI Simultaneous Interpretation Assistant",
    add_completion=False,
)
console = Console()


@app.command()
def file(
    input_file: Path = typer.Argument(..., help="Input audio/video file path"),
    source: str = typer.Option("en", "--source", "-s", help="Source language code"),
    target: str = typer.Option("zh", "--target", "-t", help="Target language code"),
    output: Optional[Path] = typer.Option(
        None, "--output", "-o", help="Output audio file path"
    ),
    subtitle: Optional[Path] = typer.Option(
        None, "--subtitle", help="Output SRT subtitle file path"
    ),
    asr_provider: str = typer.Option(
        "whisper", "--asr", help="ASR provider (whisper|deepgram)"
    ),
    tts: bool = typer.Option(False, "--tts", help="Enable TTS audio output"),
    config_file: Optional[Path] = typer.Option(
        None, "--config", "-c", help="Config YAML file path"
    ),
):
    """Translate an audio/video file."""
    if not input_file.exists():
        console.print(f"[red]Error:[/] File not found: {input_file}")
        raise typer.Exit(1)

    # Default output paths
    if subtitle is None and output is None and not tts:
        subtitle = input_file.with_suffix(".srt")

    asyncio.run(_run_file_pipeline(
        input_file, source, target, output, subtitle,
        asr_provider, tts, config_file,
    ))


async def _run_file_pipeline(
    input_file: Path,
    source: str,
    target: str,
    output: Optional[Path],
    subtitle: Optional[Path],
    asr_provider: str,
    enable_tts: bool,
    config_file: Optional[Path],
):
    from interp.config import load_config, load_settings

    config = load_config(config_file)
    settings = load_settings()

    # Build ASR
    if asr_provider == "whisper":
        from interp.asr.whisper_local import WhisperLocalASR
        asr = WhisperLocalASR(
            model_size=config.asr.whisper.model_size,
            device=config.asr.whisper.device,
        )
    else:
        console.print("[red]Deepgram file transcription not yet implemented. Use --asr whisper.[/]")
        return

    # Build Translator
    if not settings.deepl_api_key:
        console.print("[red]Error:[/] DEEPL_API_KEY not set. Check .env file.")
        return
    from interp.translation.deepl_provider import DeepLTranslation
    translator = DeepLTranslation(
        api_key=settings.deepl_api_key,
        formality=config.translation.deepl.formality,
    )

    # Build TTS (optional)
    tts_provider = None
    if enable_tts and output:
        if not settings.openai_api_key:
            console.print("[red]Error:[/] OPENAI_API_KEY not set. Check .env file.")
            return
        from interp.tts.openai_tts import OpenAITTS
        tts_provider = OpenAITTS(
            api_key=settings.openai_api_key,
            model=config.tts.openai.model,
            speed=config.tts.openai.speed,
        )

    # Run pipeline
    from interp.pipeline import FilePipeline
    pipeline = FilePipeline(
        asr=asr,
        translator=translator,
        tts=tts_provider,
        source_lang=source,
        target_lang=target,
    )

    await pipeline.run(
        input_path=input_file,
        output_audio_path=output,
        output_subtitle_path=subtitle,
    )


@app.command()
def live(
    source: str = typer.Option("en", "--source", "-s", help="Source language code"),
    device: Optional[str] = typer.Option(
        None, "--device", "-d", help="Audio input device name"
    ),
    tts: bool = typer.Option(False, "--tts", help="Enable TTS voice output"),
):
    """Real-time interpretation from audio stream (Phase 2)."""
    console.print("[yellow]Live mode not yet implemented. Coming in Phase 2.[/]")
    raise typer.Exit(0)


@app.command()
def web(
    port: int = typer.Option(7860, "--port", "-p", help="Web UI port"),
):
    """Launch web UI (Phase 4)."""
    console.print("[yellow]Web UI not yet implemented. Coming in Phase 4.[/]")
    raise typer.Exit(0)


if __name__ == "__main__":
    app()
