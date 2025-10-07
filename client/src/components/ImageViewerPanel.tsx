import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Rect, Image, ROI } from '../types';

interface ImageViewerPanelProps {
  selectedImage: Image | null;
  rois: ROI[];
  selectedROI: ROI | null;
  onROICreate: (roi: Omit<ROI, 'id' | 'createdAt'>) => void;
  onROISelect: (roi: ROI | null) => void;
  onROIUpdate: (roiId: string, updates: Partial<ROI>) => void;
  onROIDelete: (roiId: string) => void;
  onAnalyzeROI?: (roi: ROI, image: Image) => void;
  className?: string;
}

export const ImageViewerPanel: React.FC<ImageViewerPanelProps> = ({
  selectedImage,
  rois,
  selectedROI,
  onROICreate,
  onROISelect,
  onROIUpdate,
  onROIDelete,
  onAnalyzeROI,
  className = ''
}) => {
  const [activeTab, setActiveTab] = useState<'viewer' | 'code'>('viewer');
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Image viewer state
  const [loaded, setLoaded] = useState(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  // ROI drawing state
  const [dragging, setDragging] = useState(false);
  const [startPt, setStartPt] = useState<{ x: number; y: number } | null>(null);
  const [currentDrawing, setCurrentDrawing] = useState<Rect | null>(null);
  const [showNameDialog, setShowNameDialog] = useState(false);
  const [roiName, setRoiName] = useState('');

  // Filter ROIs for current image
  const imageROIs = useMemo(() => 
    selectedImage ? rois.filter(roi => roi.imageId === selectedImage.id) : []
  , [rois, selectedImage]);

  useEffect(() => {
    // Reset view when image changes
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setCurrentDrawing(null);
    onROISelect(null);
    setLoaded(false);
  }, [selectedImage?.id, onROISelect]);

  const onWheel = (e: React.WheelEvent) => {
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
  };

  const startDrag = (e: React.MouseEvent) => {
    const rect = containerRef.current!.getBoundingClientRect();
    setStartPt({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setDragging(true);
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging || !startPt) return;
    const rect = containerRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const x0 = Math.min(startPt.x, x);
    const y0 = Math.min(startPt.y, y);
    const w = Math.abs(x - startPt.x);
    const h = Math.abs(y - startPt.y);

    setCurrentDrawing({ x: x0, y: y0, w, h });
  };

  const endDrag = () => {
    if (currentDrawing && currentDrawing.w > 10 && currentDrawing.h > 10) {
      setShowNameDialog(true);
      setRoiName(`ROI_${imageROIs.length + 1}`);
    }
    setDragging(false);
    setStartPt(null);
  };

  const saveROI = () => {
    if (!currentDrawing || !selectedImage) return;
    
    onROICreate({
      name: roiName,
      imageId: selectedImage.id,
      geometry: currentDrawing
    });

    setCurrentDrawing(null);
    setShowNameDialog(false);
    setRoiName('');
  };

  const cancelROI = () => {
    setCurrentDrawing(null);
    setShowNameDialog(false);
    setRoiName('');
  };

  if (!selectedImage) {
    return (
      <div className={`flex items-center justify-center h-full bg-gray-100 ${className}`}>
        <div className="text-gray-500">Select an image to view</div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full bg-white ${className}`}>
      {/* Tab Headers */}
      <div className="flex border-b">
        <button
          onClick={() => setActiveTab('viewer')}
          className={`px-4 py-2 text-sm font-medium ${
            activeTab === 'viewer' 
              ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-700' 
              : 'text-gray-600 hover:text-gray-800'
          }`}
        >
          Viewer
        </button>
        <button
          onClick={() => setActiveTab('code')}
          className={`px-4 py-2 text-sm font-medium ${
            activeTab === 'code' 
              ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-700' 
              : 'text-gray-600 hover:text-gray-800'
          }`}
        >
          Code Canvas
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'viewer' && (
          <div className="h-full flex flex-col">
            {/* Image Viewer */}
            <div className="flex-1 relative overflow-hidden bg-gray-100">
              <div
                ref={containerRef}
                className="w-full h-full cursor-crosshair"
                onWheel={onWheel}
                onMouseDown={startDrag}
                onMouseMove={onMouseMove}
                onMouseUp={endDrag}
              >
                <img
                  ref={imgRef}
                  src={selectedImage.imageUrl}
                  alt={selectedImage.name}
                  className="absolute"
                  style={{
                    transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                    transformOrigin: '0 0',
                  }}
                  onLoad={() => setLoaded(true)}
                />

                {/* Render existing ROIs */}
                {loaded && imageROIs.map((roi) => (
                  <div
                    key={roi.id}
                    className={`absolute border-2 cursor-pointer ${
                      selectedROI?.id === roi.id 
                        ? 'border-blue-500 bg-blue-200 bg-opacity-20' 
                        : 'border-red-500 bg-red-200 bg-opacity-10'
                    }`}
                    style={{
                      left: offset.x + roi.geometry.x * scale,
                      top: offset.y + roi.geometry.y * scale,
                      width: roi.geometry.w * scale,
                      height: roi.geometry.h * scale,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onROISelect(roi);
                    }}
                  >
                    <div className="absolute -top-6 left-0 text-xs bg-white px-1 rounded shadow">
                      {roi.name}
                    </div>
                  </div>
                ))}

                {/* Render current drawing */}
                {currentDrawing && (
                  <div
                    className="absolute border-2 border-green-500 bg-green-200 bg-opacity-20"
                    style={{
                      left: currentDrawing.x,
                      top: currentDrawing.y,
                      width: currentDrawing.w,
                      height: currentDrawing.h,
                    }}
                  />
                )}
              </div>
            </div>

            {/* ROI List */}
            <div className="h-40 border-t bg-gray-50 overflow-hidden flex flex-col">
              <div className="p-2 border-b bg-white flex justify-between items-center">
                <h3 className="font-medium text-sm">ROI List</h3>
                <button
                  onClick={() => {
                    setShowNameDialog(true);
                    setRoiName(`ROI_${imageROIs.length + 1}`);
                    setCurrentDrawing({ x: 100, y: 100, w: 200, h: 150 });
                  }}
                  className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  Create ROI
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                <div className="space-y-1">
                  {imageROIs.map((roi) => (
                    <div
                      key={roi.id}
                      className={`flex items-center justify-between p-2 text-sm border rounded cursor-pointer ${
                        selectedROI?.id === roi.id 
                          ? 'bg-blue-50 border-blue-300' 
                          : 'hover:bg-gray-50'
                      }`}
                      onClick={() => onROISelect(roi)}
                    >
                      <span className="flex-1">{roi.name}</span>
                      <div className="flex gap-1">
                        {onAnalyzeROI && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onAnalyzeROI(roi, selectedImage);
                            }}
                            className="px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600"
                          >
                            Analyze
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onROIDelete(roi.id);
                          }}
                          className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'code' && (
          <div className="h-full flex items-center justify-center bg-gray-50">
            <div className="text-center text-gray-500">
              <div className="text-lg font-medium mb-2">Code Canvas</div>
              <div className="text-sm">Visual query interface coming soon...</div>
            </div>
          </div>
        )}
      </div>

      {/* ROI Name Dialog */}
      {showNameDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-4 rounded-lg shadow-lg">
            <h3 className="font-medium mb-3">Name your ROI</h3>
            <input
              type="text"
              value={roiName}
              onChange={(e) => setRoiName(e.target.value)}
              className="w-full px-3 py-2 border rounded mb-3"
              placeholder="Enter ROI name"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={cancelROI}
                className="px-3 py-2 text-sm bg-gray-500 text-white rounded hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={saveROI}
                className="px-3 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                Save ROI
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};