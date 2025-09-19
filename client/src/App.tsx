import React, { useEffect, useState } from 'react';
import SlideViewer from './components/SlideViewer';
import ChatPanel from './components/ChatPanel';
import UploadBar from './components/UploadBar';
import type { ChatMessage, Rect, Slide } from './types';
import { fetchSlides, sendChat } from './lib/api';

export default function App() {
  const [slides, setSlides] = useState<Slide[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: crypto.randomUUID(),
      role: 'assistant',
      content:
        'Loading WSI: lung_01.svs\n\nUpload your own .svs (server will create a preview) or an image. Draw an ROI and click “Analyze ROI”, or just say hi 👋',
      ts: Date.now(),
    },
  ]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const s = await fetchSlides();
      setSlides(s);
      if (s.length) setSelectedId(s[0].id);
    })();
  }, []);

  async function handleSend(text: string) {
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: text, ts: Date.now() };
    setMessages(m => [...m, userMsg]);

    setLoading(true);
    try {
      const reply = await sendChat(text);
      const asst: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: reply, ts: Date.now() };
      setMessages(m => [...m, asst]);
    } finally {
      setLoading(false);
    }
  }

  function handleAnalyzeROI(roi: Rect, slide: Slide) {
    const summary = `Please analyze ROI on ${slide.name}: x=${roi.x|0}, y=${roi.y|0}, w=${roi.w|0}, h=${roi.h|0}.
- Quantify CD68-positive cell density within the ROI.
- Summarize spatial immune infiltration patterns.`;
    void handleSend(summary);
  }

  function handleAddSlide(s: Slide) {
    setSlides(prev => {
      const next = [s, ...prev];
      return next;
    });
    setSelectedId(s.id);
  }

  return (
    <div className="h-screen p-4 bg-gray-100">
      <div className="max-w-7xl mx-auto h-full grid grid-cols-2 gap-4">
        <div className="flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-2xl font-bold">Slides</h1>
            <UploadBar onAddSlide={handleAddSlide} />
          </div>
          <div className="flex-1">
            <SlideViewer
              slides={slides}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onAnalyzeROI={handleAnalyzeROI}
            />
          </div>
        </div>

        <div className="flex flex-col">
          <h1 className="text-2xl font-bold mb-3">Agent</h1>
          <div className="flex-1 rounded-2xl bg-gray-50 p-3 shadow">
            <ChatPanel messages={messages} loading={loading} onSend={handleSend} />
          </div>
        </div>
      </div>
    </div>
  );
}
