import re
import torch

from transformers import (
    AutoTokenizer,
    AutoModelForSeq2SeqLM
)


# --------------------------------------------------
# MODEL CONFIGURATION
# --------------------------------------------------

MODEL_NAME = "facebook/nllb-200-distilled-600M"

LANGUAGES = {
    "te-IN": "tel_Telu",
    "hi-IN": "hin_Deva",
    "en-IN": "eng_Latn"
}

DEVICE = torch.device(
    "cuda" if torch.cuda.is_available() else "cpu"
)

tokenizer = None
model = None


# --------------------------------------------------
# CUSTOM NAME GLOSSARY
# --------------------------------------------------
# Add user-confirmed names and spellings here.
# This helps prevent incorrect transliteration.

NAME_GLOSSARY = {
    "నందిని": {
        "te-IN": "నందిని",
        "hi-IN": "नंदिनी",
        "en-IN": "Nandini"
    },

    "नंदिनी": {
        "te-IN": "నందిని",
        "hi-IN": "नंदिनी",
        "en-IN": "Nandini"
    }
}


# --------------------------------------------------
# LOAD MODEL
# --------------------------------------------------

def load_translation_model():

    global tokenizer, model

    if model is None:

        print("Loading MANA VOICE AI Translation Model...")

        tokenizer = AutoTokenizer.from_pretrained(
            MODEL_NAME
        )

        model = AutoModelForSeq2SeqLM.from_pretrained(
            MODEL_NAME
        )

        model.to(DEVICE)
        model.eval()

        print("Translation model loaded!")


# --------------------------------------------------
# PRESERVE KNOWN PROPER NAMES
# --------------------------------------------------

def preserve_names(
    source_text,
    translated_text,
    target_language
):

    for source_name, translations in NAME_GLOSSARY.items():

        if source_name not in source_text:
            continue

        correct_name = translations[target_language]

        patterns = {
            "en-IN": r"(my\s+name\s+is\s+)[^,;.!?]+",
            "te-IN": r"(నా\s+పేరు\s+)[^,;.!?।]+",
            "hi-IN": r"(मेरा\s+नाम\s+)[^,;.!?।]+"
        }

        pattern = patterns[target_language]

        translated_text = re.sub(
            pattern,
            lambda match: match.group(1) + correct_name,
            translated_text,
            count=1,
            flags=re.IGNORECASE
        )

        break

    return translated_text


# --------------------------------------------------
# CONTEXTUAL EDUCATION TRANSLATION
# --------------------------------------------------

def improve_education_translation(
    source_text,
    translated_text,
    source_language,
    target_language
):

    if source_language != "te-IN":
        return translated_text

    if target_language != "en-IN":
        return translated_text

    # Studied in Class 10
    studied_pattern = (
        r"నేను\s*పదవ\s*తరగతి\s*చదువుకున్నాను"
    )

    if re.search(studied_pattern, source_text):

        wrong_phrases = [
            r"I am in the tenth grade",
            r"I am in tenth grade",
            r"I am studying in the tenth grade",
            r"I am studying in tenth grade"
        ]

        for phrase in wrong_phrases:

            translated_text = re.sub(
                phrase,
                "I studied in Class 10",
                translated_text,
                flags=re.IGNORECASE
            )

    # Completed Class 10
    completed_pattern = (
        r"నేను\s*పదవ\s*తరగతి\s*పూర్తి\s*చేశాను"
    )

    if re.search(completed_pattern, source_text):

        translated_text = re.sub(
            r"I am in the tenth grade",
            "I completed Class 10",
            translated_text,
            flags=re.IGNORECASE
        )

    return translated_text


# --------------------------------------------------
# TRANSLATION FUNCTION
# --------------------------------------------------

def translate_text(
    text,
    source_language,
    target_language
):

    if not text or not text.strip():
        raise ValueError("Translation text cannot be empty.")

    if source_language not in LANGUAGES:
        raise ValueError("Unsupported source language.")

    if target_language not in LANGUAGES:
        raise ValueError("Unsupported target language.")

    # Same language: no translation needed
    if source_language == target_language:
        return text

    # Load model on first request
    load_translation_model()

    source_code = LANGUAGES[source_language]
    target_code = LANGUAGES[target_language]

    tokenizer.src_lang = source_code

    # Tokenize original text
    inputs = tokenizer(
        text,
        return_tensors="pt",
        truncation=True,
        max_length=512
    )

    inputs = {
        key: value.to(DEVICE)
        for key, value in inputs.items()
    }

    target_token = tokenizer.convert_tokens_to_ids(
        target_code
    )

    if target_token == tokenizer.unk_token_id:
        raise ValueError("Invalid target language token.")

    # Generate translation
    with torch.inference_mode():

        output_tokens = model.generate(
            **inputs,
            forced_bos_token_id=target_token,
            max_new_tokens=128,
            num_beams=4,
            no_repeat_ngram_size=3
        )

    translated_text = tokenizer.batch_decode(
        output_tokens,
        skip_special_tokens=True
    )[0].strip()

    # Step 1: Correct known names
    translated_text = preserve_names(
        text,
        translated_text,
        target_language
    )

    # Step 2: Improve known education phrases
    translated_text = improve_education_translation(
        text,
        translated_text,
        source_language,
        target_language
    )

    return translated_text
