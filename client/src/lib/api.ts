import type { Slide, ROI, Rect } from '../types';

const API = '/api';

async function safeFetch<T>(input: RequestInfo, init: RequestInit | undefined, mock: () => T): Promise<T> {
  try {
    const res = await fetch(input, init);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch {
    return mock();
  }
}

export async function fetchSlides(): Promise<Slide[]> {
  return safeFetch<Slide[]>(
    `${API}/slides`,
    { method: 'GET' },
    () => [
      {
        id: 'demo_he_tissue111111',
        name: 'demo_he_tissue11111.jpg',
        imageUrl: 'http://localhost:5050/public/slides/demo_he_tissue/demopic.jpg',
        thumbnailUrl: 'http://localhost:5050/public/slides/demo_he_tissue/demopic.jpg',
        sourceType: 'demo',
        format: '.jpg',
        metadata: {
          isBiologicalImage: true,
          tissueType: 'intestinal',
          staining: 'H&E',
          magnification: '20x',
          description: 'High-quality H&E stained tissue showing glandular structures and stromal components'
        }
      },
    ]
  );
}

interface ChatResponse {
  conversationId: string;
  reply: string;
  source: string;
  functions_used?: string[];
  summary?: string | null;
  error?: string;
}

// Store conversation state
let currentConversationId: string | null = null;

export async function sendChat(message: string): Promise<string> {
  console.log('🌐 API: Sending chat request to server:', message);
  try {
    const requestBody = {
      message,
      ...(currentConversationId && { conversationId: currentConversationId }),
      userId: 'user',
      metadata: { timestamp: Date.now() }
    };

    const result = await safeFetch<ChatResponse>(
      `${API}/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      },
      () => {
        console.log('⚠️ API: Using fallback mock response');
        return {
          conversationId: 'mock-conversation',
          reply: `Mock reply: I received "${message}".`,
          source: 'fallback'
        };
      }
    );

    // Store conversation ID for subsequent requests
    if (result.conversationId) {
      currentConversationId = result.conversationId;
    }

    console.log('🌐 API: Got response from server:', result);
    return result.reply;
  } catch (error) {
    console.error('🚨 API ERROR in sendChat:', error);
    throw error;
  }
}

/**
 * Upload a file to the backend.
 * Server should return: { id, name, imageUrl, thumbnailUrl }
 */
export async function uploadSlideToServer(file: File) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${API}/upload`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return (await res.json()) as Slide;
}

// ROI API functions
export async function fetchROIs(slideId: string): Promise<ROI[]> {
  return safeFetch<ROI[]>(
    `${API}/slides/${slideId}/rois`,
    { method: 'GET' },
    () => []
  );
}

export async function createROI(slideId: string, name: string, geometry: Rect): Promise<ROI> {
  const res = await fetch(`${API}/slides/${slideId}/rois`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, geometry })
  });
  if (!res.ok) throw new Error(`Create ROI failed: ${res.status}`);
  return (await res.json()) as ROI;
}

export async function updateROIName(slideId: string, roiId: string, name: string): Promise<ROI> {
  const res = await fetch(`${API}/slides/${slideId}/rois/${roiId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  if (!res.ok) throw new Error(`Update ROI failed: ${res.status}`);
  return (await res.json()) as ROI;
}

export async function deleteROI(slideId: string, roiId: string): Promise<void> {
  const res = await fetch(`${API}/slides/${slideId}/rois/${roiId}`, {
    method: 'DELETE'
  });
  if (!res.ok) throw new Error(`Delete ROI failed: ${res.status}`);
}

// Image-based ROI API functions (new structure)
export async function fetchImageROIs(imageId: string): Promise<ROI[]> {
  return safeFetch<ROI[]>(
    `${API}/images/${imageId}/rois`,
    { method: 'GET' },
    () => []
  );
}

export async function createImageROI(imageId: string, name: string, geometry: Rect): Promise<ROI> {
  const res = await fetch(`${API}/images/${imageId}/rois`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, geometry })
  });
  if (!res.ok) throw new Error(`Create ROI failed: ${res.status}`);
  return (await res.json()) as ROI;
}

// Biological image specific API functions
export async function getImageMetadata(imageId: string) {
  return safeFetch(
    `${API}/images/${imageId}/metadata`,
    { method: 'GET' },
    () => ({})
  );
}

export async function getProcessingStatus(imageId: string) {
  return safeFetch(
    `${API}/images/${imageId}/processing-status`,
    { method: 'GET' },
    () => ({ status: 'unknown', progress: 0 })
  );
}

export async function getSupportedFormats() {
  return safeFetch(
    `${API}/supported-formats`,
    { method: 'GET' },
    () => ({
      biologicalFormats: [],
      standardFormats: []
    })
  );
}
