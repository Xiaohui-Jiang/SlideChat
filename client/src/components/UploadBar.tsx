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

    try {
      if (file.type.startsWith('image/') || ['svs', 'tif', 'tiff'].includes(ext)) {
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
    <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white border shadow cursor-pointer" htmlFor="slide-upload-input">
      <span className="text-sm font-medium">Upload slide</span>
      <input
        id="slide-upload-input"
        name="slideUpload"
        type="file"
        accept={ACCEPT}
        onChange={onChange}
        className="hidden"
      />
    </label>
  );
}
