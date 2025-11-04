export type ID = string;

export interface Project {
  id: ID;
  name: string;
  description?: string;
  createdAt: number;
  imageIds: ID[];
}

export interface Image {
  id: ID;
  name: string;
  imageUrl: string;
  thumbnailUrl: string;
  sourceType?: 'local' | 'uploaded' | 'demo';
  projectId?: ID;
  format?: string;
  metadata?: BiologicalImageMetadata;
}

export interface BiologicalImageMetadata {
  isBiologicalImage?: boolean;
  tissueType?: string;
  staining?: string;
  magnification?: string;
  channels?: string[];
  scanner?: string;
  fileSize?: number;
  dimensions?: { width: number; height: number };
  pixelSize?: { x: number; y: number; unit: string };
  acquisitionDate?: string;
  fileFormat?: string;
  pyramidLevels?: number;
  needsProcessing?: boolean;
  description?: string;
  source?: string;
  roiAlignmentCsv?: string;
  originalAssetPath?: string;
}

export type Slide = Image;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ROI {
  id: ID;
  name: string;
  projectId: ID;
  imageId: ID;
  geometry: Rect;
  createdAt: number;
}

export interface ChatMessage {
  id: ID;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

export interface LogEntry {
  id: ID;
  timestamp: number;
  level: 'info' | 'warning' | 'error' | 'success';
  message: string;
}

export interface AnalysisResult {
  id: ID;
  roiId?: ID;
  imageId?: ID;
  type: 'cell_typing' | 'feature_analysis' | 'similarity_search' | 'roi_analysis';
  data: Record<string, any>;
  timestamp: number;
}
