import React, { useEffect, useState } from 'react';
import SlideViewer from './components/SlideViewer';
import ChatPanel from './components/ChatPanel';
import UploadBar from './components/UploadBar';
import type { ChatMessage, Rect, Slide, ROI } from './types';
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
    console.log('🔍 STEP 3: handleSend called with:', text);
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: text, ts: Date.now() };
    setMessages(m => [...m, userMsg]);
    console.log('🔍 STEP 4: User message added to chat');

    setLoading(true);
    try {
      console.log('🔍 STEP 5: Calling sendChat API...');
      const reply = await sendChat(text);
      console.log('🔍 STEP 6: Got reply from server:', reply);
      const asst: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: reply, ts: Date.now() };
      setMessages(m => [...m, asst]);
      console.log('🔍 STEP 7: Assistant message added to chat');
    } catch (error) {
      console.error('🚨 ERROR in handleSend:', error);
    } finally {
      setLoading(false);
      console.log('🔍 STEP 8: Loading finished');
    }
  }

  function handleAnalyzeROI(roi: ROI, slide: Slide) {
    console.log('🔍 STEP 1: Analyze button clicked!', { roi: roi.name, slide: slide.name });
    const summary = `Please analyze ROI "${roi.name}" on ${slide.name}: x=${roi.geometry.x|0}, y=${roi.geometry.y|0}, w=${roi.geometry.w|0}, h=${roi.geometry.h|0}.
- Quantify CD68-positive cell density within the ROI.
- Summarize spatial immune infiltration patterns.`;
    console.log('🔍 STEP 2: Sending message to chat:', summary);
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
      <div className="max-w-7xl mx-auto h-full grid grid-cols-4 gap-4">
        {/* Left: Slide display area (3 columns) */}
        <div className="col-span-3 flex flex-col">
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

        {/* Right: Chat area (1 column) */}
        <div className="col-span-1 flex flex-col">
          <h1 className="text-xl font-bold mb-3">Agent</h1>
          <div className="flex-1 rounded-2xl bg-gray-50 p-3 shadow">
            <ChatPanel messages={messages} loading={loading} onSend={handleSend} />
          </div>
        </div>
      </div>
    </div>
  );
}
