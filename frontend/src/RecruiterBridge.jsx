import RecruiterBridge from "./RecruiterBridge.jsx";
import { useState } from "react";

const API_URL = "http://127.0.0.1:8000";

function RecruiterBridge({
  originalText,
  translatedText,
  generatedVoiceUrl,
  generatedVoiceText
}) {
  const [mode, setMode] = useState("candidate");

  const [sessionCode, setSessionCode] = useState("");
  const [joinCode, setJoinCode] = useState("");

  const [messages, setMessages] = useState([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function createSession() {
    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch(
        `${API_URL}/api/recruiter/sessions`,
        {
          method: "POST"
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.detail || "Could not create session.");
      }

      setSessionCode(result.session_code);

      setSuccess("Recruiter session created successfully!");

    } catch (err) {
      setError(err.message || "Unable to create recruiter session.");
    } finally {
      setBusy(false);
    }
  }

  async function sendToRecruiter() {
    if (!sessionCode) {
      setError("Create a recruiter session first.");
      return;
    }

    if (!originalText.trim() || !translatedText.trim()) {
      setError("Complete speech recognition and translation first.");
      return;
    }

    if (!generatedVoiceUrl) {
      setError("Generate the translated voice first.");
      return;
    }

    if (generatedVoiceText !== translatedText.trim()) {
      setError(
        "The audio does not match the current translation. Generate the voice again."
      );
      return;
    }

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      // Read the generated audio
      const audioResponse = await fetch(generatedVoiceUrl);
      const audioBlob = await audioResponse.blob();

      if (!audioBlob.size) {
        throw new Error("Generated audio is empty.");
      }

      const formData = new FormData();

      formData.append("original_text", originalText);
      formData.append("translated_text", translatedText.trim());

      formData.append(
        "audio_file",
        audioBlob,
        "translated-voice.wav"
      );

      const response = await fetch(
        `${API_URL}/api/recruiter/sessions/${sessionCode}/messages`,
        {
          method: "POST",
          body: formData
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.detail || "Could not send message.");
      }

      setSuccess("Your approved English voice was sent to the recruiter!");

    } catch (err) {
      setError(err.message || "Unable to send message.");
    } finally {
      setBusy(false);
    }
  }

  async function loadSession() {
    const code = joinCode.trim().toUpperCase();

    if (!code) {
      setError("Enter the recruiter session code.");
      return;
    }

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch(
        `${API_URL}/api/recruiter/sessions/${encodeURIComponent(code)}`
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.detail || "Session not found.");
      }

      setMessages(result.messages || []);
      setJoinCode(code);

      setSuccess("Recruiter conversation loaded!");

    } catch (err) {
      setError(err.message || "Unable to load recruiter messages.");
      setMessages([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="translator-card bridge-card">

      <div className="section-heading">
        <h2>Recruiter Bridge</h2>

        <p>
          Connect candidates and recruiters without language barriers.
        </p>
      </div>

      {/* Switch between candidate and recruiter */}

      <div className="bridge-tabs">

        <button
          className={mode === "candidate" ? "bridge-tab active" : "bridge-tab"}
          onClick={() => {
            setMode("candidate");
            setError("");
            setSuccess("");
          }}
        >
          👤 Candidate View
        </button>

        <button
          className={mode === "recruiter" ? "bridge-tab active" : "bridge-tab"}
          onClick={() => {
            setMode("recruiter");
            setError("");
            setSuccess("");
          }}
        >
          💼 Recruiter View
        </button>

      </div>

      {mode === "candidate" ? (

        <div className="bridge-panel">

          <h3>Send your response to a recruiter</h3>

          <p className="bridge-description">
            Review your English translation and generated voice.
            Create a session and share your approved response.
          </p>

          <div className="bridge-preview">

            <span>ORIGINAL MESSAGE</span>

            <p>
              {originalText || "Your original speech will appear here."}
            </p>

          </div>

          <div className="bridge-preview">

            <span>APPROVED ENGLISH MESSAGE</span>

            <p>
              {translatedText || "Your English translation will appear here."}
            </p>

          </div>

          <div className="bridge-preview">

            <span>VOICE STATUS</span>

            <p>
              {generatedVoiceUrl
                ? "English voice is ready."
                : "Generate translated voice before sending."}
            </p>

          </div>

          <button
            className="send-button bridge-action"
            onClick={createSession}
            disabled={busy}
          >
            {busy ? "Creating..." : "Create Recruiter Session"}
          </button>

          {sessionCode && (

            <div className="bridge-code-box">

              <span>YOUR RECRUITER SESSION CODE</span>

              <strong>{sessionCode}</strong>

              <p>
                Share this code privately with your recruiter.
              </p>

            </div>

          )}

          <button
            className="transcribe-button bridge-action"
            onClick={sendToRecruiter}
            disabled={
              busy ||
              !sessionCode ||
              !originalText.trim() ||
              !translatedText.trim() ||
              !generatedVoiceUrl ||
              generatedVoiceText !== translatedText.trim()
            }
          >
            {busy ? "Sending..." : "Send Approved Response →"}
          </button>

        </div>

      ) : (

        <div className="bridge-panel">

          <h3>Recruiter Message Inbox</h3>

          <p className="bridge-description">
            Enter the session code shared by the candidate.
          </p>

          <div className="bridge-join">

            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="Enter recruiter session code"
              maxLength={20}
            />

            <button
              className="send-button"
              onClick={loadSession}
              disabled={busy}
            >
              {busy ? "Loading..." : "Open Session"}
            </button>

          </div>

          <div className="bridge-inbox">

            {messages.length === 0 ? (

              <div className="empty-state">
                <div className="empty-icon">📨</div>
                <h3>No messages loaded</h3>
                <p>
                  Enter a valid candidate session code to view messages.
                </p>
              </div>

            ) : (

              messages.map((message) => (

                <div className="bridge-message" key={message.id}>

                  <span className="message-language">
                    CANDIDATE MESSAGE
                  </span>

                  <h4>Original speech</h4>

                  <p>{message.original_text}</p>

                  <h4>English translation</h4>

                  <p>{message.translated_text}</p>

                  <h4>Translated English voice</h4>

                  <audio
                    controls
                    src={`${API_URL}${message.audio_url}`}
                  />

                  <span className="translation-status">
                    Sent: {new Date(message.created_at).toLocaleString()}
                  </span>

                </div>

              ))

            )}

          </div>

          <button
            className="upload-button bridge-action"
            onClick={loadSession}
            disabled={busy || !joinCode.trim()}
          >
            ↻ Refresh Messages
          </button>

        </div>

      )}

      {error && (
        <p className="error-message">{error}</p>
      )}

      {success && (
        <p className="success-message">{success}</p>
      )}

      <p className="bridge-privacy">
        Prototype note: Anyone with the session code can view its messages.
        Share it only with the intended recruiter. Sessions are temporary
        and cleared when the backend restarts.
      </p>

    </section>
  );
}

export default RecruiterBridge;
