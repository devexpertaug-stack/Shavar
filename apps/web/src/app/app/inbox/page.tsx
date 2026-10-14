'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type Conversation,
  type ThreadResponse,
  type Template,
  type WaMessage,
} from '@/lib/api';
import { getSocket } from '@/lib/socket';

const WINDOW_MS = 24 * 60 * 60 * 1000;

export default function InboxPage() {
  const [convos, setConvos] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadResponse | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [text, setText] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadConvos = useCallback(() => {
    api.conversations().then(setConvos).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    loadConvos();
    api.templates().then(setTemplates).catch(() => undefined);
  }, [loadConvos]);

  const loadThread = useCallback((id: string) => {
    api.thread(id).then(setThread).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (activeId) loadThread(activeId);
  }, [activeId, loadThread]);

  // Live updates for the open conversation.
  useEffect(() => {
    if (!activeId) return;
    const socket = getSocket();
    const refresh = () => loadThread(activeId);
    socket.emit('lead:subscribe', activeId);
    socket.on('message:new', refresh);
    socket.on('message:status', refresh);
    return () => {
      socket.emit('lead:unsubscribe', activeId);
      socket.off('message:new', refresh);
      socket.off('message:status', refresh);
    };
  }, [activeId, loadThread]);

  const windowOpen =
    thread?.lead.lastInboundAt != null &&
    Date.now() - new Date(thread.lead.lastInboundAt).getTime() <= WINDOW_MS;

  async function onSend() {
    if (!activeId) return;
    setError(null);
    try {
      if (windowOpen) {
        if (!text.trim()) return;
        await api.sendMessage(activeId, { kind: 'text', text });
        setText('');
      } else {
        if (!templateName) return;
        await api.sendMessage(activeId, { kind: 'template', templateName, templateParams: [] });
      }
      loadThread(activeId);
      loadConvos();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] gap-4">
      <aside className="w-72 flex-shrink-0 overflow-y-auto rounded-xl border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Conversations</h2>
        <ul>
          {convos.map((c) => (
            <li key={c.leadId}>
              <button
                onClick={() => setActiveId(c.leadId)}
                className={`w-full border-b border-slate-50 px-4 py-3 text-left hover:bg-slate-50 ${
                  activeId === c.leadId ? 'bg-brand/5' : ''
                }`}
              >
                <p className="text-sm font-medium">{c.contact.name ?? c.contact.phoneE164}</p>
                <p className="truncate text-xs text-slate-500">
                  {c.lastMessage?.body ?? 'No messages yet'}
                </p>
              </button>
            </li>
          ))}
          {convos.length === 0 && <li className="px-4 py-6 text-sm text-slate-500">No conversations.</li>}
        </ul>
      </aside>

      <section className="flex flex-1 flex-col rounded-xl border border-slate-200 bg-white">
        {!thread ? (
          <div className="flex flex-1 items-center justify-center text-slate-400">
            Select a conversation
          </div>
        ) : (
          <>
            <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div>
                <p className="font-medium">
                  {thread.lead.contact.name ?? thread.lead.contact.phoneE164}
                </p>
                <p className="text-xs text-slate-500">
                  {windowOpen ? '24h window open' : 'Window closed — templates only'}
                  {!thread.lead.contact.optedIn && ' · opted out'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    thread.lead.aiActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {thread.lead.aiActive ? 'AI' : 'Human'}
                </span>
                <button
                  onClick={() =>
                    (thread.lead.aiActive ? api.takeover(activeId!) : api.releaseAi(activeId!)).then(() =>
                      loadThread(activeId!),
                    )
                  }
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                >
                  {thread.lead.aiActive ? 'Take over' : 'Give to AI'}
                </button>
              </div>
            </header>

            <div className="flex-1 space-y-2 overflow-y-auto p-4">
              {thread.messages.map((m: WaMessage) => (
                <div
                  key={m.id}
                  className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                    m.direction === 'OUTBOUND'
                      ? 'ml-auto bg-brand/10 text-slate-800'
                      : 'bg-slate-100'
                  }`}
                >
                  {m.type === 'audio' && m.mediaUrl && (
                    <audio controls src={m.mediaUrl} className="mb-1 w-full" />
                  )}
                  {m.type === 'audio' && m.transcript ? (
                    <span className="italic text-slate-600">“{m.transcript}”</span>
                  ) : (
                    (m.body ?? `[${m.type}]`)
                  )}
                  <span className="mt-1 block text-[10px] text-slate-400">
                    {m.sentBy === 'ai' ? 'AI · ' : ''}
                    {m.status}
                  </span>
                </div>
              ))}
            </div>

            <footer className="border-t border-slate-100 p-3">
              {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
              {windowOpen ? (
                <div className="flex gap-2">
                  <input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && onSend()}
                    placeholder="Type a message…"
                    className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                  <button
                    onClick={onSend}
                    className="rounded-md bg-brand px-4 text-sm font-medium text-white hover:bg-brand-dark"
                  >
                    Send
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <select
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="">Choose an approved template…</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.name}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={onSend}
                    disabled={!templateName}
                    className="rounded-md bg-brand px-4 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
                  >
                    Send template
                  </button>
                </div>
              )}
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
