import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { Slide, ROI } from '../types';
import { fetchROIs, createROI, deleteROI } from '../lib/api';

// Import OpenSeadragon without types (use any for now)
declare const OpenSeadragon: any;

type Props = {
  slides: Slide[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAnalyzeROI?: (roi: ROI, slide: Slide) => void;
};

interface ExtendedROI extends ROI {
  overlay?: HTMLElement;
}

export default function OpenSeadragonViewer({ slides, selectedId, onSelect, onAnalyzeROI }: Props) {
  const selected = slides.find(s => s.id === selectedId) ?? slides[0];
  const viewerRef = useRef<HTMLDivElement>(null);
  const osdViewerRef = useRef<any>(null);
  
  const [rois, setRois] = useState<ExtendedROI[]>([]);
  const [selectedROI, setSelectedROI] = useState<ExtendedROI | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // Initialize OpenSeadragon viewer
  useEffect(() => {
    if (!viewerRef.current || !selected) return;

    // Destroy existing viewer
    if (osdViewerRef.current) {
      osdViewerRef.current.destroy();
    }

    // Import OpenSeadragon dynamically
    import('openseadragon').then((OSD) => {
      const OpenSeadragon = OSD.default;
      
      osdViewerRef.current = OpenSeadragon({
        element: viewerRef.current,
        tileSources: {
          type: 'image',
          url: selected.imageUrl
        },
        prefixUrl: 'https://openseadragon.github.io/images/',
        animationTime: 0.3,
        showNavigationControl: true,
        showZoomControl: true,
        showHomeControl: true,
        showFullPageControl: false,
        gestureSettingsMouse: {
          clickToZoom: false,
          dblClickToZoom: true,
          dblClickDragToZoom: false,
          flickEnabled: false
        },
        zoomPerScroll: 1.2
      });

      setupEventHandlers(OpenSeadragon);
      
      // Load ROIs after viewer is ready
      osdViewerRef.current.addHandler('open', () => {
        if (selected?.id) {
          fetchROIs(selected.id).then(loadROIs);
        }
      });
    });

    return () => {
      if (osdViewerRef.current) {
        osdViewerRef.current.destroy();
        osdViewerRef.current = null;
      }
    };
  }, [selected?.id]);

  const setupEventHandlers = (OpenSeadragon: any) => {
    const viewer = osdViewerRef.current;
    if (!viewer) return;

    let isMouseDown = false;
    let startPoint: any = null;
    let currentOverlay: HTMLElement | null = null;

    // Drawing ROI with Ctrl/Cmd + drag
    viewer.addHandler('canvas-press', (event: any) => {
      if (event.originalEvent.ctrlKey || event.originalEvent.metaKey) {
        event.preventDefaultAction = true;
        isMouseDown = true;
        
        startPoint = viewer.viewport.pointFromPixel(event.position);
        
        // Create drawing overlay
        currentOverlay = document.createElement('div');
        currentOverlay.style.cssText = `
          border: 2px solid #3b82f6;
          background: rgba(59, 130, 246, 0.2);
          pointer-events: none;
        `;
        
        viewer.addOverlay({
          element: currentOverlay,
          location: new OpenSeadragon.Rect(startPoint.x, startPoint.y, 0, 0)
        });

        setIsDrawing(true);
      }
    });

    // Update drawing ROI
    viewer.addHandler('canvas-drag', (event: any) => {
      if (isMouseDown && startPoint && currentOverlay) {
        event.preventDefaultAction = true;
        
        const currentPoint = viewer.viewport.pointFromPixel(event.position);
        
        const rect = new OpenSeadragon.Rect(
          Math.min(startPoint.x, currentPoint.x),
          Math.min(startPoint.y, currentPoint.y),
          Math.abs(currentPoint.x - startPoint.x),
          Math.abs(currentPoint.y - startPoint.y)
        );

        viewer.updateOverlay(currentOverlay, rect);
      }
    });

    // Finish drawing ROI
    viewer.addHandler('canvas-release', (event: any) => {
      if (isMouseDown && startPoint && currentOverlay) {
        const currentPoint = viewer.viewport.pointFromPixel(event.position);
        
        const rect = new OpenSeadragon.Rect(
          Math.min(startPoint.x, currentPoint.x),
          Math.min(startPoint.y, currentPoint.y),
          Math.abs(currentPoint.x - startPoint.x),
          Math.abs(currentPoint.y - startPoint.y)
        );

        // Create ROI if big enough
        if (rect.width > 0.01 && rect.height > 0.01) {
          createROIFromRect(rect);
        }

        // Clean up
        viewer.removeOverlay(currentOverlay);
        currentOverlay = null;
        isMouseDown = false;
        startPoint = null;
        setIsDrawing(false);
      }
    });

    // Click to select ROI
    viewer.addHandler('canvas-click', (event: any) => {
      if (!event.originalEvent.ctrlKey && !event.originalEvent.metaKey) {
        const viewportPoint = viewer.viewport.pointFromPixel(event.position);
        const clickedROI = findROIAtPoint(viewportPoint);
        
        if (clickedROI) {
          event.preventDefaultAction = true;
          setSelectedROI(clickedROI);
          updateROIHighlights(clickedROI);
        } else {
          setSelectedROI(null);
          updateROIHighlights(null);
        }
      }
    });
  };

  const createROIFromRect = async (rect: any) => {
    if (!selected || !osdViewerRef.current) return;

    try {
      // Convert viewport coordinates to image pixel coordinates
      const imageSize = osdViewerRef.current.world.getItemAt(0).getContentSize();
      
      const imageGeometry = {
        x: rect.x * imageSize.x,
        y: rect.y * imageSize.y,
        w: rect.width * imageSize.x,
        h: rect.height * imageSize.y
      };

      const name = `ROI ${rois.length + 1}`;
      const newROI = await createROI(selected.id, name, imageGeometry);
      
      const roiWithOverlay: ExtendedROI = { ...newROI, overlay: undefined };
      addROIOverlay(roiWithOverlay, rect);
      
      setRois(prev => [...prev, roiWithOverlay]);
    } catch (error) {
      console.error('Failed to create ROI:', error);
    }
  };

  const addROIOverlay = (roi: ExtendedROI, rect?: any) => {
    const viewer = osdViewerRef.current;
    if (!viewer) return;

    // Calculate viewport rect if not provided
    let viewportRect = rect;
    if (!rect && viewer.world.getItemAt(0)) {
      const imageSize = viewer.world.getItemAt(0).getContentSize();
      viewportRect = {
        x: roi.geometry.x / imageSize.x,
        y: roi.geometry.y / imageSize.y,
        width: roi.geometry.w / imageSize.x,
        height: roi.geometry.h / imageSize.y
      };
    }

    // Create ROI element
    const roiElement = document.createElement('div');
    roiElement.style.cssText = `
      border: 2px solid #10b981;
      background: rgba(16, 185, 129, 0.2);
      cursor: pointer;
      position: relative;
      pointer-events: none;
      user-select: none;
    `;
    
    // Add label
    const label = document.createElement('div');
    label.style.cssText = `
      position: absolute;
      top: -24px;
      left: 0;
      font-size: 12px;
      background: #10b981;
      color: white;
      padding: 2px 6px;
      border-radius: 3px;
      white-space: nowrap;
      pointer-events: none;
      user-select: none;
    `;
    label.textContent = roi.name;
    roiElement.appendChild(label);

    // Add overlay
    viewer.addOverlay({
      element: roiElement,
      location: viewportRect
    });

    roi.overlay = roiElement;
  };

  const loadROIs = (loadedROIs: ROI[]) => {
    const viewer = osdViewerRef.current;
    if (!viewer) return;

    // Clear existing overlays
    viewer.clearOverlays();

    // Add overlays for all ROIs
    const roisWithOverlays: ExtendedROI[] = loadedROIs.map(roi => ({ ...roi, overlay: undefined }));
    roisWithOverlays.forEach(roi => addROIOverlay(roi));
    
    setRois(roisWithOverlays);
  };

  const findROIAtPoint = (point: any): ExtendedROI | null => {
    const viewer = osdViewerRef.current;
    if (!viewer || !viewer.world.getItemAt(0)) return null;

    const imageSize = viewer.world.getItemAt(0).getContentSize();
    const imagePoint = {
      x: point.x * imageSize.x,
      y: point.y * imageSize.y
    };

    return rois.find(roi => {
      return imagePoint.x >= roi.geometry.x &&
             imagePoint.x <= roi.geometry.x + roi.geometry.w &&
             imagePoint.y >= roi.geometry.y &&
             imagePoint.y <= roi.geometry.y + roi.geometry.h;
    }) || null;
  };

  const updateROIHighlights = (selectedROI: ExtendedROI | null) => {
    rois.forEach(roi => {
      if (roi.overlay) {
        roi.overlay.style.borderColor = roi.id === selectedROI?.id ? '#ef4444' : '#10b981';
        roi.overlay.style.backgroundColor = roi.id === selectedROI?.id ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)';
      }
    });
  };

  const handleDeleteROI = async (roi: ExtendedROI) => {
    if (!selected) return;

    try {
      await deleteROI(selected.id, roi.id);
      
      // Remove overlay
      if (roi.overlay && osdViewerRef.current) {
        osdViewerRef.current.removeOverlay(roi.overlay);
      }
      
      setRois(prev => prev.filter(r => r.id !== roi.id));
      if (selectedROI?.id === roi.id) {
        setSelectedROI(null);
      }
    } catch (error) {
      console.error('Failed to delete ROI:', error);
    }
  };

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
          <div className="text-sm text-gray-500">
            OpenSeadragon Viewer - ROIs: {rois.length}
          </div>
        </div>

        {/* OpenSeadragon viewer */}
        <div 
          ref={viewerRef}
          className="w-full h-[500px] border rounded-xl"
          style={{ background: '#f8f9fa' }}
        />

        {/* Instructions */}
        <div className="text-xs text-gray-600 mt-2 space-y-1">
          <div>• <strong>Ctrl/Cmd + Drag:</strong> Draw new ROI</div>
          <div>• <strong>Click ROI:</strong> Select ROI</div>
          <div>• <strong>Mouse wheel:</strong> Zoom in/out</div>
          <div>• <strong>Drag:</strong> Pan image</div>
        </div>

        {/* ROI controls */}
        <div className="flex items-center justify-between mt-3">
          <div className="text-sm text-gray-500">
            Selected: {selectedROI?.name || 'None'}
          </div>
          <div className="flex gap-2">
            {selectedROI && (
              <>
                <button
                  className="px-3 py-1.5 bg-red-600 text-white rounded-xl text-sm"
                  onClick={() => handleDeleteROI(selectedROI)}
                >
                  Delete ROI
                </button>
                {onAnalyzeROI && selected && (
                  <button
                    className="px-3 py-1.5 bg-blue-600 text-white rounded-xl text-sm"
                    onClick={() => onAnalyzeROI(selectedROI, selected)}
                  >
                    Analyze ROI
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* ROI List */}
        <div className="mt-4 max-h-32 overflow-y-auto">
          <div className="text-sm font-medium mb-2">Regions of Interest</div>
          {rois.length === 0 ? (
            <div className="text-xs text-gray-500">No ROIs defined. Ctrl/Cmd + drag to create one.</div>
          ) : (
            <div className="space-y-1">
              {rois.map((roi) => (
                <div 
                  key={roi.id}
                  className={`flex items-center justify-between p-2 rounded text-xs cursor-pointer transition ${
                    selectedROI?.id === roi.id ? 'bg-red-100 border border-red-300' : 'bg-gray-50 hover:bg-gray-100'
                  }`}
                  onClick={() => {
                    setSelectedROI(roi);
                    updateROIHighlights(roi);
                  }}
                >
                  <div className="flex-1">
                    <div className="font-medium">{roi.name}</div>
                    <div className="text-gray-500">
                      {Math.round(roi.geometry.w)} × {Math.round(roi.geometry.h)} px
                    </div>
                  </div>
                  <div className="flex gap-1">
                    {onAnalyzeROI && selected && (
                      <button
                        className="px-2 py-1 bg-blue-600 text-white rounded text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedROI(roi);
                          onAnalyzeROI(roi, selected);
                        }}
                      >
                        Analyze
                      </button>
                    )}
                    <button
                      className="px-2 py-1 bg-red-600 text-white rounded text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteROI(roi);
                      }}
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
    </div>
  );
}