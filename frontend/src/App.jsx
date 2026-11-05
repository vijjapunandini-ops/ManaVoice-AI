import LiveConversation from "./LiveConversation.jsx";
import ConversationRoom from "./ConversationRoom.jsx";
import "./App.css";

function App() {
  return (
    <div className="app">

      <nav className="navbar">
        <div className="logo">
          <span className="logo-icon">M</span>
          <span>MANA VOICE AI</span>
        </div>

        <div className="nav-right">
          <span className="status-dot"></span>
          <span>Universal Voice Translation</span>
        </div>
      </nav>

      <main className="main-container">

        <section className="hero">
          <p className="tag">
            BREAK LANGUAGE BARRIERS
          </p>

          <h1>
            Your Language Should Never
            <span> Limit Your Potential.</span>
          </h1>

          <p className="subtitle">
            Two people. Two languages. One conversation.
            Speak naturally and let MANA VOICE AI translate your voice.
          </p>
        </section>

        {/* NEW: Live Conversation Component */}
        <LiveConversation />

        {/* Existing Conversation Room */}
        <ConversationRoom />

        <section className="features">

          <div className="feature-card">
            <span>🎤</span>
            <h3>Speak Naturally</h3>
            <p>
              Talk in Telugu, Hindi or English without worrying
              about the other person's language.
            </p>
          </div>

          <div className="feature-card">
            <span>🌐</span>
            <h3>Automatic Translation</h3>
            <p>
              Convert conversations between six language
              combinations.
            </p>
          </div>

          <div className="feature-card">
            <span>🔊</span>
            <h3>Translated Voice</h3>
            <p>
              Hear the other person's message in your own language.
            </p>
          </div>

        </section>

      </main>

      <footer>
        © 2026 MANA VOICE AI |
        Your Language Should Never Limit Your Potential.
      </footer>

    </div>
  );
}

export default App;