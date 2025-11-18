import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import fsPromises from 'fs/promises';
import crypto from 'crypto';
import { ensureDzi } from '../lib/dziGenerator.js';

const router = express.Router();

const TEMP_UPLOAD_ROOT = path.join(process.cwd(), 'tmp', 'simple-uploads');
const STORAGE_ROOT = path.join(process.cwd(), 'data', 'simple-uploads');
const PUBLIC_ROOT = path.join(process.cwd(), 'public', 'uploads');

for (const dir of [TEMP_UPLOAD_ROOT, STORAGE_ROOT, PUBLIC_ROOT]) {
  fs.mkdirSync(dir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, TEMP_UPLOAD_ROOT);
  },
  filename: (_req, file, cb) => {
    const sanitized = file.originalname
      .trim()
      .replace(/[^A-Za-z0-9._-]/g, '_')
      .replace(/_+/g, '_') || 'upload';
    cb(null, `${Date.now()}-${sanitized}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 1_500_000_000 // ~1.5 GB safety cap
  }
});

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

const deletePathIfExists = async (targetPath) => {
  if (!targetPath) return;
  try {
    await fsPromises.rm(targetPath, { recursive: true, force: true });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Failed to cleanup path ${targetPath}:`, error);
    }
  }
};

router.post('/', upload.single('file'), asyncHandler(async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'file is required' });
  }

  const uploadId = crypto.randomUUID();
  const originalDir = path.join(STORAGE_ROOT, uploadId);
  const publicDir = path.join(PUBLIC_ROOT, uploadId);

  await fsPromises.mkdir(originalDir, { recursive: true });
  await fsPromises.mkdir(publicDir, { recursive: true });

  const sanitizedOriginalName = file.originalname
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/_+/g, '_') || file.filename;
  const originalPath = path.join(originalDir, sanitizedOriginalName);

  let movedTempFile = false;
  try {
    await fsPromises.rename(file.path, originalPath);
    movedTempFile = true;

    const manifestPath = path.join(publicDir, 'manifest.dzi');

    const { tilesDir } = await ensureDzi({
      sourcePath: originalPath,
      manifestPath,
      tileSize: 512,
      overlap: 0,
      format: 'jpeg'
    });

    const manifestUrl = `/public/uploads/${uploadId}/manifest.dzi`;
    const tilesFolder = path.basename(tilesDir);
    const tileBaseUrl = `/public/uploads/${uploadId}/${tilesFolder}`;

    const extension = path.extname(file.originalname || '').toLowerCase() || null;

    const slide = {
      id: uploadId,
      name: file.originalname,
      dziManifestUrl: manifestUrl,
      dziTileBaseUrl: tileBaseUrl,
      sourceType: 'uploaded',
      format: extension,
      files: {
        image: {
          originalName: file.originalname,
          storedName: path.basename(originalPath),
          path: originalPath,
          size: file.size,
          mimeType: file.mimetype,
          uploadedAt: Date.now()
        }
      }
    };

    res.status(201).json(slide);
  } catch (error) {
    await deletePathIfExists(originalDir);
    await deletePathIfExists(publicDir);
    if (!movedTempFile) {
      await deletePathIfExists(file.path);
    }
    throw error;
  }
}));

export default router;
