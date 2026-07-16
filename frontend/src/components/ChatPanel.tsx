import { KeyboardEvent, RefObject, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { api, MentionedNode, SearchResult } from "../api/client";
import { GraphCanvasHandle } from "./GraphCanvas";

const TYPE_COLORS: Record<string, string> = {
  Package: "bg-blue-600", File: "bg-slate-600", Class: "bg-green-600",
  Interface: "bg-teal-600", Enum: "bg-yellow-600", Method: "bg-purple-600",
  RestEndpoint: "bg-orange-600", ExternalLib: "bg-gray-600",
};

type ChatTool = "repo" | "architecture";

interface Message {
  role: "user" | "ai";
  text: string;
  nodes?: MentionedNode[];
  citations?: string[];
  error?: boolean;
}

interface Props {
  repoId: string;
  canvasRef: RefObject<GraphCanvasHandle | null>;
  onNodeSelect: (nodeId: string) => void;
  onClose: () => void;
}

export default function ChatPanel({ repoId, canvasRef, onNodeSelect, onClose }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [tool, setTool] = useState<ChatTool>("repo");
  const [streaming, setStreaming] = useState(false);

  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function jumpToNode(id: string) {
    canvasRef.current?.flashNode(id);
    onNodeSelect(id);
  }

  function handleSearchInput(q: string) {
    setSearchQ(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (q.trim().length < 3) {
      setSearchResults([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      try {
        const { results } = await api.searchNodes(repoId, q.trim());
        setSearchResults(results.slice(0, 5));
        canvasRef.current?.highlightNodes(results.map((r) => r.id), "#8B5CF6");
      } catch {
        setSearchResults([]);
      }
    }, 500);
  }

  function send() {
    const message = input.trim();
    if (!message || streaming) return;

    setInput("");
    setStreaming(true);
    setMessages((prev) => [...prev, { role: "user", text: message }, { role: "ai", text: "" }]);

    api.streamChat(repoId, message, tool, {
      onDelta: (t) =>
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { ...next[next.length - 1], text: next[next.length - 1].text + t };
          return next;
        }),
      onDone: ({ nodes, citations }) => {
        setStreaming(false);
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { ...next[next.length - 1], nodes, citations };
          return next;
        });
      },
      onError: (msg) => {
        setStreaming(false);
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: "ai", text: msg, error: true };
          return next;
        });
      },
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="absolute inset-y-0 right-0 bg-gray-900 border-l border-gray-800 flex flex-col z-30 shadow-2xl" style={{ width: 480 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div>
          <h3 className="text-sm font-semibold text-white">Ask about this codebase</h3>
          <div className="flex gap-1 mt-1.5">
            {(["repo", "architecture"] as ChatTool[]).map((t) => (
              <button
                key={t}
                onClick={() => setTool(t)}
                className={`text-xs px-2 py-0.5 rounded transition-colors ${
                  tool === t
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:text-gray-200"
                }`}
              >
                {t === "repo" ? "Repository" : "Architecture"}
              </button>
            ))}
          </div>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-white text-lg leading-none">×</button>
      </div>

      {/* Semantic search */}
      <div className="px-3 py-2 border-b border-gray-800">
        <input
          type="text"
          value={searchQ}
          onChange={(e) => handleSearchInput(e.target.value)}
          placeholder="Semantic search — find nodes by meaning…"
          className="w-full bg-gray-800 text-gray-200 text-xs rounded px-3 py-1.5 border border-gray-700 focus:outline-none focus:border-indigo-500 placeholder-gray-500"
        />
        {searchResults.length > 0 && (
          <div className="mt-1.5 space-y-0.5">
            {searchResults.map((r) => (
              <div
                key={r.id}
                onClick={() => jumpToNode(r.id)}
                className="px-2 py-1.5 rounded hover:bg-gray-800 cursor-pointer"
              >
                <div className="flex items-center gap-1.5">
                  <span className={`text-xs px-1.5 py-0.5 rounded text-white flex-shrink-0 ${TYPE_COLORS[r.type] ?? "bg-gray-600"}`}>
                    {r.type}
                  </span>
                  <span className="text-xs text-white truncate">{r.name}</span>
                  <span className="text-xs text-gray-500 ml-auto flex-shrink-0">{(r.score * 100).toFixed(0)}%</span>
                </div>
                <p className="text-xs text-gray-500 truncate mt-0.5">{r.preview}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-10">
            <p className="text-sm text-gray-400 mb-2">Ask anything about the codebase</p>
            <p className="text-xs text-gray-600">
              "Which classes handle database access?"<br />
              "How does authentication work?"<br />
              "What happens when a user logs in?"
            </p>
          </div>
        )}

        {messages.map((msg, i) => {
          const nameToId = Object.fromEntries((msg.nodes ?? []).map((n) => [n.name, n.id]));
          return msg.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="bg-indigo-600 text-white text-xs rounded-lg rounded-br-sm px-3 py-2 max-w-[85%]">
                {msg.text}
              </div>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <div className={`text-xs rounded-lg rounded-bl-sm px-3 py-2 max-w-[90%] ${
                msg.error ? "bg-red-900/30 border border-red-800 text-red-300" : "bg-gray-800 text-gray-300"
              }`}>
                {msg.text === "" && streaming && i === messages.length - 1 ? (
                  <span className="text-gray-500 animate-pulse">Thinking…</span>
                ) : (
                  <div className="[&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-4 [&_li]:mb-1 [&_code]:text-indigo-300">
                    <ReactMarkdown
                      components={{
                        strong: ({ children }) => {
                          const name = String(children);
                          const id = nameToId[name];
                          return id ? (
                            <button
                              onClick={() => jumpToNode(id)}
                              className="text-blue-400 underline font-semibold"
                            >
                              {name}
                            </button>
                          ) : (
                            <strong className="text-white">{children}</strong>
                          );
                        },
                      }}
                    >
                      {msg.text}
                    </ReactMarkdown>
                  </div>
                )}

                {msg.citations && msg.citations.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-gray-700">
                    <p className="text-gray-500 font-semibold mb-0.5">Sources</p>
                    {msg.citations.map((f) => (
                      <p key={f} className="text-gray-400 truncate">{f}</p>
                    ))}
                  </div>
                )}

                {msg.nodes && msg.nodes.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {msg.nodes.map((n) => (
                      <button
                        key={n.id}
                        onClick={() => jumpToNode(n.id)}
                        className="text-xs text-blue-400 bg-blue-900/30 border border-blue-800 rounded px-1.5 py-0.5 hover:bg-blue-900/60"
                      >
                        ↗ {n.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-3 border-t border-gray-800 flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask a question… (Enter to send)"
          rows={2}
          className="flex-1 bg-gray-800 text-gray-200 text-xs rounded px-3 py-2 border border-gray-700 focus:outline-none focus:border-indigo-500 placeholder-gray-500 resize-none"
        />
        <button
          onClick={send}
          disabled={streaming || !input.trim()}
          className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900 disabled:cursor-not-allowed text-white rounded px-4 transition-colors"
        >
          Send
        </button>
      </div>
    </div>
  );
}
