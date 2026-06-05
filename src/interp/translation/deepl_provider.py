"""DeepL translation provider."""

import deepl

from interp.translation.base import TranslationProvider

# DeepL uses specific language codes
_LANG_MAP = {
    "zh": "ZH",
    "en": "EN-US",
    "ja": "JA",
    "ko": "KO",
    "de": "DE",
    "fr": "FR",
    "es": "ES",
    "pt": "PT-BR",
    "ru": "RU",
}


class DeepLTranslation(TranslationProvider):
    def __init__(self, api_key: str, formality: str = "default"):
        self._client = deepl.Translator(api_key)
        self._formality = formality

    async def translate(
        self, text: str, source_lang: str, target_lang: str
    ) -> str:
        if not text.strip():
            return ""

        target = _LANG_MAP.get(target_lang, target_lang.upper())
        source = _LANG_MAP.get(source_lang, source_lang.upper())
        # DeepL source lang doesn't accept region variants
        if "-" in source:
            source = source.split("-")[0]

        result = self._client.translate_text(
            text,
            source_lang=source,
            target_lang=target,
            formality=self._formality if self._formality != "default" else None,
        )
        return result.text
