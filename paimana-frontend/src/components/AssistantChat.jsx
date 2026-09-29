import { useState, useRef, useEffect } from "react";
import { MessageCircle, X, Send } from "lucide-react";
import api, { API_BASE_URL } from "../api";

// ── Per-endpoint copy ─────────────────────────────────────────────────────────
const BIDS_CONFIG = {
  welcome: "Hi! Ask me about project distress signals, schedule slippage, or trends in this dataset.",
  chips: [
    "What's driving projects into distress?",
    "How many projects are currently in distress?",
    "Does materials pricing matter?",
  ],
};

const INDIA_CONFIG = {
  welcome: "Ask me about real Indian infrastructure projects, flagged risks, or delays.",
  chips: [
    "Which projects have the worst cost overruns?",
    "What's causing delays?",
    "How many projects are flagged?",
  ],
};

function getConfig(endpoint) {
  if (endpoint && endpoint.includes("india")) {
    return INDIA_CONFIG;
  }
  return BIDS_CONFIG;
}

export default function AssistantChat({
  isDrawerOpen = false,
  endpoint = `${API_BASE_URL}/assistant/ask`,
}) {
  const [isOpen, setIsOpen]       = useState(false);
  const [messages, setMessages]   = useState([]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef(null);

  const config = getConfig(endpoint);

  // ── Reset chat when the active endpoint changes ───────────────────────────
  // Prevents model-lab answers from appearing inside india-projects chat.
  useEffect(() => {
    setMessages([]);
    setInputText("");
    setIsLoading(false);
  }, [endpoint]);

  // ── Auto-scroll on new messages / loading change ──────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // ── Seed welcome message on first open ────────────────────────────────────
  function handleOpen() {
    setIsOpen(true);
    if (messages.length === 0) {
      setMessages([{ role: "assistant", text: config.welcome, isWelcome: true }]);
    }
  }

  // ── Send message ──────────────────────────────────────────────────────────
  function handleSend() {
    const text = inputText.trim();
    if (!text || isLoading) return;

    setMessages((prev) => [...prev, { role: "user", text }]);
    setInputText("");
    setIsLoading(true);

    api
      .post(endpoint, { question: text })
      .then((res) => {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: res.data.answer },
        ]);
      })
      .catch(() => {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: "Something went wrong. Please try again." },
        ]);
      })
      .finally(() => setIsLoading(false));
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // ── Collapsed: FAB button ─────────────────────────────────────────────────
  if (!isOpen) {
    return (
      <div
        className={`fixed bottom-6 right-6 ${
          isDrawerOpen ? "hidden sm:block z-30" : "z-50"
        }`}
      >
        <button
          onClick={handleOpen}
          className="w-14 h-14 rounded-full bg-brand-ink shadow-lg flex items-center
                     justify-center text-white hover:bg-brand-ink-light transition-colors
                     hover:scale-105 active:scale-95 transition-transform"
          aria-label="Open assistant"
        >
          <MessageCircle className="w-6 h-6" />
        </button>
      </div>
    );
  }

  // Show chips only while the welcome message is the sole message
  const showChips = messages.length === 1 && messages[0]?.isWelcome;

  // ── Expanded: chat panel ──────────────────────────────────────────────────
  return (
    <div
      className={`fixed bottom-4 sm:bottom-6 right-4 sm:right-6 w-[calc(100vw-2rem)] max-w-96 h-[70vh] max-h-[500px] bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden ${
        isDrawerOpen ? "hidden sm:flex z-30" : "z-50"
      }`}
    >
      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between bg-brand-ink px-4 py-3 rounded-t-xl shrink-0">
        <span className="text-sm font-semibold text-white">
          Project Intelligence Assistant
        </span>
        <button
          onClick={() => setIsOpen(false)}
          className="text-white/80 hover:text-white transition-colors"
          aria-label="Close assistant"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ── Messages ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`rounded-lg px-3 py-2 max-w-[80%] text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === "user"
                  ? "bg-[#EEF0F6] text-brand-ink ml-auto"
                  : "bg-slate-100 text-slate-800"
              }`}
            >
              {msg.text}
            </div>
          </div>
        ))}

        {/* Loading dots */}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-slate-100 rounded-lg px-4 py-3 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-slate-400 animate-pulse" />
              <span className="w-2 h-2 rounded-full bg-slate-400 animate-pulse [animation-delay:150ms]" />
              <span className="w-2 h-2 rounded-full bg-slate-400 animate-pulse [animation-delay:300ms]" />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Suggestion chips (only while welcome message is sole message) ── */}
      {showChips && (
        <div className="flex flex-wrap gap-2 px-4 pb-2">
          {config.chips.map((s) => (
            <button
              key={s}
              onClick={() => setInputText(s)}
              className="rounded-full border border-slate-200 px-3 py-1 text-xs
                         text-slate-600 hover:bg-slate-50 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* ── Input area ───────────────────────────────────────────── */}
      <div className="border-t border-slate-200 p-3 flex gap-2 shrink-0">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your projects..."
          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm
                     outline-none focus:ring-2 focus:ring-brand-amber/50 focus:border-brand-amber
                     placeholder:text-slate-400"
        />
        <button
          onClick={handleSend}
          disabled={isLoading || !inputText.trim()}
          className="bg-brand-ink text-white rounded-lg px-4 py-2
                     hover:bg-brand-ink-light disabled:opacity-50 disabled:cursor-not-allowed
                     transition-colors flex items-center justify-center"
          aria-label="Send"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
