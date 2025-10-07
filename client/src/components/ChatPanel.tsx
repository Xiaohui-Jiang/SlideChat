import React, { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../types';

interface ChatPanelProps {
  messages: ChatMessage[];
  loading?: boolean;
  onSend: (text: string) => void | Promise<void>;
  className?: string;
  agentName?: string;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({ 
  messages, 
  loading = false, 
  onSend, 
  className = '',
  agentName = 'Slide'
}) => {
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
    <div className={`h-full flex flex-col bg-white border-l ${className}`}>
      {/* Chat Header */}
      <div className="p-3 border-b bg-gray-50">
        <h3 className="font-medium text-sm">Chat with {agentName}</h3>
        <div className="text-xs text-gray-500">Ask about cell typing, analysis, or anything else</div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3">
        {messages.map(m => (
          <div key={m.id} className={`mb-3 flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-sm
                            ${m.role === 'user' 
                              ? 'bg-blue-500 text-white' 
                              : 'bg-gray-100 text-gray-800 border'
                            }`}>
              <div className="whitespace-pre-wrap">{m.content}</div>
              <div className={`text-xs mt-1 opacity-70 ${
                m.role === 'user' ? 'text-blue-100' : 'text-gray-500'
              }`}>
                {new Date(m.ts).toLocaleTimeString()}
              </div>
            </div>
          </div>
        ))}
        {loading && (
          <div className="mb-3 flex justify-start">
            <div className="bg-gray-100 border rounded-lg px-3 py-2 text-sm shadow-sm">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                <span className="ml-2 text-gray-600">{agentName} is thinking...</span>
              </div>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input Area */}
      <div className="p-3 border-t bg-gray-50">
        <div className="flex gap-2">
          <textarea
            className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="Ask Anything..."
            rows={2}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button
            className="px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={submit}
            disabled={loading || !text.trim()}
          >
            Send
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-1">Press Enter to send • Shift+Enter for newline</p>
      </div>
    </div>
  );
};

// Keep the default export for backward compatibility
export default ChatPanel;
