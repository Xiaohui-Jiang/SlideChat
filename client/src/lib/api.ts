import type { Slide, ROI, Rect } from '../types';

const API = '/api';
export const DEFAULT_PROJECT_ID = 'default-project';

const resolveProjectId = (projectId?: string) => projectId ?? DEFAULT_PROJECT_ID;

const projectImageROIsEndpoint = (projectId: string, imageId: string) =>
  `${API}/projects/${encodeURIComponent(projectId)}/images/${encodeURIComponent(imageId)}/rois`;

const projectImageROIEndpoint = (projectId: string, imageId: string, roiId: string) =>
  `${projectImageROIsEndpoint(projectId, imageId)}/${encodeURIComponent(roiId)}`;

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
        id: 'xenium_human_kidney_he',
        name: 'Xenium_V1_Human_Kidney_FFPE_Protein_updated_he_image.ome.tif',
        projectId: DEFAULT_PROJECT_ID,
        imageUrl: 'http://localhost:5050/public/slides/human_kidney/human_kidney_he_preview.jpg',
        thumbnailUrl: 'http://localhost:5050/public/slides/human_kidney/thumbnail.jpg',
        sourceType: 'demo',
        format: '.ome.tif',
        metadata: {
          isBiologicalImage: true,
          tissueType: 'kidney',
          staining: 'H&E',
          magnification: '20x',
          description: 'Xenium FFPE kidney morphology image from the provided Human_Kidney_test_data dataset',
          pixelSize: { x: 0.2125, y: 0.2125, unit: 'µm' },
          fileFormat: 'OME-TIFF',
          roiAlignmentCsv: 'http://localhost:5050/public/data/human_kidney/Xenium_V1_Human_Kidney_FFPE_Protein_updated_he_imagealignment.csv',
          source: 'Human_Kidney_test_data',
          originalAssetPath: 'http://localhost:5050/public/slides/human_kidney/human_kidney_he.ome.tif'
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
export async function fetchROIs(slideId: string, projectId?: string): Promise<ROI[]> {
  const pid = resolveProjectId(projectId);
  return safeFetch<ROI[]>(
    projectImageROIsEndpoint(pid, slideId),
    { method: 'GET' },
    () => []
  );
}

export async function createROI(slideId: string, name: string, geometry: Rect, projectId?: string): Promise<ROI> {
  const pid = resolveProjectId(projectId);
  const res = await fetch(projectImageROIsEndpoint(pid, slideId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, geometry })
  });
  if (!res.ok) throw new Error(`Create ROI failed: ${res.status}`);
  return (await res.json()) as ROI;
}

export async function updateROIName(slideId: string, roiId: string, name: string, projectId?: string): Promise<ROI> {
  const pid = resolveProjectId(projectId);
  const res = await fetch(projectImageROIEndpoint(pid, slideId, roiId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  if (!res.ok) throw new Error(`Update ROI failed: ${res.status}`);
  return (await res.json()) as ROI;
}

export async function deleteROI(slideId: string, roiId: string, projectId?: string): Promise<void> {
  const pid = resolveProjectId(projectId);
  const res = await fetch(projectImageROIEndpoint(pid, slideId, roiId), {
    method: 'DELETE'
  });
  if (!res.ok) throw new Error(`Delete ROI failed: ${res.status}`);
}

// Image-based ROI API functions (new structure)
export async function fetchImageROIs(imageId: string, projectId?: string): Promise<ROI[]> {
  return fetchROIs(imageId, projectId);
}

export async function createImageROI(imageId: string, name: string, geometry: Rect, projectId?: string): Promise<ROI> {
  return createROI(imageId, name, geometry, projectId);
}

export async function deleteImageROI(imageId: string, roiId: string, projectId?: string): Promise<void> {
  return deleteROI(imageId, roiId, projectId);
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
