export type ID = string;

export interface Project {
  id: ID;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt?: number;
  imageIds: ID[];
}

export interface ProjectFileMetadata {
  originalName: string;
  storedName: string;
  path: string;
  size: number;
  mimeType: string;
  uploadedAt: number;
}

export interface ProjectImageStatus {
  required: string[];
  missing: string[];
  ready: boolean;
  processed: boolean;
  processedAt: number | null;
}

export type PipelineRunStatus = 'idle' | 'pending' | 'queued' | 'processing' | 'completed' | 'failed';

export interface PipelineJobState {
  status: PipelineRunStatus;
  error?: string | null;
  jobId?: string | null;
  updatedAt?: number;
  startedAt?: number | null;
  completedAt?: number | null;
}

export interface ImagePipelineState {
  preprocess?: PipelineJobState;
}

export interface Image {
  id: ID;
  name: string;
  dziManifestUrl?: string | null;
  dziTileBaseUrl?: string | null;
  assetVersion?: number | null;
  sourceType?: 'local' | 'uploaded' | 'demo';
  projectId?: ID;
  format?: string;
  label?: string;
  thumbnailUrl?: string | null;
  files?: Record<string, ProjectFileMetadata>;
  status?: ProjectImageStatus;
  processed?: Record<string, unknown> | null;
  pipeline?: ImagePipelineState;
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

export interface ROIStats {
  n_cells?: number;
  n_cells_total?: number | null;
  percentage?: number;
}

export interface ROI {
  id: ID;
  name: string;
  projectId: ID;
  imageId: ID;
  geometry: Rect;
  polygon?: number[][];
  polygon_centroids?: number[][];
  stats?: ROIStats;
  status?: PipelineRunStatus;
  jobId?: string | null;
  error?: string | null;
  createdAt: number;
  updatedAt?: number;
}

export interface ProjectRequirements {
  required: string[];
  optional: string[];
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
