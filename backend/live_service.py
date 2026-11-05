import asyncio
import base64
import json
import os
import secrets
from contextlib import suppress
from pathlib import Path
from typing import Literal

import requests
import websockets
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from translation_service import translate_text as run_translation


# ==================================================
# CONFIGURATION
# ==================================================

BASE_DIR = Path(__file__).resolve().parent

load_dotenv(BASE_DIR / ".env")

GNANI_API_KEY = os.getenv("GNANI_API_KEY")

STT_WS_URL = "wss://api.vachana.ai/stt/v3/stream"
TTS_URL = "https://api.vachana.ai/api/v1/tts/inference"

router = APIRouter()

# Prototype room storage. Rooms are cleared when the backend restarts.
ROOMS = {}

LanguageCode = Literal["te-IN", "hi-IN", "en-IN"]


# ==================================================
# REQUEST MODELS
# ==================================================

class CreateRoomRequest(BaseModel):
    language: LanguageCode


class JoinRoomRequest(BaseModel):
    language: LanguageCode


# ==================================================
# ROOM HELPERS
# ==================================================

def find_participant(room, token):
    for role, participant in room["participants"].items():

        if participant and participant["token"] == token:
            return role, participant

    return None, None


async def safe_send_json(websocket, payload):

    if websocket is None:
        return

    try:
        await websocket.send_json(payload)

    except Exception as error:
        print("WebSocket send error:", repr(error))


# ==================================================
# GNANI TIMBRE REST AUDIO GENERATION
# ==================================================

def generate_tts_audio(text, target_language):

    if not GNANI_API_KEY:
        raise RuntimeError(
            "Gnani API key is missing. Check backend/.env."
        )

    payload = {
        "text": text,
        "voice": "Lakshmi",
        "model": "timbre-v3.0",
        "language": target_language,
        "speed": 1.0,
        "audio_config": {
            "sample_rate": 48000,
            "num_channels": 1,
            "sample_width": 2,
            "encoding": "linear_pcm",
            "container": "wav",
        },
    }

    response = requests.post(
        TTS_URL,
        headers={
            "X-API-Key-ID": GNANI_API_KEY,
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=60,
    )

    if not response.ok:

        details = response.text[:500]

        raise RuntimeError(
            f"Gnani TTS failed ({response.status_code}): {details}"
        )

    if not response.content:
        raise RuntimeError("Gnani returned empty audio.")

    return response.content


# ==================================================
# TRANSLATE AND SEND AUDIO TO THE OTHER PARTICIPANT
# ==================================================

async def translate_and_send_audio(
    text,
    source_language,
    target_language,
    source_ws,
    target_ws,
):

    text = (text or "").strip()

    if not text:
        return

    try:

        # STEP 1: Translate the completed speech segment.
        if source_language == target_language:

            translated = text

        else:

            translated = await asyncio.to_thread(
                run_translation,
                text=text,
                source_language=source_language,
                target_language=target_language,
            )

        if not translated or not translated.strip():

            raise RuntimeError(
                "Translation service returned empty text."
            )

        translated = translated.strip()

        # STEP 2: Send the original transcript to the speaker.
        await safe_send_json(
            source_ws,
            {
                "type": "transcript",
                "original_text": text,
                "source_language": source_language,
            },
        )

        # STEP 3: Send translated text to the listener.
        await safe_send_json(
            target_ws,
            {
                "type": "translation",
                "original_text": text,
                "translated_text": translated,
                "source_language": source_language,
                "target_language": target_language,
            },
        )

        # STEP 4: Generate translated voice.
        audio_bytes = await asyncio.to_thread(
            generate_tts_audio,
            translated,
            target_language,
        )

        # STEP 5: Convert audio bytes to Base64 for WebSocket JSON.
        audio_base64 = base64.b64encode(
            audio_bytes
        ).decode("ascii")

        # STEP 6: Send the complete WAV audio to the listener.
        await target_ws.send_json(
            {
                "type": "audio_wav",
                "audio": audio_base64,
                "sample_rate": 48000,
            }
        )

        print(
            f"Audio delivered: {source_language} -> {target_language}"
        )

    except Exception as error:

        print("LIVE TRANSLATION/TTS ERROR:", repr(error))

        await safe_send_json(
            source_ws,
            {
                "type": "error",
                "message": str(error),
            },
        )

        await safe_send_json(
            target_ws,
            {
                "type": "error",
                "message": str(error),
            },
        )


# ==================================================
# CREATE A LIVE ROOM
# ==================================================

@router.post("/api/live/rooms")
async def create_live_room(request: CreateRoomRequest):

    if not GNANI_API_KEY:

        raise HTTPException(
            status_code=500,
            detail="Gnani API key missing. Check backend/.env.",
        )

    room_code = secrets.token_hex(3).upper()

    while room_code in ROOMS:
        room_code = secrets.token_hex(3).upper()

    participant_token = secrets.token_urlsafe(24)

    ROOMS[room_code] = {
        "participants": {
            "A": {
                "token": participant_token,
                "language": request.language,
                "websocket": None,
            },
            "B": None,
        }
    }

    return {
        "success": True,
        "room_code": room_code,
        "participant_token": participant_token,
        "role": "A",
        "language": request.language,
    }


# ==================================================
# JOIN A LIVE ROOM
# ==================================================

@router.post("/api/live/rooms/{room_code}/join")
async def join_live_room(
    room_code: str,
    request: JoinRoomRequest,
):

    room_code = room_code.upper().strip()

    room = ROOMS.get(room_code)

    if not room:

        raise HTTPException(
            status_code=404,
            detail="Live room not found.",
        )

    if room["participants"]["B"] is not None:

        raise HTTPException(
            status_code=409,
            detail="This room already has two participants.",
        )

    participant_token = secrets.token_urlsafe(24)

    room["participants"]["B"] = {
        "token": participant_token,
        "language": request.language,
        "websocket": None,
    }

    return {
        "success": True,
        "room_code": room_code,
        "participant_token": participant_token,
        "role": "B",
        "language": request.language,
    }


# ==================================================
# LIVE TWO-WAY WEBSOCKET
# ==================================================

@router.websocket("/ws/live/{room_code}/{participant_token}")
async def live_room_socket(
    websocket: WebSocket,
    room_code: str,
    participant_token: str,
):

    room_code = room_code.upper()

    room = ROOMS.get(room_code)

    if not room:

        await websocket.close(
            code=1008,
            reason="Live room not found.",
        )

        return

    role, participant = find_participant(
        room,
        participant_token,
    )

    if participant is None:

        await websocket.close(
            code=1008,
            reason="Invalid participant token.",
        )

        return

    if not GNANI_API_KEY:

        await websocket.close(
            code=1011,
            reason="Gnani API key is missing.",
        )

        return

    await websocket.accept()

    participant["websocket"] = websocket

    partner_role = "B" if role == "A" else "A"

    stt_ws = None

    reader_task = None
    sender_task = None
    worker_task = None

    try:

        # ------------------------------------------
        # CONNECT TO GNANI PRISMA
        # ------------------------------------------

        stt_headers = {
            "x-api-key-id": GNANI_API_KEY,
            "language_code": participant["language"],
            "model": "prisma-v3.0",
            "format": "transcribe",
            "x-sample-rate": "16000",
            "x-idle-timeout-sec": "900",
            "x-min-silence-ms": "500",
        }

        stt_ws = await websockets.connect(
            STT_WS_URL,
            additional_headers=stt_headers,
            ping_interval=20,
            ping_timeout=20,
            max_size=None,
            open_timeout=20,
        )

        # Prisma should send a connection confirmation.
        first_event = await asyncio.wait_for(
            stt_ws.recv(),
            timeout=15,
        )

        if isinstance(first_event, bytes):
            first_event = first_event.decode("utf-8")

        first_event = json.loads(first_event)

        if first_event.get("type") != "connected":

            raise RuntimeError(
                first_event.get(
                    "message",
                    "Prisma connection was not confirmed.",
                )
            )

        await websocket.send_json(
            {
                "type": "ready",
                "role": role,
                "language": participant["language"],
            }
        )

        # ------------------------------------------
        # CHECK WHETHER THE OTHER PERSON IS CONNECTED
        # ------------------------------------------

        partner = room["participants"].get(partner_role)

        if partner and partner.get("websocket") is not None:

            await safe_send_json(
                partner["websocket"],
                {"type": "partner_joined"},
            )

            await safe_send_json(
                websocket,
                {"type": "partner_joined"},
            )

        else:

            await safe_send_json(
                websocket,
                {"type": "waiting_for_partner"},
            )

        event_queue = asyncio.Queue()

        # ------------------------------------------
        # READ PRISMA EVENTS
        # ------------------------------------------

        async def read_prisma_events():

            try:

                async for raw_event in stt_ws:

                    try:

                        if isinstance(raw_event, bytes):
                            raw_event = raw_event.decode("utf-8")

                        event = json.loads(raw_event)

                        await event_queue.put(event)

                    except (json.JSONDecodeError, UnicodeDecodeError):

                        print("Invalid Prisma event received.")

            except asyncio.CancelledError:
                raise

            except Exception as error:

                await event_queue.put(
                    {
                        "type": "fatal",
                        "message": str(error),
                    }
                )

        # ------------------------------------------
        # PROCESS COMPLETED TRANSCRIPTS
        # ------------------------------------------

        async def process_prisma_events():

            while True:

                event = await event_queue.get()

                event_type = event.get("type")

                if event_type == "transcript":

                    transcript = (
                        event.get("text")
                        or event.get("transcript")
                        or ""
                    ).strip()

                    if not transcript:
                        continue

                    current_partner = room[
                        "participants"
                    ].get(partner_role)

                    target_ws = (
                        current_partner.get("websocket")
                        if current_partner
                        else None
                    )

                    if target_ws is None:

                        await safe_send_json(
                            websocket,
                            {
                                "type": "error",
                                "message": (
                                    "The other participant is not connected."
                                ),
                            },
                        )

                        continue

                    await translate_and_send_audio(
                        text=transcript,
                        source_language=participant["language"],
                        target_language=current_partner["language"],
                        source_ws=websocket,
                        target_ws=target_ws,
                    )

                elif event_type == "error":

                    await safe_send_json(
                        websocket,
                        {
                            "type": "error",
                            "message": event.get(
                                "message",
                                "Prisma returned an error.",
                            ),
                        },
                    )

                elif event_type == "fatal":

                    await safe_send_json(
                        websocket,
                        {
                            "type": "error",
                            "message": (
                                "Prisma connection closed: "
                                + event.get("message", "")
                            ),
                        },
                    )

                    return

        # ------------------------------------------
        # FORWARD BROWSER MICROPHONE FRAMES TO PRISMA
        # ------------------------------------------

        async def send_browser_audio():

            while True:

                message = await websocket.receive()

                if message.get("type") == "websocket.disconnect":
                    return

                audio_bytes = message.get("bytes")

                if audio_bytes is not None:

                    # Prisma expects 512 mono samples,
                    # 16-bit PCM = 1,024 bytes per frame.
                    if len(audio_bytes) != 1024:

                        await safe_send_json(
                            websocket,
                            {
                                "type": "error",
                                "message": (
                                    "Invalid microphone frame. "
                                    "Expected 1,024 bytes."
                                ),
                            },
                        )

                        continue

                    await stt_ws.send(audio_bytes)

                text_message = message.get("text")

                if text_message:

                    try:
                        control = json.loads(text_message)

                    except json.JSONDecodeError:
                        continue

                    if control.get("type") == "commit":

                        await stt_ws.send(
                            json.dumps({"type": "commit"})
                        )

        # ------------------------------------------
        # START THREE CONCURRENT TASKS
        # ------------------------------------------

        reader_task = asyncio.create_task(
            read_prisma_events()
        )

        worker_task = asyncio.create_task(
            process_prisma_events()
        )

        sender_task = asyncio.create_task(
            send_browser_audio()
        )

        # Wait until browser or Prisma disconnects.
        done, pending = await asyncio.wait(
            {
                sender_task,
                reader_task,
            },
            return_when=asyncio.FIRST_COMPLETED,
        )

        for task in pending:
            task.cancel()

        await asyncio.gather(
            *pending,
            return_exceptions=True,
        )

    except WebSocketDisconnect:
        print(f"Participant {role} disconnected.")

    except Exception as error:

        print(
            f"Live room error for participant {role}:",
            repr(error),
        )

        await safe_send_json(
            websocket,
            {
                "type": "error",
                "message": str(error),
            },
        )

    finally:

        # ------------------------------------------
        # CANCEL BACKGROUND TASKS
        # ------------------------------------------

        tasks = [
            reader_task,
            worker_task,
            sender_task,
        ]

        for task in tasks:

            if task is not None and not task.done():
                task.cancel()

        await asyncio.gather(
            *(
                task
                for task in tasks
                if task is not None
            ),
            return_exceptions=True,
        )

        # ------------------------------------------
        # CLOSE PRISMA CONNECTION
        # ------------------------------------------

        if stt_ws is not None:

            with suppress(Exception):
                await stt_ws.close()

        # ------------------------------------------
        # CLEAR THIS PARTICIPANT'S CONNECTION
        # ------------------------------------------

        if participant.get("websocket") is websocket:
            participant["websocket"] = None

        # ------------------------------------------
        # INFORM THE OTHER PARTICIPANT
        # ------------------------------------------

        current_partner = room["participants"].get(
            partner_role
        )

        if (
            current_partner
            and current_partner.get("websocket") is not None
        ):

            await safe_send_json(
                current_partner["websocket"],
                {"type": "partner_left"},
            )