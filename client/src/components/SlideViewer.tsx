import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Rect, Slide } from '../types';

type Props = {
  slides: Slide[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAnalyzeROI?: (roi: Rect, slide: Slide) => void;
};

export default function SlideViewer({ slides, selectedId, onSelect, onAnalyzeROI }: Props) {
  const selected = useMemo(
    () => slides.find(s => s.id === selectedId) ?? slides[0],
    [slides, selectedId]
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const [loaded, setLoaded] = useState(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  // ROI drawing
  const [dragging, setDragging] = useState(false);
  const [startPt, setStartPt] = useState<{ x: number; y: number } | null>(null);
  const [roi, setRoi] = useState<Rect | null>(null);

  useEffect(() => {
    // reset view when slide changes
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setRoi(null);
    setLoaded(false);
  }, [selected?.id]);

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const delta = -e.deltaY;
    const factor = delta > 0 ? 1.1 : 0.9;

    const rect = containerRef.current!.getBoundingClientRect();
    const cx = e.clientX - rect.left - offset.x;
    const cy = e.clientY - rect.top - offset.y;

    setScale(s => s * factor);
    setOffset(o => ({
      x: o.x - cx * (factor - 1),
      y: o.y - cy * (factor - 1),
    }));
  }

  function startDrag(e: React.MouseEvent) {
    const rect = containerRef.current!.getBoundingClientRect();
    setStartPt({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setDragging(true);
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!dragging || !startPt) return;
    const rect = containerRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const x0 = Math.min(startPt.x, x);
    const y0 = Math.min(startPt.y, y);
    const w = Math.abs(x - startPt.x);
    const h = Math.abs(y - startPt.y);

    setRoi({ x: x0, y: y0, w, h });
  }

  function endDrag() {
    setDragging(false);
    setStartPt(null);
  }

  function panBy(dx: number, dy: number) {
    setOffset(o => ({ x: o.x + dx, y: o.y + dy }));
  }

  return (
    <div className="flex h-full">
      {/* Left: main viewer */}
      <div className="relative flex-1 bg-white rounded-2xl shadow p-3 mr-4">
        <div className="flex items-center justify-between pb-2">
          <div className="font-semibold">{selected?.name}</div>
          <div className="flex items-center gap-2">
            <button className="px-2 py-1 rounded bg-gray-100" onClick={() => setScale(s => s * 1.1)}>＋</button>
            <button className="px-2 py-1 rounded bg-gray-100" onClick={() => setScale(s => s / 1.1)}>－</button>
            <button className="px-2 py-1 rounded bg-gray-100" onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }); }}>Reset</button>
            <div className="text-sm text-gray-500 ml-2">Zoom: {(scale * 100).toFixed(0)}%</div>
          </div>
        </div>

        <div
          ref={containerRef}
          className="relative overflow-hidden rounded-xl bg-gray-50 border h-[520px] select-none"
          onWheel={onWheel}
          onMouseDown={startDrag}
          onMouseMove={onMouseMove}
          onMouseLeave={endDrag}
          onMouseUp={endDrag}
        >
          {/* Image */}
          <img
            ref={imgRef}
            src={selected?.imageUrl}
            onLoad={() => setLoaded(true)}
            alt={selected?.name}
            className="origin-top-left pointer-events-none"
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            }}
          />

          {/* ROI rectangle */}
          {roi && (
            <div
              className="absolute border-2 border-blue-500"
              style={{ left: roi.x, top: roi.y, width: roi.w, height: roi.h }}
            />
          )}

          {/* Mini controls for panning */}
          <div className="absolute bottom-3 left-3 flex gap-2">
            <button className="px-2 py-1 bg-white rounded shadow" onClick={() => panBy(0, -40)}>↑</button>
            <button className="px-2 py-1 bg-white rounded shadow" onClick={() => panBy(-40, 0)}>←</button>
            <button className="px-2 py-1 bg-white rounded shadow" onClick={() => panBy(40, 0)}>→</button>
            <button className="px-2 py-1 bg-white rounded shadow" onClick={() => panBy(0, 40)}>↓</button>
          </div>

          {/* Scale bar (visual only) */}
          {loaded && (
            <div className="absolute left-4 bottom-4 text-xs text-gray-700 bg-white/80 rounded px-2 py-1">
              <div className="h-[2px] w-[120px] bg-gray-700 mb-1" />
              200 μm (visual)
            </div>
          )}
        </div>

        <div className="flex items-center justify-between mt-3">
          <div className="text-sm text-gray-500">
            {roi ? `ROI: x=${roi.x|0}, y=${roi.y|0}, w=${roi.w|0}, h=${roi.h|0}` : 'Drag to draw an ROI'}
          </div>
          <button
            className="px-3 py-1.5 bg-blue-600 text-white rounded-xl disabled:opacity-50"
            disabled={!roi}
            onClick={() => roi && selected && onAnalyzeROI?.(roi, selected)}
          >
            Analyze ROI
          </button>
        </div>
      </div>

      {/* Right: thumbnails */}
      <div className="w-40 flex flex-col gap-3">
        {slides.map(s => (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={`rounded-xl overflow-hidden border hover:shadow transition ${s.id === selected?.id ? 'ring-2 ring-blue-500' : ''}`}
            title={s.name}
          >
            <img src={s.thumbnailUrl} alt={s.name} className="w-full h-24 object-cover" />
            <div className="text-xs p-2 text-left truncate">{s.name}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
