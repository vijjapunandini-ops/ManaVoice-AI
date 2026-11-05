import { useEffect, useRef, useState } from "react";
import "./LiveConversation.css";



const LANGUAGES = [
  { code: "te-IN", name: "Telugu" },
  { code: "hi-IN", name: "Hindi" },
  { code: "en-IN", name: "English" },
];

function getLanguageName(code) {
  return LANGUAGES.find((item) => item.code === code)?.name || code;
}

// ==================================================
// BASE64 TO BYTE ARRAY
// ==================================================

function base64ToBytes(base64) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

// ==================================================
// LIVE CONVERSATION COMPONENT
// ==================================================

export default function LiveConversation() {
  const [language, setLanguage] = useState("te-IN");
  const [joinCode, setJoinCode] = useState("");
  const [room, setRoom] = useState(null);

  const [socketReady, setSocketReady] = useState(false);
  const [partnerJoined, setPartnerJoined] = useState(false);
  const [isMicOn, setIsMicOn] = useState(false);

  const [status, setStatus] = useState(
    "Create a room or join an existing room."
  );

  const [error, setError] = useState("");
  const [messages, setMessages] = useState([]);

  const socketRef = useRef(null);
  const audioContextRef = useRef(null);

  const microphoneStreamRef = useRef(null);
  const microphoneSourceRef = useRef(null);

  const workletRef = useRef(null);
  const muteGainRef = useRef(null);

  const nextPlaybackTimeRef = useRef(0);
  const playbackQueueRef = useRef(Promise.resolve());

  const endingCallRef = useRef(false);

  // ==================================================
  // ADD A MESSAGE
  // ==================================================

  function addMessage(kind, text) {
    setMessages((previous) =>
      [
        ...previous,
        {
          id: `${Date.now()}-${Math.random()}`,
          kind,
          text,
        },
      ].slice(-30)
    );
  }

  // ==================================================
  // PLAY WAV AUDIO
  // ==================================================

  async function playWavAudio(base64Audio) {
    if (!base64Audio) {
      throw new Error("No audio data was received.");
    }

    let context = audioContextRef.current;

    if (!context || context.state === "closed") {
      context = new AudioContext({
        sampleRate: 48000,
      });

      audioContextRef.current = context;
    }

    if (context.state !== "running") {
      await context.resume();
    }

    const bytes = base64ToBytes(base64Audio);

    const audioData = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    );

    const audioBuffer = await context.decodeAudioData(audioData);

    if (audioBuffer.length === 0) {
      throw new Error("The received audio is empty.");
    }

    const source = context.createBufferSource();

    source.buffer = audioBuffer;
    source.connect(context.destination);

    const startAt = Math.max(
      context.currentTime + 0.03,
      nextPlaybackTimeRef.current
    );

    source.start(startAt);

    nextPlaybackTimeRef.current =
      startAt + audioBuffer.duration;

    console.log(
      "Playing translated voice:",
      audioBuffer.duration,
      "seconds"
    );
  }

  // ==================================================
  // QUEUE AUDIO PLAYBACK
  // ==================================================

  function queueWavPlayback(base64Audio) {
    playbackQueueRef.current =
      playbackQueueRef.current
        .then(() => playWavAudio(base64Audio))
        .catch((playError) => {
          console.error(
            "Translated audio playback failed:",
            playError
          );

          setError(
            "Audio playback failed: " + playError.message
          );
        });
  }

  // ==================================================
  // HANDLE WEBSOCKET MESSAGES
  // ==================================================

  function handleSocketMessage(event) {
    let message;

    try {
      message = JSON.parse(event.data);
    } catch (parseError) {
      console.error("Invalid server message:", parseError);
      return;
    }

    switch (message.type) {
      case "ready":
        setSocketReady(true);
        setStatus(
          "Connected. Waiting for the other participant."
        );
        break;

      case "waiting_for_partner":
        setStatus(
          "Room created. Share the room code with the other person."
        );
        break;

      case "partner_joined":
        setPartnerJoined(true);
        setStatus(
          "Both participants are connected. Start your microphones."
        );
        break;

      case "partner_left":
        setPartnerJoined(false);
        setStatus("The other participant disconnected.");
        break;

      case "transcript":
        addMessage(
          "outgoing",
          `You said: ${message.original_text}`
        );
        break;

      case "translation":
        addMessage(
          "incoming",
          `Translated for you: ${message.translated_text}`
        );
        break;

      case "audio_wav":
        console.log("Received translated WAV audio.");
        queueWavPlayback(message.audio);

        setStatus(
          "Translated voice received. Playing audio..."
        );
        break;

      case "error":
        console.error("Live server error:", message.message);

        setError(
          message.message || "An unknown live error occurred."
        );
        break;

      default:
        console.log("Unknown WebSocket message:", message);
        break;
    }
  }

  // ==================================================
  // CONNECT TO LIVE ROOM
  // ==================================================

  function connectToRoom(roomData) {
    endingCallRef.current = false;

    const socketUrl =
      `${WS_URL}/ws/live/` +
      `${roomData.room_code}/` +
      `${roomData.participant_token}`;

    const socket = new WebSocket(socketUrl);

    socketRef.current = socket;

    socket.onopen = () => {
      console.log("Live WebSocket connected.");

      setStatus(
        "Connected to the live server. Checking the other participant..."
      );
    };

    socket.onmessage = handleSocketMessage;

    socket.onerror = (event) => {
      console.error("Browser WebSocket error:", event);

      setError(
        "Live connection error. Check that FastAPI is running."
      );
    };

    socket.onclose = (event) => {
      console.log(
        "Live WebSocket closed:",
        event.code,
        event.reason
      );

      setSocketReady(false);
      setPartnerJoined(false);

      if (!endingCallRef.current) {
        setStatus(
          "Live connection closed. Please reconnect."
        );
      }
    };
  }

  // ==================================================
  // CREATE A ROOM
  // ==================================================

  async function createRoom() {
    setError("");

    try {
      const response = await fetch(
        `${API_URL}/api/live/rooms`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            language,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.detail || "Could not create room."
        );
      }

      setRoom(result);
      setMessages([]);

      setSocketReady(false);
      setPartnerJoined(false);

      setStatus("Room created. Connecting...");

      connectToRoom(result);
    } catch (requestError) {
      console.error("Room creation error:", requestError);

      setError(
        requestError.message || "Could not create room."
      );
    }
  }

  // ==================================================
  // JOIN A ROOM
  // ==================================================

  async function joinRoom() {
    setError("");

    const code = joinCode.trim().toUpperCase();

    if (!code) {
      setError("Please enter the room code.");
      return;
    }

    try {
      const response = await fetch(
        `${API_URL}/api/live/rooms/${encodeURIComponent(code)}/join`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            language,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.detail || "Could not join room."
        );
      }

      setRoom(result);
      setMessages([]);

      setSocketReady(false);
      setPartnerJoined(false);

      setStatus("Joined room. Connecting...");

      connectToRoom(result);
    } catch (requestError) {
      console.error("Join room error:", requestError);

      setError(
        requestError.message || "Could not join room."
      );
    }
  }

  // ==================================================
  // START MICROPHONE
  // ==================================================

  async function startMicrophone() {
    setError("");

    if (!socketReady) {
      setError(
        "The live server connection is not ready yet."
      );
      return;
    }

    if (!partnerJoined) {
      setError(
        "Wait until the other participant joins the room."
      );
      return;
    }

    let stream = null;
    let source = null;
    let worklet = null;
    let muteGain = null;

    let context = audioContextRef.current;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          "Microphone access is unavailable. Use localhost or HTTPS."
        );
      }

      if (!context || context.state === "closed") {
        context = new AudioContext({
          sampleRate: 48000,
        });

        audioContextRef.current = context;
      }

      if (context.sampleRate !== 48000) {
        throw new Error(
          `Expected 48 kHz audio, but received ${context.sampleRate} Hz.`
        );
      }

      await context.resume();

      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      await context.audioWorklet.addModule(
        "/live-pcm-processor.js"
      );

      source = context.createMediaStreamSource(stream);

      worklet = new AudioWorkletNode(
        context,
        "live-pcm-processor",
        {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        }
      );

      muteGain = context.createGain();
      muteGain.gain.value = 0;

      worklet.port.onmessage = (event) => {
        const socket = socketRef.current;

        if (
          socket &&
          socket.readyState === WebSocket.OPEN &&
          event.data instanceof ArrayBuffer
        ) {
          if (socket.bufferedAmount < 256 * 1024) {
            socket.send(event.data);
          } else {
            console.warn(
              "Microphone WebSocket buffer is full. Skipping a frame."
            );
          }
        }
      };

      source.connect(worklet);
      worklet.connect(muteGain);
      muteGain.connect(context.destination);

      microphoneStreamRef.current = stream;
      microphoneSourceRef.current = source;

      workletRef.current = worklet;
      muteGainRef.current = muteGain;

      nextPlaybackTimeRef.current = context.currentTime;

      setIsMicOn(true);

      setStatus(
        "Microphone is active. Speak naturally."
      );
    } catch (micError) {
      console.error("Microphone startup error:", micError);

      stream?.getTracks().forEach(
        (track) => track.stop()
      );

      source?.disconnect();
      worklet?.disconnect();
      muteGain?.disconnect();

      setError(
        micError.message || "Could not start the microphone."
      );
    }
  }

  // ==================================================
  // STOP MICROPHONE
  // ==================================================

  function stopMicrophone() {
    const socket = socketRef.current;

    if (
      socket &&
      socket.readyState === WebSocket.OPEN
    ) {
      socket.send(
        JSON.stringify({
          type: "commit",
        })
      );
    }

    microphoneStreamRef.current
      ?.getTracks()
      .forEach((track) => track.stop());

    microphoneSourceRef.current?.disconnect();

    if (workletRef.current?.port) {
      workletRef.current.port.onmessage = null;
    }

    workletRef.current?.disconnect();
    muteGainRef.current?.disconnect();

    microphoneStreamRef.current = null;
    microphoneSourceRef.current = null;

    workletRef.current = null;
    muteGainRef.current = null;

    setIsMicOn(false);

    setStatus(
      "Microphone paused. You can start it again."
    );
  }

  // ==================================================
  // END CALL
  // ==================================================

  async function endCall() {
    endingCallRef.current = true;

    if (isMicOn) {
      stopMicrophone();
    }

    const socket = socketRef.current;
    socketRef.current = null;

    if (socket) {
      socket.close();
    }

    microphoneStreamRef.current
      ?.getTracks()
      .forEach((track) => track.stop());

    microphoneStreamRef.current = null;

    if (
      audioContextRef.current &&
      audioContextRef.current.state !== "closed"
    ) {
      await audioContextRef.current.close();
    }

    audioContextRef.current = null;

    nextPlaybackTimeRef.current = 0;
    playbackQueueRef.current = Promise.resolve();

    setRoom(null);

    setSocketReady(false);
    setPartnerJoined(false);
    setIsMicOn(false);

    setMessages([]);
    setError("");

    setStatus(
      "Call ended. Create or join another room to start again."
    );
  }

  // ==================================================
  // CLEANUP
  // ==================================================

  useEffect(() => {
    return () => {
      endingCallRef.current = true;

      socketRef.current?.close();

      microphoneStreamRef.current
        ?.getTracks()
        .forEach((track) => track.stop());

      microphoneSourceRef.current?.disconnect();

      if (workletRef.current?.port) {
        workletRef.current.port.onmessage = null;
      }

      workletRef.current?.disconnect();
      muteGainRef.current?.disconnect();

      if (
        audioContextRef.current &&
        audioContextRef.current.state !== "closed"
      ) {
        audioContextRef.current.close();
      }
    };
  }, []);

  // ==================================================
  // USER INTERFACE
  // ==================================================

  return (
    <section className="live-panel">

      <div className="live-panel-heading">

        <div>
          <p className="live-eyebrow">
            REAL-TIME MODE
          </p>

          <h2>
            Live two-way voice translation
          </h2>

          <p>
            Both people can speak in their own language.
            Translated text and voice are delivered automatically.
          </p>
        </div>

        <span
          className={`live-indicator ${isMicOn ? "active" : ""}`}
        >
          {isMicOn ? "MIC LIVE" : "NOT LIVE"}
        </span>

      </div>

      {!room ? (

        <div className="live-setup">

          <label className="live-field">
            <span>Your spoken language</span>

            <select
              value={language}
              onChange={(event) =>
                setLanguage(event.target.value)
              }
            >
              {LANGUAGES.map((item) => (
                <option
                  key={item.code}
                  value={item.code}
                >
                  {item.name}
                </option>
              ))}
            </select>
          </label>

          <button
            className="live-primary-button"
            onClick={createRoom}
          >
            Create a room
          </button>

          <div className="live-divider">
            <span>OR JOIN A ROOM</span>
          </div>

          <label className="live-field">
            <span>Room code</span>

            <input
              value={joinCode}
              onChange={(event) =>
                setJoinCode(
                  event.target.value.toUpperCase()
                )
              }
              placeholder="Enter the 6-character code"
              maxLength={6}
            />
          </label>

          <button
            className="live-secondary-button"
            onClick={joinRoom}
          >
            Join room
          </button>

        </div>

      ) : (

        <div className="live-room">

          <div className="live-room-info">

            <div>
              <span className="live-muted-label">
                ROOM CODE
              </span>

              <strong className="live-room-code">
                {room.room_code}
              </strong>

              <span className="live-muted-label">
                Your language: {getLanguageName(room.language)}
              </span>
            </div>

            <button
              className="live-copy-button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    room.room_code
                  );

                  setStatus("Room code copied.");
                } catch {
                  setError(
                    "Could not copy the room code. Please copy it manually."
                  );
                }
              }}
            >
              Copy code
            </button>

          </div>

          <p className="live-status">
            {status}
          </p>

          <div className="live-call-controls">

            {!isMicOn ? (

              <button
                className="live-primary-button"
                onClick={startMicrophone}
                disabled={!socketReady || !partnerJoined}
              >
                Start microphone
              </button>

            ) : (

              <button
                className="live-secondary-button"
                onClick={stopMicrophone}
              >
                Pause microphone
              </button>

            )}

            <button
              className="live-end-button"
              onClick={endCall}
            >
              End call
            </button>

          </div>

          <div className="live-message-list">

            {messages.length === 0 ? (

              <p className="live-empty">
                Your conversation transcripts will appear here.
              </p>

            ) : (

              messages.map((message) => (
                <div
                  className={`live-message ${message.kind}`}
                  key={message.id}
                >
                  {message.text}
                </div>
              ))

            )}

          </div>

        </div>

      )}

      {error && (
        <p className="live-error">
          {error}
        </p>
      )}

    </section>
  );
}
