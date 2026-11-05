
import os
import re
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import requests
from dotenv import load_dotenv

from fastapi import (
    FastAPI,
    UploadFile,
    File,
    Form,
    HTTPException,
    Header
)

from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

from translation_service import translate_text as run_translation


# ==================================================
# 1. CONFIGURATION
# ==================================================

BASE_DIR = Path(__file__).resolve().parent

load_dotenv(BASE_DIR / ".env")

GNANI_API_KEY = os.getenv("GNANI_API_KEY")

STT_URL = "https://api.vachana.ai/stt/v3"
TTS_URL = "https://api.vachana.ai/api/v1/tts/inference"

LANGUAGES = {
    "Telugu": "te-IN",
    "Hindi": "hi-IN",
    "English": "en-IN"
}

SUPPORTED_LANGUAGES = (
    "te-IN",
    "hi-IN",
    "en-IN"
)

MAX_AUDIO_SIZE = 10 * 1024 * 1024
MAX_ROOMS = 300
MAX_MESSAGES_PER_ROOM = 100


# ==================================================
# 2. FASTAPI APPLICATION
# ==================================================

app = FastAPI(
    title="MANA VOICE AI",
    description="Universal Multilingual Voice Communication Platform",
    version="3.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)


# ==================================================
# 3. TEMPORARY STORAGE
# ==================================================

# Prototype storage only.
# Data disappears when the backend restarts.

CONVERSATION_ROOMS = {}

RECRUITER_SESSIONS = {}


# ==================================================
# 4. COMMON HELPERS
# ==================================================

def get_gnani_key():

    if not GNANI_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="Gnani API key missing. Check backend/.env"
        )

    return GNANI_API_KEY


def current_time():

    return datetime.now(timezone.utc).isoformat()


def validate_translation_language(text, target_language):

    has_telugu = bool(
        re.search(r"[\u0C00-\u0C7F]", text)
    )

    has_devanagari = bool(
        re.search(r"[\u0900-\u097F]", text)
    )

    if target_language == "en-IN":

        if has_telugu or has_devanagari:
            raise HTTPException(
                status_code=422,
                detail="The translated text still contains Telugu or Hindi script."
            )

    elif target_language == "te-IN":

        if has_devanagari:
            raise HTTPException(
                status_code=422,
                detail="Hindi script found in Telugu output."
            )

    elif target_language == "hi-IN":

        if has_telugu:
            raise HTTPException(
                status_code=422,
                detail="Telugu script found in Hindi output."
            )


# ==================================================
# 5. HOME AND HEALTH
# ==================================================

@app.get("/")
def home():

    return {
        "message": "Welcome to MANA VOICE AI",
        "status": "running",
        "version": "3.0.0"
    }


@app.get("/health")
def health_check():

    return {
        "status": "healthy",
        "service": "MANA VOICE AI",
        "gnani_key_configured": bool(GNANI_API_KEY),
        "translation_engine": "NLLB-200",
        "conversation_rooms": len(CONVERSATION_ROOMS)
    }


@app.get("/languages")
def get_languages():

    return {
        "languages": LANGUAGES,
        "supported_pairs": [
            "Telugu to English",
            "English to Telugu",
            "Hindi to English",
            "English to Hindi",
            "Telugu to Hindi",
            "Hindi to Telugu"
        ]
    }


# ==================================================
# 6. REQUEST MODELS
# ==================================================

class SpeechRequest(BaseModel):

    text: str = Field(
        min_length=1,
        max_length=3000
    )

    language: Literal[
        "te-IN",
        "hi-IN",
        "en-IN"
    ]

    voice: str = "Lakshmi"


class TranslateRequest(BaseModel):

    text: str = Field(
        min_length=1,
        max_length=2000
    )

    source_language: Literal[
        "te-IN",
        "hi-IN",
        "en-IN"
    ]

    target_language: Literal[
        "te-IN",
        "hi-IN",
        "en-IN"
    ]


class CreateRoomRequest(BaseModel):

    display_name: str = Field(
        min_length=1,
        max_length=40
    )

    language: Literal[
        "te-IN",
        "hi-IN",
        "en-IN"
    ]


class JoinRoomRequest(BaseModel):

    display_name: str = Field(
        min_length=1,
        max_length=40
    )

    language: Literal[
        "te-IN",
        "hi-IN",
        "en-IN"
    ]


# ==================================================
# 7. GNANI PRISMA - SPEECH TO TEXT
# ==================================================

@app.post("/api/speech-to-text")
def speech_to_text(
    audio_file: UploadFile = File(...),
    language_code: Literal[
        "te-IN",
        "hi-IN",
        "en-IN"
    ] = Form("te-IN")
):

    api_key = get_gnani_key()

    allowed_formats = {
        ".wav",
        ".mp3",
        ".ogg",
        ".flac",
        ".aac",
        ".m4a"
    }

    filename = audio_file.filename or "recording.wav"

    extension = Path(filename).suffix.lower()

    if extension not in allowed_formats:

        raise HTTPException(
            status_code=415,
            detail="Unsupported audio format."
        )

    audio_data = audio_file.file.read()

    if not audio_data:

        raise HTTPException(
            status_code=400,
            detail="Uploaded audio file is empty."
        )

    if len(audio_data) > 15 * 1024 * 1024:

        raise HTTPException(
            status_code=413,
            detail="Audio must be smaller than 15 MB."
        )

    try:

        response = requests.post(
            STT_URL,

            headers={
                "X-API-Key-ID": api_key
            },

            files={
                "audio_file": (
                    filename,
                    audio_data,
                    audio_file.content_type or "audio/wav"
                )
            },

            data={
                "model": "prisma-v3.0",
                "language_code": language_code,
                "format": "transcribe"
            },

            timeout=90
        )

        response.raise_for_status()

        result = response.json()

        transcript = result.get("transcript", "")

        if not transcript.strip():

            raise HTTPException(
                status_code=422,
                detail="No speech detected."
            )

        return {
            "success": True,
            "original_text": transcript,
            "detected_language": result.get(
                "detected_language_code"
            ),
            "model": result.get("model")
        }

    except HTTPException:
        raise

    except requests.RequestException as error:

        print("Gnani STT error:", str(error))

        status = (
            error.response.status_code
            if error.response is not None
            else "connection error"
        )

        raise HTTPException(
            status_code=502,
            detail=f"Gnani speech recognition failed: {status}"
        )

    except ValueError:

        raise HTTPException(
            status_code=502,
            detail="Invalid response from Gnani Prisma."
        )


# ==================================================
# 8. AUTOMATIC MULTILINGUAL TRANSLATION
# ==================================================

@app.post("/api/translate")
def translate_endpoint(request: TranslateRequest):

    try:

        if request.source_language == request.target_language:

            translated_text = request.text

        else:

            translated_text = run_translation(
                text=request.text,
                source_language=request.source_language,
                target_language=request.target_language
            )

        if not translated_text or not translated_text.strip():

            raise HTTPException(
                status_code=502,
                detail="Translation returned empty text."
            )

        validate_translation_language(
            translated_text,
            request.target_language
        )

        return {
            "success": True,
            "original_text": request.text,
            "translated_text": translated_text,
            "source_language": request.source_language,
            "target_language": request.target_language
        }

    except HTTPException:
        raise

    except ValueError as error:

        raise HTTPException(
            status_code=400,
            detail=str(error)
        )

    except Exception as error:

        print("Translation error:", repr(error))

        raise HTTPException(
            status_code=500,
            detail="Translation failed. Check translation_service.py."
        )


# ==================================================
# 9. GNANI TIMBRE - TEXT TO SPEECH
# ==================================================

@app.post("/api/text-to-speech")
def text_to_speech(request: SpeechRequest):

    api_key = get_gnani_key()

    validate_translation_language(
        request.text,
        request.language
    )

    try:

        payload = {
            "text": request.text,
            "voice": request.voice,
            "model": "timbre-v3.0",
            "language": request.language,
            "speed": 1.0,
            "audio_config": {
                "sample_rate": 48000,
                "num_channels": 1,
                "sample_width": 2,
                "encoding": "linear_pcm",
                "container": "wav"
            }
        }

        response = requests.post(
            TTS_URL,

            headers={
                "X-API-Key-ID": api_key,
                "Content-Type": "application/json"
            },

            json=payload,

            timeout=90
        )

        response.raise_for_status()

        if not response.content:

            raise HTTPException(
                status_code=502,
                detail="Gnani returned empty audio."
            )

        return Response(
            content=response.content,
            media_type="audio/wav",
            headers={
                "Cache-Control": "no-store",
                "Content-Disposition": "inline; filename=mana_voice.wav"
            }
        )

    except HTTPException:
        raise

    except requests.RequestException as error:

        print("Gnani TTS error:", str(error))

        status = (
            error.response.status_code
            if error.response is not None
            else "connection error"
        )

        details = ""

        if error.response is not None:
            details = error.response.text[:300]

        raise HTTPException(
            status_code=502,
            detail=f"Gnani TTS failed ({status}): {details}"
        )


# ==================================================
# 10. TWO-PERSON CONVERSATION HELPERS
# ==================================================

def get_room_member(room_code, participant_token):

    room_code = room_code.upper()

    room = CONVERSATION_ROOMS.get(room_code)

    if not room:

        raise HTTPException(
            status_code=404,
            detail="Conversation room not found."
        )

    if not participant_token:

        raise HTTPException(
            status_code=401,
            detail="Participant token is required."
        )

    for member in room["participants"].values():

        if secrets.compare_digest(
            member["token"],
            participant_token
        ):

            return room, member

    raise HTTPException(
        status_code=403,
        detail="Invalid participant token."
    )


def get_partner(room, participant_id):

    for member in room["participants"].values():

        if member["participant_id"] != participant_id:
            return member

    return None


# ==================================================
# 11. CREATE CONVERSATION ROOM
# ==================================================

@app.post("/api/conversations")
def create_conversation(request: CreateRoomRequest):

    display_name = request.display_name.strip()

    if not display_name:

        raise HTTPException(
            status_code=400,
            detail="Enter your display name."
        )

    if len(CONVERSATION_ROOMS) >= MAX_ROOMS:

        raise HTTPException(
            status_code=503,
            detail="Room capacity reached. Try again later."
        )

    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

    room_code = "".join(
        secrets.choice(alphabet)
        for _ in range(10)
    )

    while room_code in CONVERSATION_ROOMS:

        room_code = "".join(
            secrets.choice(alphabet)
            for _ in range(10)
        )

    participant_token = secrets.token_urlsafe(32)

    CONVERSATION_ROOMS[room_code] = {

        "room_code": room_code,

        "created_at": current_time(),

        "participants": {

            "A": {
                "participant_id": "A",
                "display_name": display_name,
                "language": request.language,
                "token": participant_token
            }

        },

        "messages": []
    }

    return {
        "success": True,
        "room_code": room_code,
        "participant_id": "A",
        "participant_token": participant_token,
        "your_language": request.language,
        "message": "Conversation room created successfully."
    }


# ==================================================
# 12. JOIN CONVERSATION ROOM
# ==================================================

@app.post("/api/conversations/{room_code}/join")
def join_conversation(
    room_code: str,
    request: JoinRoomRequest
):

    room_code = room_code.upper()

    room = CONVERSATION_ROOMS.get(room_code)

    if not room:

        raise HTTPException(
            status_code=404,
            detail="Invalid conversation room code."
        )

    if "B" in room["participants"]:

        raise HTTPException(
            status_code=409,
            detail="This room already has two participants."
        )

    display_name = request.display_name.strip()

    if not display_name:

        raise HTTPException(
            status_code=400,
            detail="Enter your display name."
        )

    participant_token = secrets.token_urlsafe(32)

    room["participants"]["B"] = {

        "participant_id": "B",

        "display_name": display_name,

        "language": request.language,

        "token": participant_token
    }

    person_a = room["participants"]["A"]

    return {
        "success": True,
        "room_code": room_code,
        "participant_id": "B",
        "participant_token": participant_token,
        "your_language": request.language,
        "other_person": {
            "display_name": person_a["display_name"],
            "language": person_a["language"]
        },
        "message": "You joined the conversation."
    }


# ==================================================
# 13. GET ROOM DETAILS AND MESSAGE HISTORY
# ==================================================

@app.get("/api/conversations/{room_code}")
def get_conversation(
    room_code: str,
    participant_token: str = Header(
        ...,
        alias="X-Participant-Token"
    )
):

    room, member = get_room_member(
        room_code,
        participant_token
    )

    partner = get_partner(
        room,
        member["participant_id"]
    )

    messages = []

    for message in room["messages"]:

        messages.append({
            "id": message["id"],
            "sender_id": message["sender_id"],
            "sender_name": message["sender_name"],
            "original_text": message["original_text"],
            "translated_text": message["translated_text"],
            "source_language": message["source_language"],
            "target_language": message["target_language"],
            "created_at": message["created_at"],
            "audio_url": (
                f"/api/conversations/{room_code.upper()}"
                f"/messages/{message['id']}/audio"
            )
        })

    return {
        "success": True,
        "room_code": room_code.upper(),

        "you": {
            "participant_id": member["participant_id"],
            "display_name": member["display_name"],
            "language": member["language"]
        },

        "partner": (
            {
                "display_name": partner["display_name"],
                "language": partner["language"]
            }
            if partner else None
        ),

        "messages": messages
    }


# ==================================================
# 14. SEND TRANSLATED VOICE MESSAGE
# ==================================================

@app.post("/api/conversations/{room_code}/messages")
async def send_conversation_message(

    room_code: str,

    original_text: str = Form(...),

    translated_text: str = Form(...),

    source_language: Literal[
        "te-IN",
        "hi-IN",
        "en-IN"
    ] = Form(...),

    target_language: Literal[
        "te-IN",
        "hi-IN",
        "en-IN"
    ] = Form(...),

    audio_file: UploadFile = File(...),

    participant_token: str = Header(
        ...,
        alias="X-Participant-Token"
    )
):

    room, sender = get_room_member(
        room_code,
        participant_token
    )

    partner = get_partner(
        room,
        sender["participant_id"]
    )

    if not partner:

        raise HTTPException(
            status_code=409,
            detail="Waiting for the other participant to join."
        )

    if len(room["messages"]) >= MAX_MESSAGES_PER_ROOM:

        raise HTTPException(
            status_code=400,
            detail="Conversation message limit reached."
        )

    if source_language != sender["language"]:

        raise HTTPException(
            status_code=400,
            detail="Source language does not match your selected language."
        )

    if target_language != partner["language"]:

        raise HTTPException(
            status_code=400,
            detail="Target language does not match the other participant."
        )

    original_text = original_text.strip()
    translated_text = translated_text.strip()

    if not original_text or not translated_text:

        raise HTTPException(
            status_code=400,
            detail="Original and translated text are required."
        )

    if len(original_text) > 5000 or len(translated_text) > 5000:

        raise HTTPException(
            status_code=400,
            detail="Message text is too long."
        )

    validate_translation_language(
        translated_text,
        target_language
    )

    audio_data = await audio_file.read()

    if not audio_data:

        raise HTTPException(
            status_code=400,
            detail="Audio file is empty."
        )

    if len(audio_data) > MAX_AUDIO_SIZE:

        raise HTTPException(
            status_code=413,
            detail="Audio must be smaller than 10 MB."
        )

    content_type = audio_file.content_type or ""

    if not content_type.startswith("audio/"):

        raise HTTPException(
            status_code=415,
            detail="Please upload a valid audio file."
        )

    message_id = secrets.token_hex(12)

    message = {

        "id": message_id,

        "sender_id": sender["participant_id"],

        "sender_name": sender["display_name"],

        "original_text": original_text,

        "translated_text": translated_text,

        "source_language": source_language,

        "target_language": target_language,

        "audio_data": audio_data,

        "content_type": content_type,

        "created_at": current_time()
    }

    room["messages"].append(message)

    return {
        "success": True,
        "message_id": message_id,
        "message": "Translated voice sent successfully."
    }


# ==================================================
# 15. PLAY RECEIVED CONVERSATION AUDIO
# ==================================================

@app.get(
    "/api/conversations/{room_code}/messages/{message_id}/audio"
)
def get_conversation_audio(

    room_code: str,

    message_id: str,

    participant_token: str = Header(
        ...,
        alias="X-Participant-Token"
    )
):

    room, member = get_room_member(
        room_code,
        participant_token
    )

    message = next(
        (
            item for item in room["messages"]
            if item["id"] == message_id
        ),
        None
    )

    if not message:

        raise HTTPException(
            status_code=404,
            detail="Conversation audio not found."
        )

    return Response(
        content=message["audio_data"],
        media_type=message["content_type"],
        headers={
            "Cache-Control": "no-store",
            "Content-Disposition": "inline; filename=conversation.wav"
        }
    )


# ==================================================
# 16. LEGACY RECRUITER BRIDGE
# ==================================================

@app.post("/api/recruiter/sessions")
def create_recruiter_session():

    session_code = secrets.token_hex(8).upper()

    RECRUITER_SESSIONS[session_code] = {
        "created_at": current_time(),
        "messages": []
    }

    return {
        "success": True,
        "session_code": session_code,
        "message": "Recruiter session created."
    }


@app.post("/api/recruiter/sessions/{session_code}/messages")
async def send_to_recruiter(
    session_code: str,
    original_text: str = Form(...),
    translated_text: str = Form(...),
    audio_file: UploadFile = File(...)
):

    session = RECRUITER_SESSIONS.get(
        session_code.upper()
    )

    if not session:

        raise HTTPException(
            status_code=404,
            detail="Recruiter session not found."
        )

    if len(session["messages"]) >= 50:

        raise HTTPException(
            status_code=400,
            detail="Recruiter message limit reached."
        )

    audio_data = await audio_file.read()

    if not audio_data:

        raise HTTPException(
            status_code=400,
            detail="Audio file is empty."
        )

    if len(audio_data) > MAX_AUDIO_SIZE:

        raise HTTPException(
            status_code=413,
            detail="Audio must be smaller than 10 MB."
        )

    content_type = audio_file.content_type or ""

    if not content_type.startswith("audio/"):

        raise HTTPException(
            status_code=415,
            detail="Invalid audio file."
        )

    message_id = secrets.token_hex(8)

    session["messages"].append({

        "id": message_id,

        "original_text": original_text,

        "translated_text": translated_text,

        "audio_data": audio_data,

        "content_type": content_type,

        "created_at": current_time()

    })

    return {
        "success": True,
        "message_id": message_id,
        "message": "Message sent successfully."
    }


@app.get("/api/recruiter/sessions/{session_code}")
def get_recruiter_messages(session_code: str):

    session = RECRUITER_SESSIONS.get(
        session_code.upper()
    )

    if not session:

        raise HTTPException(
            status_code=404,
            detail="Recruiter session not found."
        )

    messages = []

    for item in session["messages"]:

        messages.append({

            "id": item["id"],

            "original_text": item["original_text"],

            "translated_text": item["translated_text"],

            "created_at": item["created_at"],

            "audio_url": (
                f"/api/recruiter/sessions/{session_code.upper()}"
                f"/messages/{item['id']}/audio"
            )
        })

    return {
        "success": True,
        "session_code": session_code.upper(),
        "messages": messages
    }


@app.get(
    "/api/recruiter/sessions/{session_code}/messages/{message_id}/audio"
)
def get_recruiter_audio(
    session_code: str,
    message_id: str
):

    session = RECRUITER_SESSIONS.get(
        session_code.upper()
    )

    if not session:

        raise HTTPException(
            status_code=404,
            detail="Recruiter session not found."
        )

    message = next(
        (
            item for item in session["messages"]
            if item["id"] == message_id
        ),
        None
    )

    if not message:

        raise HTTPException(
            status_code=404,
            detail="Audio message not found."
        )

    return Response(
        content=message["audio_data"],
        media_type=message["content_type"],
        headers={
            "Cache-Control": "no-store",
            "Content-Disposition": "inline; filename=translated-voice.wav"
        }
    )
from live_service import router as live_router

app.include_router(live_router)

# ==================================================
# END OF MANA VOICE AI BACKEND
# ==================================================

