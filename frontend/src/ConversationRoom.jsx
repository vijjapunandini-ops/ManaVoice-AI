import { useEffect, useRef, useState } from "react";

const API_URL = "http://127.0.0.1:8000";

const LANGUAGES = {
  Telugu: "te-IN",
  Hindi: "hi-IN",
  English: "en-IN",
};

const LANGUAGE_NAMES = {
  "te-IN": "Telugu",
  "hi-IN": "Hindi",
  "en-IN": "English",
};

async function convertToWav(blob) {
  const AudioContextClass =
    window.AudioContext || window.webkitAudioContext;

  const context = new AudioContextClass();

  try {
    const audioBuffer = await context.decodeAudioData(
      await blob.arrayBuffer()
    );

    const samples = audioBuffer.length;
    const channels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;

    const mono = new Float32Array(samples);

    for (let channel = 0; channel < channels; channel++) {
      const data = audioBuffer.getChannelData(channel);

      for (let i = 0; i < samples; i++) {
        mono[i] += data[i] / channels;
      }
    }

    const wavBuffer = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(wavBuffer);

    function writeString(offset, value) {
      for (let i = 0; i < value.length; i++) {
        view.setUint8(offset + i, value.charCodeAt(i));
      }
    }

    writeString(0, "RIFF");
    view.setUint32(4, 36 + samples * 2, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, samples * 2, true);

    let offset = 44;

    for (let i = 0; i < samples; i++) {
      const sample = Math.max(-1, Math.min(1, mono[i]));

      view.setInt16(
        offset,
        sample < 0 ? sample * 32768 : sample * 32767,
        true
      );

      offset += 2;
    }

    return new File([wavBuffer], "mana-recording.wav", {
      type: "audio/wav",
    });
  } finally {
    await context.close();
  }
}

function ConversationRoom() {
  const [displayName, setDisplayName] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState("te-IN");
  const [roomCodeInput, setRoomCodeInput] = useState("");

  const [room, setRoom] = useState(null);
  const [partner, setPartner] = useState(null);

  const [recordedFile, setRecordedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");

  const [messages, setMessages] = useState([]);
  const [audioUrls, setAudioUrls] = useState({});

  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [busy, setBusy] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const loadedAudioRef = useRef(new Set());
  const audioUrlsRef = useRef({});

  // CLEANUP EFFECT 1:
  // Release microphone and message audio URLs when leaving the page.
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }

      Object.values(audioUrlsRef.current).forEach((url) => {
        URL.revokeObjectURL(url);
      });
    };
  }, []);

  // CLEANUP EFFECT 2:
  // Revoke only the previous recording preview URL when it changes.
  useEffect(() => {
    if (!previewUrl) return;

    return () => {
      URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Refresh messages while participants are in the room.
  useEffect(() => {
    if (!room) return;

    let active = true;

    async function refreshRoom() {
      try {
        const response = await fetch(
          `${API_URL}/api/conversations/${room.roomCode}`,
          {
            headers: {
              "X-Participant-Token": room.token,
            },
          }
        );

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.detail || "Unable to load conversation.");
        }

        if (!active) return;

        setPartner(result.partner);
        setMessages(result.messages || []);

        for (const message of result.messages || []) {
          if (loadedAudioRef.current.has(message.id)) continue;

          loadedAudioRef.current.add(message.id);

          try {
            const audioResponse = await fetch(
              `${API_URL}${message.audio_url}`,
              {
                headers: {
                  "X-Participant-Token": room.token,
                },
              }
            );

            if (!audioResponse.ok) {
              throw new Error("Could not load message audio.");
            }

            const audioBlob = await audioResponse.blob();
            const audioUrl = URL.createObjectURL(audioBlob);

            if (!active) {
              URL.revokeObjectURL(audioUrl);
              continue;
            }

            audioUrlsRef.current[message.id] = audioUrl;

            setAudioUrls((previous) => ({
              ...previous,
              [message.id]: audioUrl,
            }));
          } catch (audioError) {
            loadedAudioRef.current.delete(message.id);
            console.error("Conversation audio error:", audioError);
          }
        }
      } catch (err) {
        if (active) {
          setError(err.message || "Unable to refresh conversation.");
        }
      }
    }

    refreshRoom();

    const intervalId = window.setInterval(refreshRoom, 3000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [room]);

  function clearPreview() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setPreviewUrl("");
    setRecordedFile(null);
  }

  function saveRecording(file) {
    clearPreview();

    setRecordedFile(file);
    setPreviewUrl(URL.createObjectURL(file));

    setError("");
    setSuccess("Your audio is ready to send.");
  }

  async function createRoom() {
    if (!displayName.trim()) {
      setError("Enter your name first.");
      return;
    }

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch(
        `${API_URL}/api/conversations`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            display_name: displayName.trim(),
            language: selectedLanguage,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.detail || "Could not create room.");
      }

      setRoom({
        roomCode: result.room_code,
        participantId: result.participant_id,
        token: result.participant_token,
        language: result.your_language,
      });

      setPartner(null);
      setMessages([]);
      setSuccess("Conversation room created. Share your room code!");
    } catch (err) {
      setError(err.message || "Unable to create room.");
    } finally {
      setBusy(false);
    }
  }

  async function joinRoom() {
    if (!displayName.trim()) {
      setError("Enter your name first.");
      return;
    }

    if (!roomCodeInput.trim()) {
      setError("Enter the conversation room code.");
      return;
    }

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const code = roomCodeInput.trim().toUpperCase();

      const response = await fetch(
        `${API_URL}/api/conversations/${encodeURIComponent(code)}/join`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            display_name: displayName.trim(),
            language: selectedLanguage,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.detail || "Could not join room.");
      }

      setRoom({
        roomCode: result.room_code,
        participantId: result.participant_id,
        token: result.participant_token,
        language: result.your_language,
      });

      setPartner(result.other_person);
      setMessages([]);

      setSuccess("You have joined the conversation!");
    } catch (err) {
      setError(err.message || "Unable to join room.");
    } finally {
      setBusy(false);
    }
  }

  async function startRecording() {
    setError("");
    setSuccess("");

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Microphone access is unavailable in this browser.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      streamRef.current = stream;
      chunksRef.current = [];

      const mimeType = MediaRecorder.isTypeSupported(
        "audio/webm;codecs=opus"
      )
        ? "audio/webm;codecs=opus"
        : "";

      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : {}
      );

      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        try {
          const blob = new Blob(chunksRef.current, {
            type: recorder.mimeType,
          });

          if (!blob.size) {
            throw new Error("No audio recorded.");
          }

          const wavFile = await convertToWav(blob);

          saveRecording(wavFile);
        } catch (err) {
          setError(err.message || "Could not process recording.");
        } finally {
          stream.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
          setIsRecording(false);
        }
      };

      recorder.start();

      setIsRecording(true);
      setSuccess("Recording started. Speak now.");
    } catch (err) {
      setError(err.message || "Could not access microphone.");
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }

  function handleFileChange(event) {
    const file = event.target.files?.[0];

    if (!file) return;

    const allowedExtensions = [
      ".wav",
      ".mp3",
      ".ogg",
      ".flac",
      ".aac",
      ".m4a",
    ];

    const extension = file.name
      .slice(file.name.lastIndexOf("."))
      .toLowerCase();

    if (!allowedExtensions.includes(extension)) {
      setError("Upload WAV, MP3, OGG, FLAC, AAC or M4A audio.");
      event.target.value = "";
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError("Audio must be smaller than 10 MB.");
      event.target.value = "";
      return;
    }

    saveRecording(file);
    event.target.value = "";
  }

  async function processAndSend() {
    if (!room) {
      setError("Create or join a room first.");
      return;
    }

    if (!partner) {
      setError("Waiting for the other person to join.");
      return;
    }

    if (!recordedFile) {
      setError("Record or upload an audio message first.");
      return;
    }

    setIsProcessing(true);
    setError("");
    setSuccess("");

    try {
      // STEP 1: Recognize the sender's speech with Gnani Prisma.
      const formData = new FormData();

      formData.append("audio_file", recordedFile, recordedFile.name);
      formData.append("language_code", room.language);

      const sttResponse = await fetch(
        `${API_URL}/api/speech-to-text`,
        {
          method: "POST",
          body: formData,
        }
      );

      const sttResult = await sttResponse.json();

      if (!sttResponse.ok) {
        throw new Error(sttResult.detail || "Speech recognition failed.");
      }

      const originalText = (
        sttResult.original_text ||
        sttResult.transcript ||
        ""
      ).trim();

      if (!originalText) {
        throw new Error("No speech was recognized.");
      }

      // STEP 2: Translate into the partner's selected language.
      const translationResponse = await fetch(
        `${API_URL}/api/translate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: originalText,
            source_language: room.language,
            target_language: partner.language,
          }),
        }
      );

      const translationResult = await translationResponse.json();

      if (!translationResponse.ok) {
        throw new Error(
          translationResult.detail || "Translation failed."
        );
      }

      const translatedText = (
        translationResult.translated_text || ""
      ).trim();

      if (!translatedText) {
        throw new Error("Translation returned empty text.");
      }

      setSuccess("Translation ready. Generating voice...");

      // STEP 3: Generate audio in the partner's language.
      const ttsResponse = await fetch(
        `${API_URL}/api/text-to-speech`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: translatedText,
            language: partner.language,
            voice: "Lakshmi",
          }),
        }
      );

      if (!ttsResponse.ok) {
        const ttsError = await ttsResponse.json().catch(() => ({}));

        throw new Error(
          ttsError.detail || "Voice generation failed."
        );
      }

      const translatedAudio = await ttsResponse.blob();

      if (!translatedAudio.size) {
        throw new Error("Generated voice audio is empty.");
      }

      // STEP 4: Send original text, translation and generated audio.
      const messageData = new FormData();

      messageData.append("original_text", originalText);
      messageData.append("translated_text", translatedText);
      messageData.append("source_language", room.language);
      messageData.append("target_language", partner.language);

      messageData.append(
        "audio_file",
        translatedAudio,
        "translated-voice.wav"
      );

      const sendResponse = await fetch(
        `${API_URL}/api/conversations/${room.roomCode}/messages`,
        {
          method: "POST",
          headers: {
            "X-Participant-Token": room.token,
          },
          body: messageData,
        }
      );

      const sendResult = await sendResponse.json();

      if (!sendResponse.ok) {
        throw new Error(sendResult.detail || "Message delivery failed.");
      }

      clearPreview();

      setSuccess(
        `Your ${LANGUAGE_NAMES[partner.language]} voice message was sent!`
      );
    } catch (err) {
      setError(err.message || "Unable to send conversation message.");
    } finally {
      setIsProcessing(false);
    }
  }

  async function copyRoomCode() {
    try {
      await navigator.clipboard.writeText(room.roomCode);
      setSuccess("Room code copied!");
    } catch {
      setError("Unable to copy. Please select the room code manually.");
    }
  }

  function leaveRoom() {
    setRoom(null);
    setPartner(null);
    setMessages([]);
    setAudioUrls({});
    loadedAudioRef.current.clear();

    clearPreview();

    setError("");
    setSuccess("You left the conversation.");
  }

  // ROOM CREATION AND JOINING SCREEN
  if (!room) {
    return (
      <section className="translator-card conversation-room">
        <div className="section-heading">
          <h2>Start a Conversation</h2>
          <p>
            Talk naturally in your language. Let MANA VOICE AI
            translate for the other person.
          </p>
        </div>

        <div className="room-form">
          <label>Your Name</label>

          <input
            className="room-input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Enter your name"
            maxLength={40}
          />

          <label>Your Spoken Language</label>

          <select
            className="room-input"
            value={selectedLanguage}
            onChange={(e) => setSelectedLanguage(e.target.value)}
          >
            {Object.entries(LANGUAGES).map(([name, code]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>

          <div className="room-actions">
            <button
              className="send-button"
              onClick={createRoom}
              disabled={busy}
            >
              {busy ? "Creating..." : "＋ Create New Room"}
            </button>

            <div className="room-divider">
              OR JOIN AN EXISTING ROOM
            </div>

            <input
              className="room-input"
              value={roomCodeInput}
              onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
              placeholder="Enter 10-character room code"
              maxLength={10}
            />

            <button
              className="transcribe-button"
              onClick={joinRoom}
              disabled={busy}
            >
              {busy ? "Joining..." : "Join Conversation →"}
            </button>
          </div>
        </div>

        {error && <p className="error-message">{error}</p>}
        {success && <p className="success-message">{success}</p>}
      </section>
    );
  }

  // ACTIVE CONVERSATION SCREEN
  return (
    <section className="translator-card conversation-room">
      <div className="active-room-header">
        <div>
          <span className="message-language">CONVERSATION ROOM</span>
          <h2>{room.roomCode}</h2>
          <p>
            You: {LANGUAGE_NAMES[room.language]}
          </p>
        </div>

        <button className="upload-button" onClick={copyRoomCode}>
          Copy Code
        </button>
      </div>

      <div className="partner-status">
        <span className={`status-dot ${partner ? "" : "waiting-dot"}`}></span>

        {partner
          ? `${partner.display_name} joined · ${LANGUAGE_NAMES[partner.language]}`
          : "Waiting for the other person to join..."}
      </div>

      <div className="conversation-feed">
        {messages.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">💬</div>
            <h3>Your conversation starts here</h3>
            <p>
              Share your room code and start exchanging translated
              voice messages.
            </p>
          </div>
        ) : (
          messages.map((message) => {
            const isMine = message.sender_id === room.participantId;

            return (
              <article
                className={`room-message ${isMine ? "mine" : "theirs"}`}
                key={message.id}
              >
                <span className="message-language">
                  {message.sender_name} ·{" "}
                  {isMine ? "You" : "Other participant"}
                </span>

                <p className="room-original">
                  {message.original_text}
                </p>

                <div className="room-translation">
                  <span>
                    Translated into {LANGUAGE_NAMES[message.target_language]}
                  </span>
                  <p>{message.translated_text}</p>
                </div>

                {audioUrls[message.id] ? (
                  <audio controls src={audioUrls[message.id]} />
                ) : (
                  <span className="translation-status">
                    Loading translated voice...
                  </span>
                )}

                <time>
                  {new Date(message.created_at).toLocaleTimeString()}
                </time>
              </article>
            );
          })
        )}
      </div>

      <div className="room-composer">
        <h3>Send a Voice Message</h3>

        {partner ? (
          <p>
            Speak {LANGUAGE_NAMES[room.language]}.
            The other participant will hear{" "}
            {LANGUAGE_NAMES[partner.language]}.
          </p>
        ) : (
          <p>Wait for another participant before sending a message.</p>
        )}

        {recordedFile && (
          <div className="recording-preview">
            <p>{recordedFile.name}</p>
            {previewUrl && <audio controls src={previewUrl} />}
            <button className="upload-button" onClick={clearPreview}>
              Remove Audio
            </button>
          </div>
        )}

        <div className="record-controls">
          {!isRecording ? (
            <button
              className="send-button"
              onClick={startRecording}
              disabled={!partner || isProcessing}
            >
              🎤 Start Recording
            </button>
          ) : (
            <button
              className="stop-button"
              onClick={stopRecording}
            >
              ■ Stop Recording
            </button>
          )}

          <label className="upload-button room-upload">
            📁 Upload Audio
            <input
              type="file"
              accept=".wav,.mp3,.ogg,.flac,.aac,.m4a"
              hidden
              disabled={!partner || isRecording || isProcessing}
              onChange={handleFileChange}
            />
          </label>
        </div>

        <button
          className="transcribe-button"
          onClick={processAndSend}
          disabled={!recordedFile || !partner || isRecording || isProcessing}
        >
          {isProcessing
            ? "Translating and sending..."
            : "Translate & Send Voice →"}
        </button>

        {error && <p className="error-message">{error}</p>}
        {success && <p className="success-message">{success}</p>}

        <button className="leave-room-button" onClick={leaveRoom}>
          Leave Conversation
        </button>
      </div>
    </section>
  );
}

export default ConversationRoom;
