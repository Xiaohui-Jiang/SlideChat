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
        id: 'lung_01',
        name: 'lung_01.svs',
        imageUrl: 'https://picsum.photos/seed/lung/1600/1200',
        thumbnailUrl: 'https://picsum.photos/seed/lung/240/180',
        sourceType: 'uploaded',
      },
    ]
  );
}

export async function sendChat(message: string): Promise<string> {
  console.log('🌐 API: Sending chat request to server:', message);
  try {
    const result = await safeFetch<{ reply: string }>(
      `${API}/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      },
      () => {
        console.log('⚠️ API: Using fallback mock response');
        return { reply: `Mock reply: I received "${message}".` };
      }
    );
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
