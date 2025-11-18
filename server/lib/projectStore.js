import path from 'path';
import fs from 'fs/promises';
import { existsSync, mkdirSync, rmSync } from 'fs';
import crypto from 'crypto';

const PROJECTS_ROOT = path.join(process.cwd(), 'data', 'projects');
const PROJECT_FILE_NAME = 'project.json';

const REQUIRED_FILE_TYPES = ['image', 'cells', 'matrix'];
const OPTIONAL_FILE_TYPES = ['gene_panel', 'protein_panel', 'alignment'];

function ensureProjectsRoot() {
  if (!existsSync(PROJECTS_ROOT)) {
    mkdirSync(PROJECTS_ROOT, { recursive: true });
  }
}

function projectDir(projectId) {
  ensureProjectsRoot();
  return path.join(PROJECTS_ROOT, projectId);
}

function projectFilePath(projectId) {
  return path.join(projectDir(projectId), PROJECT_FILE_NAME);
}

function filesDir(projectId) {
  return path.join(projectDir(projectId), 'files');
}

function imageFilesDir(projectId, imageId) {
  return path.join(filesDir(projectId), imageId);
}

function processedDir(projectId) {
  return path.join(projectDir(projectId), 'processed');
}

function roisDir(projectId) {
  return path.join(projectDir(projectId), 'rois');
}

function tilesDir(projectId) {
  return path.join(projectDir(projectId), 'tiles');
}

function dziBasePath(projectId, imageId) {
  return path.join(tilesDir(projectId), imageId);
}

function dziManifestPath(projectId, imageId) {
  return `${dziBasePath(projectId, imageId)}.dzi`;
}

function dziFilesDir(projectId, imageId) {
  return `${dziBasePath(projectId, imageId)}_files`;
}

function ensureDirs(...dirs) {
  dirs.forEach((dir) => {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  });
}

async function readJSON(filePath, fallback = null) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJSON(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export async function listProjects() {
  ensureProjectsRoot();
  const entries = await fs.readdir(PROJECTS_ROOT, { withFileTypes: true });
  const projects = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const meta = await readJSON(projectFilePath(entry.name));
      if (meta) {
        projects.push(meta);
      }
    } catch (error) {
      console.error(`Failed to load project metadata for ${entry.name}:`, error);
    }
  }

  return projects;
}

export async function createProject({ name, description = '' }) {
  ensureProjectsRoot();
  const id = crypto.randomUUID();
  const dir = projectDir(id);
  ensureDirs(dir, filesDir(id), processedDir(id), roisDir(id), tilesDir(id));

  const now = Date.now();
  const project = {
    id,
    name: name || `Project ${now}`,
    description,
    createdAt: now,
    updatedAt: now,
    images: {},
    rois: {}
  };

  await writeJSON(projectFilePath(id), project);
  return project;
}

export async function loadProject(projectId) {
  const project = await readJSON(projectFilePath(projectId));
  if (!project) {
    const error = new Error(`Project ${projectId} not found`);
    error.statusCode = 404;
    throw error;
  }
  return project;
}

async function saveProject(project) {
  project.updatedAt = Date.now();
  await writeJSON(projectFilePath(project.id), project);
  return project;
}

export async function deleteProject(projectId) {
  const dir = projectDir(projectId);
  if (!existsSync(dir)) {
    const error = new Error(`Project ${projectId} not found`);
    error.statusCode = 404;
    throw error;
  }

  console.log(`🗑️ Deleting project directory: ${dir}`);

  try {
    await fs.rm(dir, { recursive: true, force: true });
    console.log(`✅ Successfully deleted project ${projectId} and all its files`);
  } catch (error) {
    // Older Node versions may not support fs.rm; fall back to rmSync
    try {
      rmSync(dir, { recursive: true, force: true });
      console.log(`✅ Successfully deleted project ${projectId} and all its files (using rmSync)`);
    } catch (fallbackError) {
      const err = new Error(`Failed to delete project ${projectId}: ${fallbackError.message}`);
      err.statusCode = 500;
      throw err;
    }
  }

  return true;
}

function ensureImageEntry(project, imageId, label = null) {
  if (!project.images[imageId]) {
    project.images[imageId] = {
      id: imageId,
      label: label || imageId,
      files: {},
      status: {
        required: REQUIRED_FILE_TYPES,
        missing: [...REQUIRED_FILE_TYPES],
        ready: false,
        processed: false,
        processedAt: null
      },
      processed: null,
      pipeline: {
        preprocess: {
          jobId: null,
          status: 'idle'
        }
      }
    };
  } else if (!project.images[imageId].pipeline) {
    project.images[imageId].pipeline = {
      preprocess: {
        jobId: null,
        status: project.images[imageId].status?.processed ? 'completed' : 'idle'
      }
    };
  }
  return project.images[imageId];
}

function ensureRoiStore(project, imageId) {
  if (!project.rois[imageId]) {
    project.rois[imageId] = {};
  }
  return project.rois[imageId];
}

function fileMetadata({ originalName, storedName, path: filePath, size, mimeType }) {
  return {
    originalName,
    storedName,
    path: filePath,
    size,
    mimeType,
    uploadedAt: Date.now()
  };
}

function updateImageStatus(imageEntry) {
  const existing = imageEntry.files || {};
  const missing = REQUIRED_FILE_TYPES.filter((type) => !existing[type]);
  imageEntry.status.missing = missing;
  imageEntry.status.ready = missing.length === 0;
  if (!imageEntry.status.ready) {
    imageEntry.status.processed = false;
    imageEntry.status.processedAt = null;
    imageEntry.processed = null;
  }
  return imageEntry;
}

export async function registerFile({
  projectId,
  imageId,
  fileType,
  metadata,
  label
}) {
  const project = await loadProject(projectId);
  const imageEntry = ensureImageEntry(project, imageId, label);

  const allowedTypes = [...REQUIRED_FILE_TYPES, ...OPTIONAL_FILE_TYPES];
  if (!allowedTypes.includes(fileType)) {
    const error = new Error(`Unsupported fileType ${fileType}`);
    error.statusCode = 400;
    throw error;
  }

  // Delete old file if it exists (enforce one file per type)
  if (imageEntry.files[fileType]) {
    const oldFile = imageEntry.files[fileType];
    if (oldFile.path && existsSync(oldFile.path)) {
      try {
        await fs.unlink(oldFile.path);
        console.log(`🗑️ Deleted old ${fileType} file:`, oldFile.path);
      } catch (error) {
        console.warn(`⚠️ Failed to delete old ${fileType} file:`, error.message);
      }
    }
  }

  imageEntry.files[fileType] = metadata;
  updateImageStatus(imageEntry);

  await saveProject(project);
  return imageEntry;
}

export async function deleteFile({ projectId, imageId, fileType }) {
  const project = await loadProject(projectId);
  const imageEntry = project.images[imageId];
  
  if (!imageEntry) {
    const error = new Error(`Image ${imageId} not found in project ${projectId}`);
    error.statusCode = 404;
    throw error;
  }

  const fileMetadata = imageEntry.files[fileType];
  if (!fileMetadata) {
    const error = new Error(`File type ${fileType} not found for image ${imageId}`);
    error.statusCode = 404;
    throw error;
  }

  // Delete the physical file from disk
  if (fileMetadata.path && existsSync(fileMetadata.path)) {
    try {
      await fs.unlink(fileMetadata.path);
      console.log(`🗑️ Deleted file from disk:`, fileMetadata.path);
    } catch (error) {
      console.error(`❌ Failed to delete file from disk:`, error.message);
      throw error;
    }
  }

  // Remove from metadata
  delete imageEntry.files[fileType];
  updateImageStatus(imageEntry);

  await saveProject(project);
  return imageEntry;
}

export async function deleteImage({ projectId, imageId }) {
  const project = await loadProject(projectId);
  const imageEntry = project.images[imageId];
  
  if (!imageEntry) {
    const error = new Error(`Image ${imageId} not found in project ${projectId}`);
    error.statusCode = 404;
    throw error;
  }

  // Delete all associated files for this image
  const imageDir = imageFilesDir(projectId, imageId);
  if (existsSync(imageDir)) {
    try {
      await fs.rm(imageDir, { recursive: true, force: true });
      console.log(`🗑️ Deleted image files directory: ${imageDir}`);
    } catch (error) {
      console.error(`❌ Failed to delete image files directory:`, error.message);
    }
  }

  // Delete DZI manifest and tiles if exists
  const dziManifest = dziManifestPath(projectId, imageId);
  if (existsSync(dziManifest)) {
    try {
      await fs.unlink(dziManifest);
      console.log(`🗑️ Deleted DZI manifest: ${dziManifest}`);
    } catch (error) {
      console.error(`❌ Failed to delete DZI manifest:`, error.message);
    }
  }

  const dziFiles = dziFilesDir(projectId, imageId);
  if (existsSync(dziFiles)) {
    try {
      await fs.rm(dziFiles, { recursive: true, force: true });
      console.log(`🗑️ Deleted DZI tiles directory: ${dziFiles}`);
    } catch (error) {
      console.error(`❌ Failed to delete DZI tiles:`, error.message);
    }
  }

  // Delete ROIs for this image
  const roisPath = path.join(roisDir(projectId), `${imageId}.json`);
  if (existsSync(roisPath)) {
    try {
      await fs.unlink(roisPath);
      console.log(`🗑️ Deleted ROIs file: ${roisPath}`);
    } catch (error) {
      console.error(`❌ Failed to delete ROIs:`, error.message);
    }
  }

  // Remove from project metadata
  delete project.images[imageId];
  await saveProject(project);
  
  console.log(`✅ Successfully deleted image ${imageId} from project ${projectId}`);
  return true;
}

export async function markProcessed({ projectId, imageId, processedMeta }) {
  const project = await loadProject(projectId);
  const imageEntry = ensureImageEntry(project, imageId);
  imageEntry.status.processed = true;
  imageEntry.status.processedAt = Date.now();
  imageEntry.processed = processedMeta;
  if (!imageEntry.pipeline) {
    imageEntry.pipeline = {
      preprocess: {
        jobId: null,
        status: 'completed'
      }
    };
  } else if (imageEntry.pipeline.preprocess) {
    imageEntry.pipeline.preprocess.status = 'completed';
  }
  await saveProject(project);
  return imageEntry;
}

export async function updatePreprocessJob({ projectId, imageId, jobId, status }) {
  const project = await loadProject(projectId);
  const imageEntry = ensureImageEntry(project, imageId);
  imageEntry.pipeline = imageEntry.pipeline || {};
  imageEntry.pipeline.preprocess = imageEntry.pipeline.preprocess || {
    jobId: null,
    status: 'idle'
  };
  if (jobId !== undefined) {
    imageEntry.pipeline.preprocess.jobId = jobId;
  }
  if (status) {
    imageEntry.pipeline.preprocess.status = status;
  }
  await saveProject(project);
  return imageEntry;
}

export async function listImages(projectId) {
  const project = await loadProject(projectId);
  return Object.values(project.images);
}

export async function getImage(projectId, imageId) {
  const project = await loadProject(projectId);
  const imageEntry = project.images[imageId];
  if (!imageEntry) {
    const error = new Error(`Image ${imageId} not found in project ${projectId}`);
    error.statusCode = 404;
    throw error;
  }
  return imageEntry;
}

export async function getImageWithFiles(projectId, imageId) {
  const imageEntry = await getImage(projectId, imageId);
  return {
    ...imageEntry,
    files: { ...(imageEntry.files || {}) }
  };
}

export async function upsertRoi({ projectId, imageId, roiName, payload }) {
  const project = await loadProject(projectId);
  ensureImageEntry(project, imageId);
  const store = ensureRoiStore(project, imageId);

  const existing = store[roiName] || {};
  const now = Date.now();

  store[roiName] = {
    name: roiName,
    geometry: payload.geometry ?? existing.geometry ?? null,
    polygon: payload.polygon ?? existing.polygon ?? null,
    polygon_centroids: payload.polygon_centroids ?? existing.polygon_centroids ?? [],
    stats: payload.stats ?? existing.stats ?? null,
    status: payload.status ?? existing.status ?? 'pending',
    error: payload.error ?? null,
    jobId: payload.jobId ?? existing.jobId ?? null,
    version: payload.version ?? existing.version ?? 1,
    createdAt: existing.createdAt || now,
    updatedAt: now
  };

  await saveProject(project);
  return store[roiName];
}

export async function deleteRoi({ projectId, imageId, roiName }) {
  const project = await loadProject(projectId);
  const store = ensureRoiStore(project, imageId);
  const existing = store[roiName];
  if (!existing) {
    const error = new Error(`ROI ${roiName} not found`);
    error.statusCode = 404;
    throw error;
  }
  delete store[roiName];
  await saveProject(project);
  return true;
}

export async function listRois(projectId, imageId) {
  const project = await loadProject(projectId);
  return Object.values(project.rois?.[imageId] || {});
}

export async function getRoi({ projectId, imageId, roiName }) {
  const project = await loadProject(projectId);
  return project.rois?.[imageId]?.[roiName] || null;
}

export async function updateRoiJob({ projectId, imageId, roiName, jobId, status, error, stats, polygon, polygon_centroids }) {
  const project = await loadProject(projectId);
  ensureImageEntry(project, imageId);
  const store = ensureRoiStore(project, imageId);
  const existing = store[roiName];
  if (!existing) {
    const now = Date.now();
    store[roiName] = {
      name: roiName,
      geometry: null,
      polygon: polygon ?? null,
      polygon_centroids: polygon_centroids ?? [],
      stats: stats ?? null,
      status: status || 'pending',
      error: error ?? null,
      jobId: jobId ?? null,
      version: 1,
      createdAt: now,
      updatedAt: now
    };
  } else {
    if (jobId !== undefined) existing.jobId = jobId;
    if (status) existing.status = status;
    if (error !== undefined) existing.error = error;
    if (stats) existing.stats = stats;
    if (polygon) existing.polygon = polygon;
    if (polygon_centroids) existing.polygon_centroids = polygon_centroids;
    existing.updatedAt = Date.now();
    existing.version = (existing.version || 1) + (status === 'completed' ? 1 : 0);
  }
  await saveProject(project);
  return store[roiName];
}

export function getProjectPaths(projectId, imageId) {
  const pDir = projectDir(projectId);
  const fDir = filesDir(projectId);
  const pProcessed = processedDir(projectId);
  const rDir = roisDir(projectId);
  const tDir = tilesDir(projectId);
  if (imageId) {
    const iDir = imageFilesDir(projectId, imageId);
    const dziManifest = dziManifestPath(projectId, imageId);
    ensureDirs(iDir, tDir);
    return {
      projectDir: pDir,
      filesDir: fDir,
      processedDir: pProcessed,
      roisDir: rDir,
      tilesDir: tDir,
      imageFilesDir: iDir,
      h5adPath: path.join(pProcessed, `${imageId}.h5ad`),
      dziManifest,
      dziFilesDir: dziFilesDir(projectId, imageId)
    };
  }
  ensureDirs(pDir, fDir, pProcessed, rDir, tDir);
  return {
    projectDir: pDir,
    filesDir: fDir,
    processedDir: pProcessed,
    roisDir: rDir,
    tilesDir: tDir
  };
}

export function getImageDziManifestPath(projectId, imageId) {
  return dziManifestPath(projectId, imageId);
}

export function getImageDziFilesDir(projectId, imageId) {
  return dziFilesDir(projectId, imageId);
}

export function requiredFileTypes() {
  return [...REQUIRED_FILE_TYPES];
}

export function optionalFileTypes() {
  return [...OPTIONAL_FILE_TYPES];
}
