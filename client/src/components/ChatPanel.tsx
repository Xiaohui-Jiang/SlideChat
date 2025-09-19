import React, { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../types';

type Props = {
  messages: ChatMessage[];
  loading?: boolean;
  onSend: (text: string) => void | Promise<void>;
};

export default function ChatPanel({ messages, loading = false, onSend }: Props) {
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function submit() {
    const t = text.trim();
    if (!t) return;
    setText('');
    await onSend(t);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto pr-1">
        {messages.map(m => (
          <div key={m.id} className={`mb-3 flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow
                            ${m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-white'}`}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="mb-3 flex justify-start">
            <div className="bg-white rounded-2xl px-3 py-2 text-sm shadow">
              <span className="inline-block animate-pulse">…thinking</span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="mt-2">
        <div className="rounded-2xl border bg-white p-2 shadow-sm">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder="Message the agent…"
            className="w-full resize-none outline-none text-sm"
          />
          <div className="flex justify-end">
            <button
              onClick={submit}
              className="mt-2 px-3 py-1.5 bg-blue-600 text-white rounded-xl disabled:opacity-50"
              disabled={!text.trim() || loading}
            >
              Send
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-1">Press Enter to send • Shift+Enter for newline</p>
      </div>
    </div>
  );
}
