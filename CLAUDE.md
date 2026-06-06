# Project Instructions

## Workflow
- Always test before committing. Do not commit untested code.
- Git commits must NOT include any "Co-Authored-By: Claude" or any Claude-related attribution.
- Use simple commit messages in Chinese describing what changed.

## Tech Stack
- Node.js server (server/), vanilla HTML/CSS/JS frontend (web/)
- WebSocket for real-time communication
- ASR: SiliconFlow SenseVoice (server) / Web Speech API (browser)
- Translation: DeepSeek LLM
- TTS: SiliconFlow CosyVoice2 (voice cloning) / browser speechSynthesis (fallback)

## Key Patterns
- Real-time mic mode: browser Web Speech API for ASR (low latency, per-word)
- File upload mode: server-side Whisper ASR
- Voice cloning uses `references` array (NOT `reference_audio`), requires both `audio` data URI and `text` transcript
- WebSocket binary messages: check `pendingVoiceSample` flag first, clear synchronously before async operations
- Environment variables in `server/.env`, loaded with explicit path via dotenv
