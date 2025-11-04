import React, { useState } from 'react';
import type { Image, ROI } from '../types';
import OpenSeadragonSlideViewer from './OpenSeadragonSlideViewer';

interface ImageViewerPanelProps {
  selectedImage: Image | null;
  className?: string;
  rois?: ROI[];
  selectedROI?: ROI | null;
  onROICreate?: (roiData: Omit<ROI, "id" | "createdAt">) => Promise<void>;
  onROISelect?: (roi: ROI | null) => void;
  onROIUpdate?: (roiId: string, updates: Partial<ROI>) => void;
  onROIDelete?: (roiId: string) => void;
  onAnalyzeROI?: (roi: any, image: any) => void;
}

export default function ImageViewerPanel({ 
  selectedImage, 
  className = '', 
  rois,
  selectedROI,
  onROICreate,
  onROISelect,
  onROIUpdate,
  onROIDelete,
  onAnalyzeROI 
}: ImageViewerPanelProps) {
  const [activeTab, setActiveTab] = useState<'viewer' | 'code'>('viewer');

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
        {activeTab === 'viewer' && selectedImage && (
          <OpenSeadragonSlideViewer
            slides={[selectedImage]}
            selectedId={selectedImage.id}
            onSelect={() => {}}
            projectId={selectedImage.projectId}
            onAnalyzeROI={onAnalyzeROI}
          />
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
    </div>
  );
}
