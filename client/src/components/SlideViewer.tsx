import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Rect, Slide, ROI } from '../types';
import { fetchROIs, createROI, updateROIName, deleteROI } from '../lib/api';

type Props = {
  slides: Slide[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAnalyzeROI?: (roi: ROI, slide: Slide) => void;
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

  // ROI management
  const [rois, setRois] = useState<ROI[]>([]);
  const [selectedROI, setSelectedROI] = useState<ROI | null>(null);
  
  // ROI drawing
  const [dragging, setDragging] = useState(false);
  const [startPt, setStartPt] = useState<{ x: number; y: number } | null>(null);
  const [currentDrawing, setCurrentDrawing] = useState<Rect | null>(null);
  
  // ROI naming
  const [showNameDialog, setShowNameDialog] = useState(false);
  const [roiName, setRoiName] = useState('');

  useEffect(() => {
    // reset view when slide changes
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setCurrentDrawing(null);
    setSelectedROI(null);
    setLoaded(false);
    
    // Fetch ROIs for the selected slide
    if (selected?.id) {
      fetchROIs(selected.id).then(setRois);
    }
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

    setCurrentDrawing({ x: x0, y: y0, w, h });
  }

  function endDrag() {
    if (currentDrawing && currentDrawing.w > 10 && currentDrawing.h > 10) {
      // Show name dialog for the new ROI
      setShowNameDialog(true);
      setRoiName(`ROI ${rois.length + 1}`);
    }
    setDragging(false);
    setStartPt(null);
  }

  async function saveROI() {
    if (!currentDrawing || !selected) return;
    
    try {
      const newROI = await createROI(selected.id, roiName, currentDrawing);
      setRois(prev => [...prev, newROI]);
      setCurrentDrawing(null);
      setShowNameDialog(false);
      setRoiName('');
    } catch (error) {
      console.error('Failed to save ROI:', error);
    }
  }

  function cancelROI() {
    setCurrentDrawing(null);
    setShowNameDialog(false);
    setRoiName('');
  }

  async function handleDeleteROI(roi: ROI) {
    if (!selected) return;
    
    try {
      await deleteROI(selected.id, roi.id);
      setRois(prev => prev.filter(r => r.id !== roi.id));
      if (selectedROI?.id === roi.id) {
        setSelectedROI(null);
      }
    } catch (error) {
      console.error('Failed to delete ROI:', error);
    }
  }

  async function handleRenameROI(roi: ROI, newName: string) {
    if (!selected) return;
    
    try {
      await updateROIName(selected.id, roi.id, newName);
      setRois(prev => prev.map(r => r.id === roi.id ? { ...r, name: newName } : r));
    } catch (error) {
      console.error('Failed to rename ROI:', error);
    }
  }

  function panBy(dx: number, dy: number) {
    setOffset(o => ({ x: o.x + dx, y: o.y + dy }));
  }

  return (
    <div className="flex h-full">
      {/* Left: thumbnails */}
      <div className="w-36 flex flex-col gap-3 mr-4">
        <div className="text-sm font-medium text-gray-700 mb-2">Slides</div>
        {slides.map(s => (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={`rounded-xl overflow-hidden border hover:shadow transition ${s.id === selected?.id ? 'ring-2 ring-blue-500' : ''}`}
            title={s.name}
          >
            <img src={s.thumbnailUrl} alt={s.name} className="w-full h-20 object-cover" />
            <div className="text-xs p-2 text-left truncate">{s.name}</div>
          </button>
        ))}
      </div>

      {/* Right: main viewer (enlarged) */}
      <div className="relative flex-1 bg-white rounded-2xl shadow p-3">
        <div className="flex items-center justify-between pb-2">
          <div className="font-semibold">{selected?.name}</div>
          <div className="flex items-center gap-2">
            <button className="px-2 py-1 rounded bg-gray-100" onClick={() => setScale(s => s * 1.1)}>＋</button>
            <button className="px-2 py-1 rounded bg-gray-100" onClick={() => setScale(s => s / 1.1)}>－</button>
            <button className="px-2 py-1 rounded bg-gray-100" onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }); }}>Reset</button>
            <div className="text-sm text-gray-500 ml-2">Zoom: {(scale * 100).toFixed(0)}%</div>
          </div>
        </div>

        <div className="relative">
          <div
            ref={containerRef}
            className="relative overflow-hidden rounded-xl bg-gray-50 border h-[500px] select-none"
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

            {/* Existing ROIs */}
            {rois.map((roi) => (
              <div
                key={roi.id}
                className={`absolute border-2 cursor-pointer ${
                  selectedROI?.id === roi.id ? 'border-red-500 bg-red-100/20' : 'border-green-500 bg-green-100/20'
                }`}
                style={{ 
                  left: roi.geometry.x, 
                  top: roi.geometry.y, 
                  width: roi.geometry.w, 
                  height: roi.geometry.h 
                }}
                onClick={() => setSelectedROI(selectedROI?.id === roi.id ? null : roi)}
                title={roi.name}
              >
                <div className="absolute -top-6 left-0 text-xs bg-green-600 text-white px-1 rounded">
                  {roi.name}
                </div>
              </div>
            ))}

            {/* Currently drawing ROI */}
            {currentDrawing && (
              <div
                className="absolute border-2 border-blue-500 bg-blue-100/20"
                style={{ 
                  left: currentDrawing.x, 
                  top: currentDrawing.y, 
                  width: currentDrawing.w, 
                  height: currentDrawing.h 
                }}
              />
            )}

            {/* Mini controls for panning */}
            <div className="absolute bottom-3 right-3 flex gap-2">
              <button className="px-2 py-1 bg-white rounded shadow" onClick={() => panBy(0, -40)}>↑</button>
              <button className="px-2 py-1 bg-white rounded shadow" onClick={() => panBy(-40, 0)}>←</button>
              <button className="px-2 py-1 bg-white rounded shadow" onClick={() => panBy(40, 0)}>→</button>
              <button className="px-2 py-1 bg-white rounded shadow" onClick={() => panBy(0, 40)}>↓</button>
            </div>

            {/* Scale bar (visual only) */}
            {loaded && (
              <div className="absolute right-4 bottom-4 text-xs text-gray-700 bg-white/80 rounded px-2 py-1">
                <div className="h-[2px] w-[120px] bg-gray-700 mb-1" />
                200 μm (visual)
              </div>
            )}
          </div>
          
          {/* ROI List Panel (lower-left area) */}
          <div className="absolute bottom-0 left-0 w-80 bg-white rounded-tr-xl shadow-lg border p-3 max-h-32 overflow-y-auto">
            <div className="text-sm font-medium mb-2">Regions of Interest ({rois.length})</div>
            {rois.length === 0 ? (
              <div className="text-xs text-gray-500">No ROIs defined. Drag on the image to create one.</div>
            ) : (
              <div className="space-y-1">
                {rois.map((roi) => (
                  <div 
                    key={roi.id}
                    className={`flex items-center justify-between p-2 rounded text-xs ${
                      selectedROI?.id === roi.id ? 'bg-red-100 border border-red-300' : 'bg-gray-50 hover:bg-gray-100'
                    }`}
                  >
                    <div className="flex-1">
                      <div className="font-medium">{roi.name}</div>
                      <div className="text-gray-500">
                        {roi.geometry.w|0} × {roi.geometry.h|0} px
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        className="px-2 py-1 bg-blue-600 text-white rounded text-xs"
                        onClick={() => selectedROI?.id === roi.id && selected && onAnalyzeROI?.(roi, selected)}
                      >
                        Analyze
                      </button>
                      <button
                        className="px-2 py-1 bg-red-600 text-white rounded text-xs"
                        onClick={() => handleDeleteROI(roi)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between mt-3">
          <div className="text-sm text-gray-500">
            {selectedROI 
              ? `Selected: ${selectedROI.name} (${selectedROI.geometry.w|0}×${selectedROI.geometry.h|0})` 
              : 'Drag to draw a new ROI, or click existing ROI to select'}
          </div>
          {selectedROI && (
            <button
              className="px-3 py-1.5 bg-blue-600 text-white rounded-xl"
              onClick={() => selected && onAnalyzeROI?.(selectedROI, selected)}
            >
              Analyze Selected ROI
            </button>
          )}
        </div>
      </div>
      
      {/* ROI Naming Dialog */}
      {showNameDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-80">
            <h3 className="text-lg font-semibold mb-4">Name Your ROI</h3>
            <input
              type="text"
              value={roiName}
              onChange={(e) => setRoiName(e.target.value)}
              className="w-full border rounded px-3 py-2 mb-4"
              placeholder="Enter ROI name..."
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && saveROI()}
            />
            <div className="flex justify-end gap-2">
              <button
                className="px-4 py-2 text-gray-600 border rounded"
                onClick={cancelROI}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 bg-blue-600 text-white rounded"
                onClick={saveROI}
                disabled={!roiName.trim()}
              >
                Save ROI
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
