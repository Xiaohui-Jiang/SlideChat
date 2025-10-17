import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { Rect, Slide, ROI } from '../types';
import { fetchROIs, createROI, updateROIName, deleteROI } from '../lib/api';

type Props = {
  slides: Slide[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAnalyzeROI?: (roi: ROI, slide: Slide) => void;
};

interface ViewportState {
  scale: number;
  offset: { x: number; y: number };
  imageSize: { width: number; height: number };
  containerSize: { width: number; height: number };
}

export default function EnhancedSlideViewer({ slides, selectedId, onSelect, onAnalyzeROI }: Props) {
  const selected = useMemo(
    () => slides.find(s => s.id === selectedId) ?? slides[0],
    [slides, selectedId]
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const [viewport, setViewport] = useState<ViewportState>({
    scale: 1,
    offset: { x: 0, y: 0 },
    imageSize: { width: 0, height: 0 },
    containerSize: { width: 0, height: 0 }
  });

  // ROI management
  const [rois, setRois] = useState<ROI[]>([]);
  const [selectedROI, setSelectedROI] = useState<ROI | null>(null);
  
  // ROI drawing
  const [isDrawing, setIsDrawing] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [currentDrawing, setCurrentDrawing] = useState<Rect | null>(null);
  const [lastPanPoint, setLastPanPoint] = useState<{ x: number; y: number } | null>(null);
  
  // ROI editing
  const [editingROI, setEditingROI] = useState<ROI | null>(null);
  const [resizeHandle, setResizeHandle] = useState<string | null>(null);

  // Coordinate transformation helpers
  const screenToImage = useCallback((screenX: number, screenY: number) => {
    return {
      x: (screenX - viewport.offset.x) / viewport.scale,
      y: (screenY - viewport.offset.y) / viewport.scale
    };
  }, [viewport]);

  const imageToScreen = useCallback((imageX: number, imageY: number) => {
    return {
      x: viewport.offset.x + imageX * viewport.scale,
      y: viewport.offset.y + imageY * viewport.scale
    };
  }, [viewport]);

  // Update container size on resize
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setViewport(prev => ({
          ...prev,
          containerSize: { width: rect.width, height: rect.height }
        }));
      }
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Reset viewport when slide changes
  useEffect(() => {
    setViewport(prev => ({
      ...prev,
      scale: 1,
      offset: { x: 0, y: 0 }
    }));
    setCurrentDrawing(null);
    setSelectedROI(null);
    setEditingROI(null);
    
    if (selected?.id) {
      fetchROIs(selected.id).then(setRois);
    }
  }, [selected?.id]);

  // Update image size when image loads
  const handleImageLoad = useCallback(() => {
    if (imgRef.current) {
      setViewport(prev => ({
        ...prev,
        imageSize: {
          width: imgRef.current!.naturalWidth,
          height: imgRef.current!.naturalHeight
        }
      }));
    }
  }, []);

  // Enhanced zoom with better bounds checking
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    
    const rect = containerRef.current!.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    const delta = -e.deltaY;
    const zoomFactor = delta > 0 ? 1.1 : 0.9;
    
    setViewport(prev => {
      const newScale = Math.max(0.1, Math.min(10, prev.scale * zoomFactor));
      
      // Zoom towards mouse position
      const mouseImagePoint = screenToImage(mouseX, mouseY);
      const newOffset = {
        x: mouseX - mouseImagePoint.x * newScale,
        y: mouseY - mouseImagePoint.y * newScale
      };
      
      return {
        ...prev,
        scale: newScale,
        offset: newOffset
      };
    });
  }, [screenToImage]);

  // Mouse down handler - determines if we're drawing, resizing, or panning
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const rect = containerRef.current!.getBoundingClientRect();
    const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    // Check if we're clicking on a resize handle
    const handle = getResizeHandle(point);
    if (handle && selectedROI) {
      setResizeHandle(handle);
      setEditingROI(selectedROI);
      return;
    }

    // Check if we're clicking on an existing ROI
    const clickedROI = getROIAtPoint(point);
    if (clickedROI) {
      setSelectedROI(clickedROI);
      return;
    }

    // If holding shift, start panning
    if (e.shiftKey) {
      setIsPanning(true);
      setLastPanPoint(point);
      return;
    }

    // Otherwise, start drawing a new ROI
    setIsDrawing(true);
    setStartPoint(point);
    setSelectedROI(null);
  }, [selectedROI]);

  // Mouse move handler
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    if (resizeHandle && editingROI) {
      // Handle ROI resizing
      handleROIResize(point);
    } else if (isDrawing && startPoint) {
      // Handle ROI drawing
      const imageStart = screenToImage(startPoint.x, startPoint.y);
      const imageCurrent = screenToImage(point.x, point.y);
      
      setCurrentDrawing({
        x: Math.min(imageStart.x, imageCurrent.x),
        y: Math.min(imageStart.y, imageCurrent.y),
        w: Math.abs(imageCurrent.x - imageStart.x),
        h: Math.abs(imageCurrent.y - imageStart.y)
      });
    } else if (isPanning && lastPanPoint) {
      // Handle panning
      const dx = point.x - lastPanPoint.x;
      const dy = point.y - lastPanPoint.y;
      
      setViewport(prev => ({
        ...prev,
        offset: {
          x: prev.offset.x + dx,
          y: prev.offset.y + dy
        }
      }));
      
      setLastPanPoint(point);
    }

    // Update cursor based on state
    updateCursor(point);
  }, [isDrawing, isPanning, resizeHandle, editingROI, startPoint, lastPanPoint, screenToImage]);

  // Mouse up handler
  const handleMouseUp = useCallback(() => {
    if (isDrawing && currentDrawing && currentDrawing.w > 10 && currentDrawing.h > 10) {
      // Create new ROI
      createNewROI();
    }

    if (resizeHandle && editingROI) {
      // Finish resizing
      updateROIGeometry();
    }

    // Reset all interaction states
    setIsDrawing(false);
    setIsPanning(false);
    setStartPoint(null);
    setLastPanPoint(null);
    setResizeHandle(null);
    setEditingROI(null);
  }, [isDrawing, currentDrawing, resizeHandle, editingROI]);

  // Helper functions
  const getROIAtPoint = (point: { x: number; y: number }): ROI | null => {
    for (const roi of rois) {
      const screenRect = {
        x: viewport.offset.x + roi.geometry.x * viewport.scale,
        y: viewport.offset.y + roi.geometry.y * viewport.scale,
        w: roi.geometry.w * viewport.scale,
        h: roi.geometry.h * viewport.scale
      };

      if (point.x >= screenRect.x && point.x <= screenRect.x + screenRect.w &&
          point.y >= screenRect.y && point.y <= screenRect.y + screenRect.h) {
        return roi;
      }
    }
    return null;
  };

  const getResizeHandle = (point: { x: number; y: number }): string | null => {
    if (!selectedROI) return null;

    const roi = selectedROI;
    const screenRect = {
      x: viewport.offset.x + roi.geometry.x * viewport.scale,
      y: viewport.offset.y + roi.geometry.y * viewport.scale,
      w: roi.geometry.w * viewport.scale,
      h: roi.geometry.h * viewport.scale
    };

    const handleSize = 8;
    const tolerance = handleSize / 2;

    // Check corners and edges
    const handles = [
      { name: 'nw', x: screenRect.x, y: screenRect.y },
      { name: 'ne', x: screenRect.x + screenRect.w, y: screenRect.y },
      { name: 'sw', x: screenRect.x, y: screenRect.y + screenRect.h },
      { name: 'se', x: screenRect.x + screenRect.w, y: screenRect.y + screenRect.h },
      { name: 'n', x: screenRect.x + screenRect.w / 2, y: screenRect.y },
      { name: 's', x: screenRect.x + screenRect.w / 2, y: screenRect.y + screenRect.h },
      { name: 'w', x: screenRect.x, y: screenRect.y + screenRect.h / 2 },
      { name: 'e', x: screenRect.x + screenRect.w, y: screenRect.y + screenRect.h / 2 }
    ];

    for (const handle of handles) {
      if (Math.abs(point.x - handle.x) <= tolerance && Math.abs(point.y - handle.y) <= tolerance) {
        return handle.name;
      }
    }

    return null;
  };

  const updateCursor = (point: { x: number; y: number }) => {
    const container = containerRef.current;
    if (!container) return;

    const handle = getResizeHandle(point);
    if (handle) {
      const cursors: Record<string, string> = {
        'nw': 'nw-resize', 'ne': 'ne-resize', 'sw': 'sw-resize', 'se': 'se-resize',
        'n': 'n-resize', 's': 's-resize', 'w': 'w-resize', 'e': 'e-resize'
      };
      container.style.cursor = cursors[handle];
    } else if (getROIAtPoint(point)) {
      container.style.cursor = 'pointer';
    } else {
      container.style.cursor = 'crosshair';
    }
  };

  const handleROIResize = (point: { x: number; y: number }) => {
    // Implementation for ROI resizing based on handle
    // This would update the currentDrawing or directly modify the ROI
  };

  const createNewROI = async () => {
    if (!currentDrawing || !selected) return;
    
    const name = `ROI ${rois.length + 1}`;
    try {
      const newROI = await createROI(selected.id, name, currentDrawing);
      setRois(prev => [...prev, newROI]);
      setCurrentDrawing(null);
    } catch (error) {
      console.error('Failed to create ROI:', error);
    }
  };

  const updateROIGeometry = async () => {
    // Update ROI geometry after resize
  };

  // Fit image to container
  const fitToContainer = useCallback(() => {
    if (!viewport.imageSize.width || !viewport.containerSize.width) return;

    const scaleX = viewport.containerSize.width / viewport.imageSize.width;
    const scaleY = viewport.containerSize.height / viewport.imageSize.height;
    const newScale = Math.min(scaleX, scaleY) * 0.9; // 90% to leave some margin

    const newOffsetX = (viewport.containerSize.width - viewport.imageSize.width * newScale) / 2;
    const newOffsetY = (viewport.containerSize.height - viewport.imageSize.height * newScale) / 2;

    setViewport(prev => ({
      ...prev,
      scale: newScale,
      offset: { x: newOffsetX, y: newOffsetY }
    }));
  }, [viewport.imageSize, viewport.containerSize]);

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

      {/* Right: main viewer */}
      <div className="relative flex-1 bg-white rounded-2xl shadow p-3">
        <div className="flex items-center justify-between pb-2">
          <div className="font-semibold">{selected?.name}</div>
          <div className="flex items-center gap-2">
            <button 
              className="px-2 py-1 rounded bg-gray-100" 
              onClick={() => setViewport(prev => ({ ...prev, scale: prev.scale * 1.1 }))}
            >
              ＋
            </button>
            <button 
              className="px-2 py-1 rounded bg-gray-100" 
              onClick={() => setViewport(prev => ({ ...prev, scale: prev.scale / 1.1 }))}
            >
              －
            </button>
            <button 
              className="px-2 py-1 rounded bg-gray-100" 
              onClick={fitToContainer}
            >
              Fit
            </button>
            <button 
              className="px-2 py-1 rounded bg-gray-100" 
              onClick={() => setViewport(prev => ({ ...prev, scale: 1, offset: { x: 0, y: 0 } }))}
            >
              Reset
            </button>
            <div className="text-sm text-gray-500 ml-2">
              Zoom: {(viewport.scale * 100).toFixed(0)}%
            </div>
          </div>
        </div>

        <div
          ref={containerRef}
          className="relative overflow-hidden rounded-xl bg-gray-50 border h-[500px] select-none"
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {/* Image */}
          <img
            ref={imgRef}
            src={selected?.imageUrl}
            onLoad={handleImageLoad}
            alt={selected?.name}
            className="origin-top-left pointer-events-none absolute"
            style={{
              transform: `translate(${viewport.offset.x}px, ${viewport.offset.y}px) scale(${viewport.scale})`,
            }}
          />

          {/* Existing ROIs */}
          {rois.map((roi) => {
            const screenRect = {
              x: viewport.offset.x + roi.geometry.x * viewport.scale,
              y: viewport.offset.y + roi.geometry.y * viewport.scale,
              w: roi.geometry.w * viewport.scale,
              h: roi.geometry.h * viewport.scale
            };

            return (
              <div key={roi.id}>
                {/* ROI rectangle */}
                <div
                  className={`absolute border-2 ${
                    selectedROI?.id === roi.id ? 'border-red-500 bg-red-100/20' : 'border-green-500 bg-green-100/20'
                  }`}
                  style={{ 
                    left: screenRect.x, 
                    top: screenRect.y, 
                    width: screenRect.w, 
                    height: screenRect.h 
                  }}
                >
                  {/* ROI label */}
                  <div className="absolute -top-6 left-0 text-xs bg-green-600 text-white px-1 rounded">
                    {roi.name}
                  </div>
                </div>

                {/* Resize handles for selected ROI */}
                {selectedROI?.id === roi.id && (
                  <>
                    {/* Corner handles */}
                    <div className="absolute w-2 h-2 bg-red-500 border border-white" 
                         style={{ left: screenRect.x - 4, top: screenRect.y - 4 }} />
                    <div className="absolute w-2 h-2 bg-red-500 border border-white" 
                         style={{ left: screenRect.x + screenRect.w - 4, top: screenRect.y - 4 }} />
                    <div className="absolute w-2 h-2 bg-red-500 border border-white" 
                         style={{ left: screenRect.x - 4, top: screenRect.y + screenRect.h - 4 }} />
                    <div className="absolute w-2 h-2 bg-red-500 border border-white" 
                         style={{ left: screenRect.x + screenRect.w - 4, top: screenRect.y + screenRect.h - 4 }} />
                    
                    {/* Edge handles */}
                    <div className="absolute w-2 h-2 bg-red-500 border border-white" 
                         style={{ left: screenRect.x + screenRect.w / 2 - 4, top: screenRect.y - 4 }} />
                    <div className="absolute w-2 h-2 bg-red-500 border border-white" 
                         style={{ left: screenRect.x + screenRect.w / 2 - 4, top: screenRect.y + screenRect.h - 4 }} />
                    <div className="absolute w-2 h-2 bg-red-500 border border-white" 
                         style={{ left: screenRect.x - 4, top: screenRect.y + screenRect.h / 2 - 4 }} />
                    <div className="absolute w-2 h-2 bg-red-500 border border-white" 
                         style={{ left: screenRect.x + screenRect.w - 4, top: screenRect.y + screenRect.h / 2 - 4 }} />
                  </>
                )}
              </div>
            );
          })}

          {/* Currently drawing ROI */}
          {currentDrawing && (
            <div
              className="absolute border-2 border-blue-500 bg-blue-100/20"
              style={{ 
                left: viewport.offset.x + currentDrawing.x * viewport.scale, 
                top: viewport.offset.y + currentDrawing.y * viewport.scale, 
                width: currentDrawing.w * viewport.scale, 
                height: currentDrawing.h * viewport.scale 
              }}
            />
          )}

          {/* Instructions */}
          <div className="absolute top-3 left-3 text-xs text-gray-600 bg-white/80 rounded px-2 py-1">
            Drag: Draw ROI | Shift+Drag: Pan | Wheel: Zoom
          </div>
        </div>

        {/* ROI controls */}
        <div className="flex items-center justify-between mt-3">
          <div className="text-sm text-gray-500">
            ROIs: {rois.length} | Selected: {selectedROI?.name || 'None'}
          </div>
          {selectedROI && onAnalyzeROI && selected && (
            <button
              className="px-3 py-1.5 bg-blue-600 text-white rounded-xl"
              onClick={() => onAnalyzeROI(selectedROI, selected)}
            >
              Analyze Selected ROI
            </button>
          )}
        </div>
      </div>
    </div>
  );
}