import type { Slide } from '../types';

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
  return safeFetch<{ reply: string }>(
    `${API}/chat`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    },
    () => ({ reply: `Mock reply: I received “${message}”.` })
  ).then(r => r.reply);
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
