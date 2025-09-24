export type ID = string;

export interface Slide {
  id: ID;
  name: string;
  imageUrl: string;      // full-size/preview URL (JPEG/PNG or DeepZoom landing image)
  thumbnailUrl: string;  // small preview URL
  sourceType?: 'local' | 'uploaded'; // optional: track where it came from
}

export interface Rect {
  x: number; y: number; w: number; h: number;
}

export interface ROI {
  id: ID;
  name: string;
  slideId: ID;
  geometry: Rect;
  createdAt: number;
}

export interface ChatMessage {
  id: ID;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}
