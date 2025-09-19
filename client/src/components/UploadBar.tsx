import React from 'react';
import type { Slide } from '../types';
import { uploadSlideToServer } from '../lib/api';

type Props = {
  onAddSlide: (slide: Slide) => void;
};

const ACCEPT = [
  'image/*',          // png/jpg etc.
  '.svs',             // whole-slide images (server must convert)
  '.tif', '.tiff',    // optional
].join(',');

export default function UploadBar({ onAddSlide }: Props) {
  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const isImage = file.type.startsWith('image/');

    try {
      if (isImage) {
        // Immediate client-side preview for standard images
        const url = URL.createObjectURL(file);
        const thumb = URL.createObjectURL(file); // keep simple; you can generate a small canvas later
        onAddSlide({
          id: crypto.randomUUID(),
          name: file.name,
          imageUrl: url,
          thumbnailUrl: thumb,
          sourceType: 'local',
        });
      } else if (ext === 'svs' || ext === 'tif' || ext === 'tiff') {
        // Send to server for conversion/preview creation
        const uploaded = await uploadSlideToServer(file);
        onAddSlide({ ...uploaded, sourceType: 'uploaded' });
      } else {
        alert('Unsupported file type. Please upload an image or .svs/.tif');
      }
    } catch (err: any) {
      alert(err?.message ?? 'Upload failed');
    } finally {
      // reset the input so the same file can be picked again
      e.target.value = '';
    }
  }

  return (
    <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white border shadow cursor-pointer">
      <span className="text-sm font-medium">Upload slide</span>
      <input type="file" accept={ACCEPT} onChange={onChange} className="hidden" />
    </label>
  );
}
