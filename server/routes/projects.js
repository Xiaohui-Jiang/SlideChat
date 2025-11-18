import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import fsPromises from 'fs/promises';
import {
  createProject,
  listProjects,
  loadProject,
  registerFile,
  deleteFile,
  deleteImage,
  listImages,
  getImage,
  getProjectPaths,
  requiredFileTypes,
  optionalFileTypes,
  deleteProject
} from '../lib/projectStore.js';
import { requestPendingWorkScan } from '../lib/jobQueue.js';
import { ensureDzi } from '../lib/dziGenerator.js';

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const paths = req.projectPaths;
    if (!paths?.imageFilesDir) {
      cb(new Error('Upload paths not resolved for project/image'));
      return;
    }
    cb(null, paths.imageFilesDir);
  },
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${file.originalname}`
      .replace(/[^A-Za-z0-9._-]/g, '_')
      .replace(/_+/g, '_');
    cb(null, unique);
  }
});

const upload = multer({ storage });

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function mapImageEntryWithUrls(projectId, imageEntry) {
  if (!imageEntry) return imageEntry;
  const base = `/api/projects/${projectId}/images/${imageEntry.id}`;
  const timestampCandidates = [
    imageEntry.status?.processedAt,
    imageEntry.pipeline?.preprocess?.completedAt,
    imageEntry.processed?.updatedAt,
    imageEntry.files?.image?.uploadedAt,
    imageEntry.status?.updatedAt,
    imageEntry.updatedAt,
    imageEntry.createdAt
  ].filter((value) => Number.isFinite(value));
  const assetVersion = timestampCandidates.length > 0 ? timestampCandidates[0] : Date.now();
  const cacheBuster = assetVersion ? `?v=${assetVersion}` : '';

  return {
    ...imageEntry,
    assetVersion,
    dziManifestUrl: `${base}/dzi/manifest.dzi${cacheBuster}`,
    dziTileBaseUrl: `${base}/dzi`
  };
}

async function resolveProject(req, res, next) {
  const { projectId } = req.params;
  try {
    if (!projectId) {
      const error = new Error('projectId is required');
      error.statusCode = 400;
      throw error;
    }
    req.project = await loadProject(projectId);
    next();
  } catch (error) {
    next(error);
  }
}

function resolveProjectPaths(useImage = false) {
  return (req, res, next) => {
    try {
      const { projectId, imageId } = req.params;
      req.projectPaths = getProjectPaths(projectId, useImage ? imageId : undefined);
      next();
    } catch (error) {
      next(error);
    }
  };
}

async function resolveImage(req, res, next) {
  const { projectId, imageId } = req.params;
  try {
    req.imageEntry = await getImage(projectId, imageId);
    next();
  } catch (error) {
    next(error);
  }
}

router.get('/', asyncHandler(async (req, res) => {
  const projects = await listProjects();
  res.json(projects);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { name, description } = req.body || {};
  const project = await createProject({ name, description });
  res.status(201).json(project);
}));

router.delete('/:projectId', resolveProject, asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  await deleteProject(projectId);
  res.status(204).send();
}));

router.get('/:projectId', resolveProject, asyncHandler(async (req, res) => {
  res.json(req.project);
}));

router.get('/:projectId/requirements', resolveProject, asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  res.json({
    required: requiredFileTypes(),
    optional: optionalFileTypes(),
    images: (await listImages(projectId)).map((image) => mapImageEntryWithUrls(projectId, image))
  });
}));

router.get('/:projectId/images', resolveProject, asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const images = await listImages(projectId);
  res.json(images.map((image) => mapImageEntryWithUrls(projectId, image)));
}));

router.get('/:projectId/images/:imageId', resolveProject, resolveImage, asyncHandler(async (req, res) => {
  res.json(mapImageEntryWithUrls(req.params.projectId, req.imageEntry));
}));

router.post(
  '/:projectId/images/:imageId/files',
  resolveProject,
  resolveProjectPaths(true),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const { projectId, imageId } = req.params;
    const { fileType, label } = req.body || {};
    const file = req.file;

    console.log('📤 File upload request:', {
      projectId,
      imageId,
      fileType,
      label,
      hasFile: !!file,
      fileName: file?.originalname,
      fileSize: file?.size
    });

    if (!file) {
      console.error('❌ No file provided in upload request');
      return res.status(400).json({ error: 'File upload is required' });
    }

    if (!fileType) {
      console.error('❌ No fileType provided in upload request');
      return res.status(400).json({ error: 'fileType is required (image, cells, matrix, gene_panel, protein_panel, alignment)' });
    }

    const metadata = {
      originalName: file.originalname,
      storedName: file.filename,
      path: file.path,
      size: file.size,
      mimeType: file.mimetype,
      uploadedAt: Date.now()
    };

    console.log('✅ Registering file:', { projectId, imageId, fileType, metadata });

    const imageEntry = await registerFile({
      projectId,
      imageId,
      fileType,
      metadata,
      label: label || file.originalname
    });

    if (imageEntry?.status?.ready && !imageEntry?.status?.processed) {
      requestPendingWorkScan(200);
    }

    console.log('✅ File upload successful:', imageEntry.id);
    res.status(201).json(mapImageEntryWithUrls(projectId, imageEntry));
  })
);

router.delete(
  '/:projectId/images/:imageId/files/:fileType',
  resolveProject,
  asyncHandler(async (req, res) => {
    const { projectId, imageId, fileType } = req.params;

    console.log('🗑️ Delete file request:', { projectId, imageId, fileType });

    const imageEntry = await deleteFile({ projectId, imageId, fileType });

    console.log('✅ File deleted successfully');
    res.json(mapImageEntryWithUrls(projectId, imageEntry));
  })
);

router.delete(
  '/:projectId/images/:imageId',
  resolveProject,
  asyncHandler(async (req, res) => {
    const { projectId, imageId } = req.params;

    console.log('🗑️ Delete image request:', { projectId, imageId });

    await deleteImage({ projectId, imageId });

    console.log('✅ Image deleted successfully');
    res.status(204).send();
  })
);

router.get(
  '/:projectId/images/:imageId/dzi/manifest.dzi',
  resolveProject,
  resolveProjectPaths(true),
  resolveImage,
  asyncHandler(async (req, res) => {
    const imageMeta = req.imageEntry.files?.image;
    if (!imageMeta) {
      return res.status(404).json({ error: 'Image file not uploaded' });
    }

    if (!fs.existsSync(imageMeta.path)) {
      return res.status(404).json({ error: 'Image file not found on disk' });
    }

    const { dziManifest } = req.projectPaths;

    try {
      const { manifestPath } = await ensureDzi({
        sourcePath: imageMeta.path,
        manifestPath: dziManifest
      });

      res.type('application/xml');
      res.set('Cache-Control', 'no-store, max-age=0, must-revalidate');
      return res.sendFile(path.resolve(manifestPath));
    } catch (error) {
      console.error('Failed to generate DZI manifest:', error);
      return res.status(500).json({ error: 'Failed to generate Deep Zoom manifest' });
    }
  })
);

router.get(
  '/:projectId/images/:imageId/dzi/:folder/:level/:tile',
  resolveProject,
  resolveProjectPaths(true),
  resolveImage,
  asyncHandler(async (req, res) => {
    const imageMeta = req.imageEntry.files?.image;
    if (!imageMeta) {
      return res.status(404).json({ error: 'Image file not uploaded' });
    }

    if (!fs.existsSync(imageMeta.path)) {
      return res.status(404).json({ error: 'Image file not found on disk' });
    }

    const { dziManifest } = req.projectPaths;

    try {
      const { manifestPath, tilesDir } = await ensureDzi({
        sourcePath: imageMeta.path,
        manifestPath: dziManifest
      });

      const expectedFolder = path.basename(tilesDir);
      const { folder, level, tile } = req.params;

      const manifestBase = path.basename(manifestPath, '.dzi');
      const requestedFolder = folder || '';
      const allowedFolders = new Set([
        expectedFolder,
        `${manifestBase}_files`,
        'manifest_files'
      ]);

      if (!allowedFolders.has(requestedFolder)) {
        return res.status(404).json({ error: 'Tile folder not found' });
      }

      if (!/^[0-9]+$/.test(level)) {
        return res.status(400).json({ error: 'Invalid tile level' });
      }

      const sanitizedTile = (tile || '').replace(/^\/+/, '');
      if (!sanitizedTile || sanitizedTile.includes('..')) {
        return res.status(400).json({ error: 'Invalid tile path' });
      }

      const filePath = path.resolve(tilesDir, level, sanitizedTile);
      const safeTilesDir = path.resolve(tilesDir);

      if (!filePath.startsWith(`${safeTilesDir}${path.sep}`)) {
        return res.status(400).json({ error: 'Invalid tile path' });
      }

      try {
        await fsPromises.access(filePath);
      } catch {
        return res.status(404).json({ error: 'Tile not found' });
      }

      res.set('Cache-Control', 'no-store, max-age=0, must-revalidate');
      return res.sendFile(filePath);
    } catch (error) {
      console.error('Failed to serve DZI tile:', error);
      return res.status(500).json({ error: 'Failed to serve Deep Zoom tile' });
    }
  })
);

export default router;
