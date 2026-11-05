# 🌐 ManaVoice AI — Real-Time Multilingual Voice Communication

**Breaking language barriers through AI-powered voice communication.**

ManaVoice AI is a real-time multilingual voice-to-voice communication platform that enables two people speaking different languages to communicate naturally.

The application combines speech recognition, local language translation, and AI-powered voice generation to convert one participant's spoken words into audio in the other participant's preferred language.

Instead of manually translating messages, participants can speak through a shared conversation room and hear translated speech from the other person.

---

## ✨ Key Features

- 🎙️ **Live Speech Recognition:** Converts spoken audio into text using Gnani Prisma.
- 🌍 **Multilingual Communication:** Allows participants to select their preferred languages.
- 🔄 **Local Translation:** Translates recognized speech into the recipient's selected language.
- 🔊 **AI Voice Generation:** Generates natural audio from translated text using the Timbre TTS REST API.
- 👥 **Two-Person Conversation Rooms:** Enables two participants to communicate through a shared room.
- ⚡ **Live Communication:** Uses WebSockets for conversation event exchange.
- 🔁 **Two-Way Translation:** Supports communication in both directions.
- 🎧 **Translated Audio Playback:** Automatically plays the generated translated voice for completed speech segments.

> **Audio implementation:** Speech is processed segment by segment. Once a speech segment is completed, its translated audio is generated and played back.

---

## 🧠 How ManaVoice AI Works

ManaVoice AI follows a speech-to-speech translation pipeline.

### System Architecture

```text
          PARTICIPANT A
                |
                | Speaks
                v
       Speech Recognition
          Gnani Prisma
                |
                v
        Recognized Text
                |
                v
       Local Translation
                |
                v
        Translated Text
                |
                v
        Timbre TTS API
                |
                v
        Generated Audio
                |
                v
      PARTICIPANT B HEARS
       TRANSLATED SPEECH


       Same process works
       in the reverse direction.
```

### Communication Workflow

1. Two participants join the same conversation room.
2. Each participant selects their preferred speaking and receiving languages.
3. When a participant speaks, the application captures their speech.
4. Gnani Prisma processes the speech and converts it into text.
5. The recognized text is translated into the recipient's selected language.
6. The translated text is sent to the Timbre TTS REST API.
7. The generated WAV audio is played to the other participant.
8. The same process enables communication in the opposite direction.

---

## 🛠️ Technology Stack

| Technology | Purpose |
|---|---|
| React.js | Frontend user interface |
| JavaScript | Frontend application logic |
| CSS | Interface styling |
| Python | Backend development |
| FastAPI | Backend API framework |
| WebSockets | Live communication |
| Gnani Prisma | Speech-to-text recognition |
| Local Translation | Language translation |
| Timbre TTS REST API | Text-to-speech generation |
| WAV Audio | Generated translated voice playback |

---

## 📁 Project Structure

```text
ManaVoice-AI/
│
├── backend/
│   ├── main.py
│   ├── requirements.txt
│   └── ...
│
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── LiveConversation.jsx
│   │   ├── ConversationRoom.jsx
│   │   └── ...
│   │
│   ├── package.json
│   └── ...
│
└── README.md
```

---

## 🚀 Getting Started

Follow these instructions to run ManaVoice AI locally.

### Prerequisites

Make sure you have installed:

- Python 3.10+
- Node.js and npm
- Git
- A modern web browser
- Required API credentials for speech recognition and voice generation

### 1. Clone the Repository

```bash
git clone https://github.com/vijjapunandini-ops/ManaVoice-AI.git

cd ManaVoice-AI
```

### 2. Backend Setup

Navigate to the backend directory:

```bash
cd backend
```

Create a Python virtual environment:

**Windows:**

```bash
python -m venv .venv

.venv\Scripts\activate
```

**Linux / macOS:**

```bash
python3 -m venv .venv

source .venv/bin/activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Configure the required API credentials using the environment variable names expected by the backend. Keep credentials in a private `.env` file.

Start the backend:

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Backend address:

```text
http://127.0.0.1:8000
```

### 3. Frontend Setup

Open another terminal and navigate to the frontend directory:

```bash
cd frontend
```

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open the local URL displayed in your terminal.

### 4. Start a Conversation

1. Keep both frontend and backend servers running.
2. Open the application in two browser sessions or devices.
3. Allow microphone permissions.
4. Join the same conversation room.
5. Select different languages for the participants.
6. Start speaking and experience translated voice playback.

---

## 🔐 Security and API Configuration

ManaVoice AI integrates with external speech-processing services.

For secure configuration:

- Store API credentials in backend environment variables.
- Never expose secret credentials in frontend JavaScript.
- Do not commit `.env` files or API keys to GitHub.
- Use `.gitignore` to protect private configuration files.
- Be transparent with conversation participants about external audio processing.

---

## 🔮 Future Enhancements

Potential improvements for future versions:

- Continuous streaming speech translation.
- More language options and regional dialect support.
- Conversation history and translated transcripts.
- Better handling of background noise.
- Improved speech recognition for different accents.
- Reduced translation and audio-generation latency.
- Additional speech recognition and voice-generation providers.

---

## 👩‍💻 About the Developer

**Vijjapu Nandini**

B.Tech — Computer Science and Engineering (Artificial Intelligence)

Interested in Artificial Intelligence, Machine Learning, Generative AI, and building practical AI-powered applications.

**GitHub:** https://github.com/vijjapunandini-ops

---

## ⭐ Support

If you find ManaVoice AI interesting, consider giving this repository a ⭐.

Suggestions, feedback, and contributions are always welcome!

**ManaVoice AI — Making language-independent communication possible through AI.**
