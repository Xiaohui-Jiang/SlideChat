// server/index-enhanced.js
// Enhanced server with LangChain integration - toy example
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import sharp from 'sharp';

// Import LangChain tools
import {
  getSlideInfoTool,
  createROITool,
  analyzeBiologicalFeaturesTool,
  findSimilarSlidesTool
} from './lib/slide-functions.js';
import { ChatOpenAI } from '@langchain/openai';
import { createToolCallingAgent, AgentExecutor } from 'langchain/agents';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import ConversationMemoryStore from './lib/conversation-memory.js';
import xeniumRoutes from './routes/xenium.js';
import XeniumService from './lib/xeniumService.js';
import projectsRouter from './routes/projects.js';
import uploadRouter from './routes/upload.js';
import {
  getProjectPaths,
  listImages as listProjectImages,
  getImage as getProjectImage,
  listRois as listStoredRois,
  listProjects,
  upsertRoi as storeRoiMetadata,
  deleteRoi as removeRoiMetadata,
  updateRoiJob,
  updatePreprocessJob,
  getRoi as getStoredRoi,
  getImageWithFiles,
  markProcessed
} from './lib/projectStore.js';
import {
  initializeJobQueue,
  registerJobProcessor,
  enqueueJob,
  RetryableJobError,
  listJobs,
  registerPendingWorkRequestHandler
} from './lib/jobQueue.js';

// Load environment variables
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use('/public', express.static(path.join(process.cwd(), 'public')));
app.use('/api/projects', projectsRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/xenium', xeniumRoutes);

const upload = multer({ dest: path.join(process.cwd(), 'uploads') });

const HUMAN_KIDNEY_DIR = path.join(process.cwd(), 'public', 'slides', 'human_kidney');
const HUMAN_KIDNEY_DATASET_DIR = path.resolve(process.cwd(), '..', 'Human_Kidney_test_data');

async function ensureKidneySlideAssets() {
  try {
    if (!fs.existsSync(HUMAN_KIDNEY_DIR)) {
      fs.mkdirSync(HUMAN_KIDNEY_DIR, { recursive: true });
    }

    if (!fs.existsSync(HUMAN_KIDNEY_DATASET_DIR)) {
      console.warn('⚠️ Human kidney dataset directory not found, skipping preview generation');
      return;
    }

    const files = fs.readdirSync(HUMAN_KIDNEY_DATASET_DIR);
    const tiffName = files.find((name) => /\.tiff?$/.test(name.toLowerCase()));

    if (!tiffName) {
      console.warn('⚠️ No TIFF found in Human_Kidney_test_data, skipping preview generation');
      return;
    }

    const sourceTiff = path.join(HUMAN_KIDNEY_DATASET_DIR, tiffName);
    const previewPath = path.join(HUMAN_KIDNEY_DIR, 'human_kidney_he_preview.jpg');
    const thumbnailPath = path.join(HUMAN_KIDNEY_DIR, 'thumbnail.jpg');
    const symlinkPath = path.join(HUMAN_KIDNEY_DIR, 'human_kidney_he.ome.tif');

    if (!fs.existsSync(symlinkPath)) {
      try {
        fs.symlinkSync(sourceTiff, symlinkPath);
      } catch (error) {
        console.warn('⚠️ Failed to create symlink to original TIFF:', error.message);
      }
    }

    const sharpSource = sharp(sourceTiff, { limitInputPixels: false });

    if (!fs.existsSync(previewPath)) {
      console.log('🖼️ Generating kidney preview JPEG (this may take a minute)...');
      await sharpSource
        .clone()
        .resize({ width: 8000, withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toFile(previewPath);
      console.log('✅ Kidney preview generated at', previewPath);
    }

    if (!fs.existsSync(thumbnailPath)) {
      console.log('🖼️ Generating kidney thumbnail...');
      await sharpSource
        .clone()
        .resize({ width: 600, withoutEnlargement: true })
        .jpeg({ quality: 75 })
        .toFile(thumbnailPath);
      console.log('✅ Kidney thumbnail generated at', thumbnailPath);
    }
  } catch (error) {
    console.warn('⚠️ Failed to prepare kidney slide assets:', error.message);
  }
}

const SUMMARY_MODEL =
  process.env.OPENAI_SUMMARY_MODEL ||
  process.env.LANGCHAIN_MODEL ||
  process.env.OPENAI_MODEL ||
  'gpt-4o-mini';
let summaryLLM = null;
let summarizerPrompt = null;

try {
  summaryLLM = new ChatOpenAI({
    model: SUMMARY_MODEL,
    temperature: 0.2
  });

  summarizerPrompt = ChatPromptTemplate.fromMessages([
    [
      'system',
      'You maintain concise running summaries of user conversations for a biological slide analysis assistant. Focus on factual context, outstanding questions, user preferences, and analysis steps that may matter later. Keep summaries under 200 words.'
    ],
    [
      'human',
      'Previous summary (use "None" if empty):\n{existingSummary}\n\nNew conversation turns:\n{transcript}\n\nUpdate the running summary in prose. Highlight slide IDs, ROI names, requested analyses, and any promised follow-ups.'
    ]
  ]);
} catch (error) {
  console.warn('⚠️ Conversation summarizer disabled:', error.message);
}

const conversationMemory = new ConversationMemoryStore({
  summarizer: null, // Disable summarizer to avoid crashes during testing
  config: {
    maxContextTokens: 3200,
    maxRecentMessages: 14,
    summaryTriggerMessages: 14,
    summaryRetainRecentMessages: 6
  }
});

global.conversationMemory = conversationMemory;

const AGENT_TIMEOUT_MS = (() => {
  const parsed = Number(process.env.LANGCHAIN_AGENT_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15000;
})();

function buildFallbackReply(message = '') {
  let contextualReply = 'I can help you analyze biological images and H&E stained tissue slides. ';
  const normalizedMessage = typeof message === 'string' ? message.toLowerCase() : '';

  if (normalizedMessage.includes('roi') || normalizedMessage.includes('region')) {
    contextualReply +=
      'For ROI analysis, I can help you:\n\n' +
      '🔬 **H&E Tissue Analysis:**\n' +
      '- Identify glandular structures and epithelial cells\n' +
      '- Analyze stromal components and connective tissue\n' +
      '- Quantify cell density in defined regions\n' +
      '- Assess tissue architecture and morphology\n\n' +
      '📊 **Available Functions:**\n' +
      '- getSlideInfo: Get slide metadata and properties\n' +
      '- analyzeBiologicalFeatures: Analyze cellular and tissue features\n' +
      '- createROI: Create regions of interest for analysis\n' +
      '- findSimilarSlides: Find similar tissue patterns';
  } else if (normalizedMessage.includes('cd68') || normalizedMessage.includes('immune')) {
    contextualReply +=
      'For immune cell analysis:\n\n' +
      '🧬 **Immune Infiltration Analysis:**\n' +
      '- CD68+ macrophage identification and quantification\n' +
      '- Spatial distribution of immune cells\n' +
      '- Tissue infiltration patterns\n' +
      '- Cell density calculations per ROI\n\n' +
      '💡 **Tip:** Draw ROIs around areas of interest and I can provide detailed analysis of immune cell populations.';
  } else {
    contextualReply +=
      "Here's what I can help you with:\n\n" +
      '🔬 **Image Analysis:**\n' +
      '- H&E stained tissue interpretation\n' +
      '- Cellular morphology assessment\n' +
      '- Tissue architecture analysis\n\n' +
      '📐 **ROI Functions:**\n' +
      '- Draw regions of interest on slides\n' +
      '- Quantitative analysis of selected areas\n' +
      '- Cell counting and density measurements\n\n' +
      "💬 **Try asking:**\n" +
      "- 'Analyze the tissue morphology in this ROI'\n" +
      "- 'What cell types are visible in this region?'\n" +
      "- 'Calculate cell density in ROI_1'";
  }

  return contextualReply;
}

function safeErrorMessage(error) {
  if (!error) return 'Unknown error';
  if (error instanceof Error) return error.message || 'Unknown error';
  if (typeof error === 'string') return error || 'Unknown error';
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function invokeAgentWithTimeout(agentPromise, timeoutMs) {
  let timeoutId;

  try {
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`LangChain agent timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    return await Promise.race([agentPromise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

// Initialize function registry and LangChain agent
async function initializeServer() {
  try {
    // Initialize LangChain tools and agent
    const tools = [
      getSlideInfoTool,
      createROITool,
      analyzeBiologicalFeaturesTool,
      findSimilarSlidesTool
    ];

    global.langchainTools = tools;

    console.log('✅ Loaded LangChain tool: getSlideInfo');
    console.log('✅ Loaded LangChain tool: createROI');
    console.log('✅ Loaded LangChain tool: analyzeBiologicalFeatures');
    console.log('✅ Loaded LangChain tool: findSimilarSlides');

    // Create the LangChain agent
    const modelName = process.env.LANGCHAIN_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const temperature = process.env.LANGCHAIN_TEMPERATURE
      ? Number(process.env.LANGCHAIN_TEMPERATURE)
      : 0;

    console.log(`🧠 Initializing LangChain agent with model: ${modelName} (temperature=${temperature})`);

    const llm = new ChatOpenAI({
      model: modelName,
      temperature,
    });

    const prompt = ChatPromptTemplate.fromMessages([
      ["system", `You are a biological slide analysis assistant. You have access to various analysis functions for medical slides and ROIs.

Available functions:
- getSlideInfo: Retrieve detailed information and metadata about a specific slide
- createROI: Create a new Region of Interest (ROI) on a slide with specified geometry
- analyzeBiologicalFeatures: Perform biological feature analysis on a slide or ROI (morphology, immunostaining, cellular density, tissue classification)
- findSimilarSlides: Find slides with similar biological features using AI-powered similarity search

When a user asks about slide analysis, ROI creation, or biological features, use the appropriate functions to help them.
Always provide clear, helpful responses and explain what functions you're using.

If you need to analyze multiple aspects or perform complex workflows, you can call multiple functions in sequence.`],
      new MessagesPlaceholder('chat_history'),
      ["human", "{input}"],
      ["placeholder", "{agent_scratchpad}"],
    ]);

    const agent = await createToolCallingAgent({ llm, tools, prompt });
    global.langchainAgent = new AgentExecutor({ agent, tools });

    console.log('🤖 LangChain agent initialized successfully');

  } catch (error) {
    console.error('❌ Server initialization failed:', error);
    process.exit(1);
  }
}

// Project-scoped biological data is managed under /api/projects

// ROI endpoints backed by project-specific Xenium pipeline ------------------
const ROI_NAME_PREFIX = 'roi';

const sanitizeRoiName = (value, fallback) => {
  if (typeof value === 'string') {
    const cleaned = value.trim();
    if (cleaned.length > 0) {
      return cleaned.replace(/[^A-Za-z0-9_-]/g, '_');
    }
  }
  return fallback;
};

const toFiniteNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const rectangleToPolygon = (geometry) => {
  if (!geometry || typeof geometry !== 'object') return null;
  const x = toFiniteNumber(geometry.x);
  const y = toFiniteNumber(geometry.y);
  const w = toFiniteNumber(geometry.w);
  const h = toFiniteNumber(geometry.h);
  if ([x, y, w, h].some((val) => val === null)) return null;
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h]
  ];
};

const normalizeVertices = ({ vertices, geometry }) => {
  if (Array.isArray(vertices) && vertices.length >= 3) {
    const parsed = vertices
      .map((point) => {
        if (!Array.isArray(point) || point.length < 2) return null;
        const x = toFiniteNumber(point[0]);
        const y = toFiniteNumber(point[1]);
        if (x === null || y === null) return null;
        return [x, y];
      })
      .filter(Boolean);
    if (parsed.length >= 3) {
      return parsed;
    }
  }
  return rectangleToPolygon(geometry);
};

const polygonToGeometry = (polygon) => {
  if (!Array.isArray(polygon) || polygon.length === 0) return null;
  const xs = polygon.map((point) => Number(point[0]));
  const ys = polygon.map((point) => Number(point[1]));
  if (xs.some((n) => !Number.isFinite(n)) || ys.some((n) => !Number.isFinite(n))) {
    return null;
  }
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY
  };
};

const createProjectXeniumService = (projectId) => {
  const { filesDir, processedDir } = getProjectPaths(projectId);
  return new XeniumService(filesDir, processedDir);
};

const JOB_TYPES = {
  PREPROCESS_IMAGE: 'preprocess-image',
  APPLY_ROI: 'apply-roi'
};

let pendingWorkTimer = null;

async function ensureJobQueueInitialized() {
  await initializeJobQueue({ pollIntervalMs: 1500 });
  registerJobProcessor(processJob);
  schedulePendingWork(0);
}

function buildRequiredFileSet(imageEntry) {
  const files = imageEntry?.files || {};
  return {
    matrix_path: files.matrix?.path || null,
    cells_path: files.cells?.path || null,
    alignment_path: files.alignment?.path || null,
    image_path: files.image?.path || null
  };
}

function validateRequiredFiles(fileSet) {
  const missing = Object.entries(fileSet)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  return missing;
}

async function finalizePreprocessArtifacts({ projectId, imageId, result }) {
  const { processedDir } = getProjectPaths(projectId, imageId);
  const targetPath = path.join(processedDir, `${imageId}.h5ad`);
  const reportedPath = result?.h5ad_path || path.join(processedDir, `${imageId}_processed.h5ad`);

  try {
    if (reportedPath !== targetPath) {
      if (fs.existsSync(targetPath)) {
        await fs.promises.unlink(targetPath);
      }
      await fs.promises.copyFile(reportedPath, targetPath);
    } else if (!fs.existsSync(targetPath)) {
      throw new Error(`Processed h5ad not found at ${targetPath}`);
    }
  } catch (error) {
    throw new Error(`Failed to prepare processed dataset: ${error.message}`);
  }

  return targetPath;
}

async function processPreprocessJob(job) {
  const { projectId, imageId } = job.payload;
  const imageEntry = await getImageWithFiles(projectId, imageId);
  const fileSet = buildRequiredFileSet(imageEntry);
  const missing = validateRequiredFiles(fileSet);
  if (missing.length > 0) {
    throw new RetryableJobError(`Waiting for required uploads: ${missing.join(', ')}`, 5000);
  }

  await updatePreprocessJob({ projectId, imageId, jobId: job.id, status: 'processing' });

  const service = createProjectXeniumService(projectId);
  const command = {
    matrix_path: fileSet.matrix_path,
    cells_path: fileSet.cells_path,
    alignment_path: fileSet.alignment_path,
    image_path: fileSet.image_path
  };

  const result = await service.preprocessDataset(imageId, command);
  if (!result?.success) {
    throw new Error(result?.error || 'Preprocessing failed');
  }

  const h5adPath = await finalizePreprocessArtifacts({ projectId, imageId, result });
  await markProcessed({
    projectId,
    imageId,
    processedMeta: {
      h5adPath,
      cellCount: result?.n_cells ?? null,
      featureCount: result?.n_features ?? null,
      generatedAt: Date.now()
    }
  });

  await updatePreprocessJob({ projectId, imageId, jobId: job.id, status: 'completed' });
}

async function syncProcessedDataset({ projectId, imageId, reason = 'roi-update' }) {
  try {
    const { processedDir, h5adPath } = getProjectPaths(projectId, imageId);
    const sourcePath = path.join(processedDir, `${imageId}_processed.h5ad`);

    try {
      await fs.promises.access(sourcePath);
    } catch (accessError) {
      console.warn(`⚠️ Processed dataset not found for sync (${reason}):`, {
        projectId,
        imageId,
        sourcePath,
        message: accessError?.message
      });
      return false;
    }

    await fs.promises.copyFile(sourcePath, h5adPath);
    return true;
  } catch (error) {
    console.error(`❗ Failed to sync processed dataset (${reason}) for ${projectId}/${imageId}:`, error);
    return false;
  }
}

async function ensurePipelineDatasetAvailable(projectId, imageId) {
  const h5adPath = ensureProcessedDataset(projectId, imageId);
  const { processedDir } = getProjectPaths(projectId, imageId);
  const pythonPath = path.join(processedDir, `${imageId}_processed.h5ad`);

  let needsCopy = false;
  try {
    const stats = await fs.promises.stat(pythonPath);
    if (!stats.isFile() || stats.size === 0) {
      needsCopy = true;
    }
  } catch (error) {
    needsCopy = true;
  }

  if (needsCopy) {
    await fs.promises.copyFile(h5adPath, pythonPath);
  }

  return pythonPath;
}

async function processApplyRoiJob(job) {
  const { projectId, imageId, roiName, polygon, geometry } = job.payload;
  const imageEntry = await getProjectImage(projectId, imageId);
  if (!imageEntry.status?.processed) {
    throw new RetryableJobError('Processed dataset not ready yet', 6000);
  }

  await updateRoiJob({
    projectId,
    imageId,
    roiName,
    jobId: job.id,
    status: 'processing',
    error: null
  });

  const service = createProjectXeniumService(projectId);
  const result = await applyPipelineAdd({ projectId, imageId, roiName, vertices: polygon });

  await updateRoiJob({
    projectId,
    imageId,
    roiName,
    status: 'completed',
    error: null,
    stats: {
      n_cells: result?.n_cells_in_roi ?? null,
      percentage: result?.percentage ?? null,
      n_cells_total: result?.n_cells_total ?? null
    },
    polygon: result?.roi_polygon_pixels || polygon,
    polygon_centroids: result?.roi_polygon_centroids || []
  });

  // Persist a simplified ROI payload for API consumers
  await storeRoiMetadata({
    projectId,
    imageId,
    roiName,
    payload: {
      geometry,
      polygon: result?.roi_polygon_pixels || polygon,
      polygon_centroids: result?.roi_polygon_centroids || [],
      stats: {
        n_cells: result?.n_cells_in_roi ?? null,
        percentage: result?.percentage ?? null,
        n_cells_total: result?.n_cells_total ?? null
      },
      status: 'completed',
      error: null,
      jobId: job.id
    }
  });

  await syncProcessedDataset({ projectId, imageId, reason: 'roi-add' });
}

async function processJob(job) {
  try {
    switch (job.type) {
      case JOB_TYPES.PREPROCESS_IMAGE:
        await processPreprocessJob(job);
        break;
      case JOB_TYPES.APPLY_ROI:
        await processApplyRoiJob(job);
        break;
      default:
        console.warn(`⚠️ Unknown job type: ${job.type}`);
        break;
    }
    schedulePendingWork(500);
  } catch (error) {
    if (!error.retryable) {
      if (job.type === JOB_TYPES.APPLY_ROI) {
        const { projectId, imageId, roiName } = job.payload;
        await updateRoiJob({
          projectId,
          imageId,
          roiName,
          status: 'failed',
          error: error?.message || 'ROI processing failed'
        });
      } else if (job.type === JOB_TYPES.PREPROCESS_IMAGE) {
        const { projectId, imageId } = job.payload;
        await updatePreprocessJob({ projectId, imageId, jobId: job.id, status: 'failed' });
      }
    }
    throw error;
  }
}

async function queuePreprocessJob(projectId, imageId) {
  const job = await enqueueJob(JOB_TYPES.PREPROCESS_IMAGE, { projectId, imageId });
  await updatePreprocessJob({ projectId, imageId, jobId: job.id, status: 'queued' });
  return job;
}

async function queueRoiJob({ projectId, imageId, roiName, geometry, polygon }) {
  const job = await enqueueJob(JOB_TYPES.APPLY_ROI, { projectId, imageId, roiName, geometry, polygon });
  await updateRoiJob({ projectId, imageId, roiName, jobId: job.id, status: 'queued', error: null });
  return job;
}

function schedulePendingWork(delay = 1000) {
  if (pendingWorkTimer) {
    return;
  }
  pendingWorkTimer = setTimeout(async () => {
    pendingWorkTimer = null;
    try {
      await discoverPendingWork();
    } catch (error) {
      console.error('Failed to discover pending work:', error);
    }
  }, delay);
}

registerPendingWorkRequestHandler((delay = 1000) => {
  schedulePendingWork(delay);
});

async function discoverPendingWork() {
  const jobs = listJobs();
  const activeJobIds = new Set(
    jobs
      .filter((job) => job.status === 'queued' || job.status === 'processing')
      .map((job) => job.id)
  );

  const projects = await listProjects();
  for (const project of projects) {
    const images = await listProjectImages(project.id);
    for (const image of images) {
      const readyForPreprocess = image.status?.ready && !image.status?.processed;
      const preprocessJobId = image.pipeline?.preprocess?.jobId;
      const preprocessActive = preprocessJobId && activeJobIds.has(preprocessJobId);
      if (readyForPreprocess && !preprocessActive) {
        await queuePreprocessJob(project.id, image.id);
      }

      const rois = await listStoredRois(project.id, image.id);
      for (const roi of rois) {
        const needsProcessing = !roi.status || roi.status === 'pending' || roi.status === 'failed';
        const queued = roi.status === 'queued';
        const roiActive = roi.jobId && activeJobIds.has(roi.jobId);
        if ((needsProcessing || (queued && !roiActive)) && roi.geometry) {
          const polygon = Array.isArray(roi.polygon) && roi.polygon.length >= 3 ? roi.polygon : rectangleToPolygon(roi.geometry);
          await queueRoiJob({
            projectId: project.id,
            imageId: image.id,
            roiName: roi.name,
            geometry: roi.geometry,
            polygon
          });
        }
      }
    }
  }
}

const ensureProcessedDataset = (projectId, imageId) => {
  const { h5adPath } = getProjectPaths(projectId, imageId);
  if (!fs.existsSync(h5adPath)) {
    const error = new Error('Processed dataset not available for this image');
    error.statusCode = 409;
    error.details = {
      action: 'preprocess_required',
      message: 'Upload required files and run preprocessing to generate the project h5ad.'
    };
    throw error;
  }
  return h5adPath;
};

const handlePipelineError = (error) => {
  if (error && typeof error.statusCode === 'number') {
    return error;
  }
  const wrapped = new Error(typeof error === 'string' ? error : error?.message || 'Unexpected error');
  wrapped.statusCode = 500;
  return wrapped;
};

const fetchPipelineRois = async ({ projectId, imageId }) => {
  await ensurePipelineDatasetAvailable(projectId, imageId);
  const service = createProjectXeniumService(projectId);
  const result = await service.getROIList(imageId);
  if (!result.success) {
    const err = new Error(result.error || result.message || 'Failed to load ROI list');
    err.statusCode = result.error === 'Dataset not found' ? 404 : 500;
    throw err;
  }
  return result;
};

const applyPipelineAdd = async ({ projectId, imageId, roiName, vertices }) => {
  await ensurePipelineDatasetAvailable(projectId, imageId);
  const service = createProjectXeniumService(projectId);
  const result = await service.addROI(imageId, roiName, vertices);
  if (!result.success) {
    const err = new Error(result.error || result.message || 'Failed to add ROI');
    err.statusCode = 400;
    throw err;
  }
  return result;
};

const applyPipelineDelete = async ({ projectId, imageId, roiName }) => {
  await ensurePipelineDatasetAvailable(projectId, imageId);
  const service = createProjectXeniumService(projectId);
  const result = await service.deleteROI(imageId, roiName);
  if (!result.success) {
    const err = new Error(result.error || result.message || 'Failed to delete ROI');
    err.statusCode = 400;
    throw err;
  }
  return result;
};

const buildRoiPayload = ({
  projectId,
  imageId,
  roiName,
  polygon,
  stats,
  stored,
  pipelineCentroids,
  pipelineTotals,
  defaultStatus = 'pending'
}) => {
  const geometry = polygonToGeometry(polygon) || stored?.geometry || { x: 0, y: 0, w: 0, h: 0 };
  const status = stored?.status || defaultStatus;
  return {
    id: roiName,
    name: roiName,
    projectId,
    imageId,
    geometry,
    polygon,
    polygon_centroids: pipelineCentroids || stored?.polygon_centroids || [],
    stats: {
      n_cells: stats?.n_cells ?? stored?.stats?.n_cells ?? 0,
      n_cells_total: stats?.n_cells_total ?? stored?.stats?.n_cells_total ?? pipelineTotals ?? null,
      percentage: stats?.percentage ?? stored?.stats?.percentage ?? 0
    },
    status,
    jobId: stored?.jobId || null,
    error: stored?.error || null,
    createdAt: stored?.createdAt || Date.now(),
    updatedAt: Date.now()
  };
};

const persistRoi = async ({ projectId, imageId, roi }) => {
  await storeRoiMetadata({
    projectId,
    imageId,
    roiName: roi.name,
    payload: {
      geometry: roi.geometry,
      polygon: roi.polygon,
      polygon_centroids: roi.polygon_centroids,
      stats: roi.stats,
      status: roi.status || 'completed',
      error: roi.error || null,
      jobId: roi.jobId || null
    }
  });
};

const listRoiHandler = async (req, res) => {
  const { projectId, imageId } = req.params;

  if (!projectId || !imageId) {
    return res.status(400).json({ error: 'projectId and imageId are required' });
  }

  try {
    const stored = await listStoredRois(projectId, imageId);
    const storedMap = new Map(stored.map((roi) => [roi.name, roi]));
    const rois = [];

    let datasetReady = false;
    let pipelineResult = null;

    try {
      ensureProcessedDataset(projectId, imageId);
      datasetReady = true;
      pipelineResult = await fetchPipelineRois({ projectId, imageId });
    } catch (error) {
      if (error?.statusCode === 404 || error?.statusCode === 409) {
        datasetReady = false;
      } else {
        datasetReady = false;
        console.warn(`⚠️ ROI pipeline unavailable for ${projectId}/${imageId}:`, error?.message || error);
      }
    }

    if (datasetReady && pipelineResult?.rois) {
      for (const roi of pipelineResult.rois) {
        const storedEntry = storedMap.get(roi.name) || null;
        const polygon = roi.polygon_pixels || storedEntry?.polygon || [];
        rois.push(
          buildRoiPayload({
            projectId,
            imageId,
            roiName: roi.name,
            polygon,
            stats: {
              n_cells: roi.n_cells,
              percentage: roi.percentage,
              n_cells_total: pipelineResult.n_cells_total
            },
            stored: storedEntry,
            pipelineCentroids: roi.polygon_centroids,
            pipelineTotals: pipelineResult.n_cells_total,
            defaultStatus: 'completed'
          })
        );
        if (storedEntry) {
          storedMap.delete(roi.name);
        }
      }
    }

    for (const storedEntry of storedMap.values()) {
      const polygon = Array.isArray(storedEntry.polygon) && storedEntry.polygon.length >= 3
        ? storedEntry.polygon
        : rectangleToPolygon(storedEntry.geometry);

      const shouldForceCompleted = !datasetReady && (!storedEntry.status || ['pending', 'queued', 'processing'].includes(storedEntry.status));
      const normalizedStatus = shouldForceCompleted ? 'completed' : storedEntry.status;
      const normalizedStored = shouldForceCompleted
        ? { ...storedEntry, status: 'completed', error: null }
        : storedEntry;

      rois.push(
        buildRoiPayload({
          projectId,
          imageId,
          roiName: storedEntry.name,
          polygon: polygon || [],
          stats: normalizedStored.stats || {},
          stored: normalizedStored,
          pipelineCentroids: normalizedStored.polygon_centroids || [],
          pipelineTotals: normalizedStored.stats?.n_cells_total ?? null,
          defaultStatus: shouldForceCompleted ? 'completed' : normalizedStored.status || 'completed'
        })
      );
    }

    res.json(rois);
  } catch (error) {
    const wrapped = handlePipelineError(error);
    res.status(wrapped.statusCode).json({ error: wrapped.message, details: wrapped.details || null });
  }
};

const createRoiHandler = async (req, res) => {
  const { projectId, imageId } = req.params;
  const body = req.body || {};
  const roiName = sanitizeRoiName(body.name, `${ROI_NAME_PREFIX}_${Date.now()}`);
  const vertices = normalizeVertices({ vertices: body.vertices, geometry: body.geometry });

  if (!projectId || !imageId) {
    return res.status(400).json({ error: 'projectId and imageId are required' });
  }

  if (!Array.isArray(vertices) || vertices.length < 3) {
    return res.status(400).json({ error: 'ROI requires at least 3 vertices or valid rectangle geometry' });
  }

  try {
    const geometryRect = polygonToGeometry(vertices) || body.geometry || { x: 0, y: 0, w: 0, h: 0 };

    let datasetReady = true;
    try {
      ensureProcessedDataset(projectId, imageId);
    } catch (datasetError) {
      if (datasetError?.statusCode === 404 || datasetError?.statusCode === 409) {
        datasetReady = false;
      } else {
        throw datasetError;
      }
    }

    const storedPayload = {
      geometry: geometryRect,
      polygon: vertices,
      status: datasetReady ? 'pending' : 'completed',
      error: null,
      stats: null,
      jobId: null,
      polygon_centroids: []
    };

    await storeRoiMetadata({
      projectId,
      imageId,
      roiName,
      payload: storedPayload
    });

    if (!datasetReady) {
      const stored = await getStoredRoi({ projectId, imageId, roiName });
      const roi = buildRoiPayload({
        projectId,
        imageId,
        roiName,
        polygon: stored?.polygon || vertices,
        stats: stored?.stats || {},
        stored: stored ? { ...stored, status: stored.status || 'completed' } : null,
        pipelineCentroids: stored?.polygon_centroids || [],
        pipelineTotals: stored?.stats?.n_cells_total ?? null,
        defaultStatus: 'completed'
      });

      return res.status(201).json(roi);
    }

    await queueRoiJob({ projectId, imageId, roiName, geometry: geometryRect, polygon: vertices });
    schedulePendingWork(500);

    const stored = await getStoredRoi({ projectId, imageId, roiName });
    const roi = buildRoiPayload({
      projectId,
      imageId,
      roiName,
      polygon: stored?.polygon || vertices,
      stats: stored?.stats || {},
      stored,
      pipelineCentroids: stored?.polygon_centroids || [],
      pipelineTotals: stored?.stats?.n_cells_total ?? null,
      defaultStatus: stored?.status || 'pending'
    });

    res.status(202).json(roi);
  } catch (error) {
    const wrapped = handlePipelineError(error);
    res.status(wrapped.statusCode).json({ error: wrapped.message, details: wrapped.details || null });
  }
};

const updateRoiHandler = async (req, res) => {
  const { projectId, imageId, roiId } = req.params;
  const body = req.body || {};

  if (!projectId || !imageId) {
    return res.status(400).json({ error: 'projectId and imageId are required' });
  }

  const currentName = sanitizeRoiName(roiId || body.currentName || body.name, null);
  const requestedName = sanitizeRoiName(body.name, currentName || `${ROI_NAME_PREFIX}_${Date.now()}`);
  const hasGeometryUpdate = Array.isArray(body.vertices) || body.geometry;

  if (!currentName && !hasGeometryUpdate) {
    return res.status(400).json({ error: 'ROI name is required' });
  }

  try {
    ensureProcessedDataset(projectId, imageId);

    if (hasGeometryUpdate) {
      const vertices = normalizeVertices({ vertices: body.vertices, geometry: body.geometry });
      if (!Array.isArray(vertices) || vertices.length < 3) {
        return res.status(400).json({ error: 'ROI requires at least 3 vertices or valid rectangle geometry' });
      }

      const pipelineResult = await applyPipelineAdd({ projectId, imageId, roiName: requestedName, vertices });
      if (currentName && requestedName !== currentName) {
        await applyPipelineDelete({ projectId, imageId, roiName: currentName });
        await removeRoiMetadata({ projectId, imageId, roiName: currentName });
      }

      const roi = buildRoiPayload({
        projectId,
        imageId,
        roiName: requestedName,
        polygon: pipelineResult.roi_polygon_pixels || vertices,
        stats: {
          n_cells: pipelineResult.n_cells_in_roi,
          percentage: pipelineResult.percentage,
          n_cells_total: pipelineResult.n_cells_total
        },
        stored: null,
        pipelineCentroids: pipelineResult.roi_polygon_centroids,
        defaultStatus: 'completed'
      });

      await persistRoi({ projectId, imageId, roi });
      return res.json(roi);
    }

    const pipelineResult = await fetchPipelineRois({ projectId, imageId });
    const existing = (pipelineResult.rois || []).find((roi) => roi.name === currentName);
    if (!existing) {
      return res.status(404).json({ error: 'ROI not found' });
    }

    if (requestedName === currentName) {
      const stored = (await listStoredRois(projectId, imageId)).find((roi) => roi.name === currentName) || null;
      const polygon = existing.polygon_pixels || stored?.polygon || [];
      const roi = buildRoiPayload({
        projectId,
        imageId,
        roiName: currentName,
        polygon,
        stats: {
          n_cells: existing.n_cells,
          percentage: existing.percentage,
          n_cells_total: pipelineResult.n_cells_total
        },
        stored,
        pipelineCentroids: existing.polygon_centroids,
        pipelineTotals: pipelineResult.n_cells_total,
        defaultStatus: stored?.status || 'completed'
      });
      return res.json(roi);
    }

    const polygon = existing.polygon_pixels;
    if (!Array.isArray(polygon) || polygon.length < 3) {
      return res.status(400).json({ error: 'ROI polygon data is unavailable for rename' });
    }

    const pipelineResultNew = await applyPipelineAdd({ projectId, imageId, roiName: requestedName, vertices: polygon });
    await applyPipelineDelete({ projectId, imageId, roiName: currentName });
    await removeRoiMetadata({ projectId, imageId, roiName: currentName });

    const roi = buildRoiPayload({
      projectId,
      imageId,
      roiName: requestedName,
      polygon: pipelineResultNew.roi_polygon_pixels || polygon,
      stats: {
        n_cells: pipelineResultNew.n_cells_in_roi,
        percentage: pipelineResultNew.percentage,
        n_cells_total: pipelineResultNew.n_cells_total
      },
      stored: null,
      pipelineCentroids: pipelineResultNew.roi_polygon_centroids,
      defaultStatus: 'completed'
    });

    await persistRoi({ projectId, imageId, roi });
    res.json(roi);
  } catch (error) {
    const wrapped = handlePipelineError(error);
    res.status(wrapped.statusCode).json({ error: wrapped.message, details: wrapped.details || null });
  }
};

const deleteRoiHandler = async (req, res) => {
  const { projectId, imageId, roiId } = req.params;
  const roiName = sanitizeRoiName(roiId || req.body?.roiName || req.body?.name, null);

  if (!projectId || !imageId) {
    return res.status(400).json({ error: 'projectId and imageId are required' });
  }

  if (!roiName) {
    return res.status(400).json({ error: 'ROI name is required for deletion' });
  }

  try {
    let datasetReady = true;
    try {
      ensureProcessedDataset(projectId, imageId);
    } catch (datasetError) {
      if (datasetError?.statusCode === 404 || datasetError?.statusCode === 409) {
        datasetReady = false;
      } else {
        throw datasetError;
      }
    }

    if (datasetReady) {
      try {
        await applyPipelineDelete({ projectId, imageId, roiName });
        await syncProcessedDataset({ projectId, imageId, reason: 'roi-delete' });
      } catch (pipelineError) {
        if (pipelineError?.statusCode !== 404) {
          console.warn(`ROI pipeline deletion failed for ${projectId}/${imageId}/${roiName}:`, pipelineError.message || pipelineError);
        }
      }
    }

    try {
      await removeRoiMetadata({ projectId, imageId, roiName });
    } catch (metadataError) {
      console.warn(`Failed to remove ROI metadata for ${projectId}/${imageId}/${roiName}:`, metadataError.message);
    }

    res.json({ success: true, pipelineSyncAttempted: datasetReady });
  } catch (error) {
    const wrapped = handlePipelineError(error);
    res.status(wrapped.statusCode).json({ error: wrapped.message, details: wrapped.details || null });
  }
};

app.get('/api/projects/:projectId/images/:imageId/rois', listRoiHandler);
app.post('/api/projects/:projectId/images/:imageId/rois', createRoiHandler);
app.put('/api/projects/:projectId/images/:imageId/rois/:roiId', updateRoiHandler);
app.delete('/api/projects/:projectId/images/:imageId/rois/:roiId', deleteRoiHandler);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'Server is running!',
    langchainEnabled: !!global.langchainAgent,
    biologicalFormatsSupported: true,
    version: '2.0.0'
  });
});

// ROI endpoints will be redefined below with project-aware storage

// Conversation memory inspection endpoints
app.get('/api/conversations', (req, res) => {
  res.json({
    conversations: conversationMemory.listConversations()
  });
});

app.get('/api/conversations/:conversationId', (req, res) => {
  const { conversationId } = req.params;
  const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 50));
  const conversation = conversationMemory.getConversation(conversationId);

  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  const messages = conversation.messages.slice(-limit);

  res.json({
    id: conversation.id,
    userId: conversation.userId,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    summary: conversation.summary,
    summaryUpdatedAt: conversation.summaryUpdatedAt,
    messageCount: conversation.messages.length,
    messages
  });
});

// Enhanced chat endpoint with conversation memory integration
app.post('/api/chat', async (req, res) => {
  let currentConversationId = null;
  let message = '';
  let userId = 'anonymous';
  let metadata = {};

  const respondWithFallback = (error, source = 'enhanced_fallback') => {
    const reply = buildFallbackReply(message);
    const errorMessage = safeErrorMessage(error);

    console.warn(
      `🟡 Responding with fallback (source=${source}) for conversation ${currentConversationId || 'n/a'}:`,
      errorMessage
    );

    if (currentConversationId) {
      try {
        conversationMemory.appendMessage(currentConversationId, {
          role: 'assistant',
          content: reply,
          metadata: { source, error: errorMessage }
        });
      } catch (storageError) {
        console.error(
          `❗ Failed to store fallback response for conversation ${currentConversationId}:`,
          storageError
        );
      }
    }

    try {
      if (!res.headersSent) {
        res.status(200).json({
          conversationId: currentConversationId,
          reply,
          source,
          demo_mode: true,
          error: errorMessage
        });
      } else {
        res.end();
      }
    } catch (responseError) {
      console.error('❗ Failed to send fallback JSON response:', responseError);
      if (!res.headersSent) {
        try {
          res.status(200);
          res.setHeader('Content-Type', 'application/json');
          res.send(
            JSON.stringify({
              conversationId: currentConversationId,
              reply,
              source,
              demo_mode: true,
              error: errorMessage
            })
          );
        } catch (finalError) {
          console.error('❗ Final attempt to send fallback response failed:', finalError);
          if (!res.headersSent) {
            res.status(500).send('Fallback response failed');
          } else {
            res.end();
          }
        }
      }
    }

    return res;
  };

  try {
    console.log('🔵 SERVER: Received chat request:', req.body);

    const body = req.body || {};
    message = body.message;
    currentConversationId = body.conversationId || null;
    userId = body.userId ?? 'anonymous';
    metadata =
      body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
        ? body.metadata
        : {};

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Get or create conversation
    let conversation;

    if (currentConversationId) {
      conversation = conversationMemory.getConversation(currentConversationId);
      if (!conversation) {
        console.log(`⚠️ Conversation ${currentConversationId} not found, creating new one`);
        conversation = conversationMemory.createConversation({ userId, metadata });
        currentConversationId = conversation.id;
      }
    } else {
      conversation = conversationMemory.createConversation({ userId, metadata });
      currentConversationId = conversation.id;
      console.log(`🆕 Created new conversation: ${currentConversationId}`);
    }

    try {
      conversationMemory.appendMessage(currentConversationId, {
        role: 'user',
        content: message,
        metadata
      });
    } catch (storeError) {
      console.error(
        `❌ Failed to store user message for conversation ${currentConversationId}:`,
        storeError
      );
      return respondWithFallback(storeError, 'memory_error');
    }

    let context;
    try {
      context = conversationMemory.getContext(currentConversationId);
    } catch (contextError) {
      console.error(
        `❌ Failed to load conversation context for ${currentConversationId}:`,
        contextError
      );
      return respondWithFallback(contextError, 'memory_error');
    }

    // Convert messages to LangChain format
    const chatHistory = context.messages
      .slice(-5)
      .map(msg => {
        try {
          if (msg.role === 'user') {
            return new HumanMessage(msg.content);
          } else if (msg.role === 'assistant') {
            return new AIMessage(msg.content);
          }
          return new SystemMessage(msg.content);
        } catch (error) {
          console.error('Error creating message:', error);
          return new HumanMessage(msg.content || '');
        }
      })
      .filter(Boolean);

    // Use LangChain agent with conversation context
    try {
      if (!global.langchainAgent) {
        console.error('❌ LangChain agent is not initialized. Please ensure it is set up correctly.');
        throw new Error('LangChain agent not initialized');
      }

      console.log(`🤖 Using LangChain agent with ${chatHistory.length} context messages`);

      const startTime = Date.now();
      const agentPromise = global.langchainAgent.invoke({
        input: message,
        chat_history: chatHistory
      });

      let result;
      try {
        result = await invokeAgentWithTimeout(agentPromise, AGENT_TIMEOUT_MS);
      } catch (agentError) {
        agentPromise
          .then(lateResult => {
            console.warn('🟠 LangChain agent resolved after timeout/error:', lateResult);
          })
          .catch(lateError => {
            console.warn('🟠 LangChain agent rejection after primary handling:', lateError);
          });
        throw agentError;
      }

      const endTime = Date.now();
      console.log(`⏱️ LangChain agent response time: ${endTime - startTime}ms`);

      const agentReply = `${result?.output ?? ''}`.trim();
      if (!agentReply) {
        throw new Error('Agent returned an empty response');
      }

      const steps = Array.isArray(result?.steps) ? result.steps : [];
      const functionsUsed = steps
        .map(step => step?.action?.tool)
        .filter(tool => typeof tool === 'string' && tool.length > 0);

      try {
        conversationMemory.appendMessage(currentConversationId, {
          role: 'assistant',
          content: agentReply,
          metadata: { functions_used: functionsUsed }
        });
      } catch (storeAssistantError) {
        console.error(
          `❗ Failed to store agent response for conversation ${currentConversationId}:`,
          storeAssistantError
        );
      }

      try {
        await conversationMemory.maybeSummarize(currentConversationId);
      } catch (summaryError) {
        console.warn(
          `⚠️ Conversation summarization skipped for ${currentConversationId}:`,
          summaryError
        );
      }

      console.log('✅ LangChain agent response:', agentReply);

      return res.json({
        conversationId: currentConversationId,
        reply: agentReply,
        source: 'langchain',
        functions_used: functionsUsed,
        summary: context.summary || null
      });
    } catch (error) {
      console.error('❌ LangChain agent error:', error);
      console.log('🔵 SERVER: Using enhanced fallback response');
      return respondWithFallback(error, 'enhanced_fallback');
    }
  } catch (error) {
    console.error('❌ Unexpected error in /api/chat:', error);
    return respondWithFallback(error, 'server_error');
  }
});

// Function tools inspection endpoints
app.get('/api/functions', (req, res) => {
  const tools = global.langchainTools || [];
  res.json({
    functions: tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      schema: tool.schema
    })),
    total: tools.length
  });
});

app.get('/api/functions/:name', (req, res) => {
  const { name } = req.params;
  const tools = global.langchainTools || [];
  const tool = tools.find(t => t.name === name);

  if (!tool) {
    return res.status(404).json({ error: 'Function not found' });
  }

  res.json({
    name: tool.name,
    description: tool.description,
    schema: tool.schema
  });
});

// Direct function execution endpoint (for testing)
app.post('/api/functions/:name/execute', async (req, res) => {
  const { name } = req.params;
  const { input = {} } = req.body;

  try {
    const tools = global.langchainTools || [];
    const tool = tools.find(t => t.name === name);

    if (!tool) {
      return res.status(404).json({ error: 'Function not found' });
    }

    const result = await tool.invoke(input);
    res.json({
      success: true,
      function: name,
      input: input,
      result: result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      function: name,
      input: input,
      error: error.message
    });
  }
});

// NEW: Toy examples endpoint
app.get('/api/examples', (req, res) => {
  res.json({
    message: "SlidChat LangChain Integration Examples",
    examples: [
      {
        type: "slide_analysis",
        query: "What information do you have about slide lung_01?",
        expected_functions: ["getSlideInfo"],
        description: "Retrieves detailed slide metadata and information"
      },
      {
        type: "roi_creation",
        query: "Create a new ROI called 'tumor_region' at position x:100, y:200 with width 300 and height 250 on slide lung_01",
        expected_functions: ["createROI"],
        description: "Creates a new region of interest with specified geometry"
      },
      {
        type: "biological_analysis",
        query: "Perform morphology analysis on slide lung_01",
        expected_functions: ["analyzeBiologicalFeatures"],
        description: "Analyzes biological features like cell count, nuclear area, etc."
      },
      {
        type: "similarity_search",
        query: "Find slides similar to lung_01 with morphology similarity above 0.85",
        expected_functions: ["findSimilarSlides"],
        description: "Searches for slides with similar biological features"
      },
      {
        type: "combined_workflow",
        query: "Analyze the cellular density in slide lung_01 and then find similar slides",
        expected_functions: ["analyzeBiologicalFeatures", "findSimilarSlides"],
        description: "Demonstrates multi-step function calling workflow"
      }
    ]
  });
});

// ============================================================================
// Python Multiagent Proxy Endpoints
// ============================================================================

const PYTHON_MULTIAGENT_URL = process.env.PYTHON_MULTIAGENT_URL || 'http://localhost:8000';

/**
 * POST /api/multiagent/analyze
 * Submit a new analysis job to the Python multiagent service
 */
app.post('/api/multiagent/analyze', async (req, res) => {
  try {
    console.log('📤 Forwarding analysis request to Python multiagent service');
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000); // 60 seconds

    const response = await fetch(`${PYTHON_MULTIAGENT_URL}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
      signal: controller.signal
    });

    clearTimeout(timeout);
    console.log('Python response status:', response.status, response.statusText);

    if (!response.ok) {
      const error = await response.json();
      console.error('Python error response:', error);
      return res.status(response.status).json(error);
    }

    const result = await response.json();
    console.log('Python response data:', JSON.stringify(result, null, 2));
    console.log(`✅ Analysis job created: ${result.job_id}`);

    res.json(result);
    console.log('Sent response to frontend');
  } catch (error) {
    console.error('❌ Error forwarding to multiagent service:', error);
    res.status(500).json({
      error: 'Failed to communicate with multiagent service',
      message: error.message
    });
  }
});

/**
 * GET /api/multiagent/status/:jobId
 * Check the status of an analysis job
 */
app.get('/api/multiagent/status/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30 seconds

    const response = await fetch(`${PYTHON_MULTIAGENT_URL}/api/status/${jobId}`, {
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const error = await response.json();
      return res.status(response.status).json(error);
    }

    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error('❌ Error checking job status:', error);
    res.status(500).json({
      error: 'Failed to check job status',
      message: error.message
    });
  }
});

/**
 * GET /api/multiagent/result/:jobId
 * Get the result of a completed analysis job
 */
app.get('/api/multiagent/result/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const response = await fetch(`${PYTHON_MULTIAGENT_URL}/api/result/${jobId}`);

    if (!response.ok) {
      const error = await response.json();
      return res.status(response.status).json(error);
    }

    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error('❌ Error fetching job result:', error);
    res.status(500).json({
      error: 'Failed to fetch job result',
      message: error.message
    });
  }
});

/**
 * GET /api/multiagent/download/:jobId/:fileType
 * Download result files (report, pdf, or log)
 */
app.get('/api/multiagent/download/:jobId/:fileType', async (req, res) => {
  try {
    const { jobId, fileType } = req.params;
    const response = await fetch(`${PYTHON_MULTIAGENT_URL}/api/download/${jobId}/${fileType}`);

    if (!response.ok) {
      const error = await response.json();
      return res.status(response.status).json(error);
    }

    // Forward the file response
    res.setHeader('Content-Type', response.headers.get('content-type'));
    res.setHeader('Content-Disposition', response.headers.get('content-disposition'));

    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('❌ Error downloading file:', error);
    res.status(500).json({
      error: 'Failed to download file',
      message: error.message
    });
  }
});

/**
 * GET /api/multiagent/jobs
 * List all analysis jobs
 */
app.get('/api/multiagent/jobs', async (req, res) => {
  try {
    const response = await fetch(`${PYTHON_MULTIAGENT_URL}/api/jobs`);

    if (!response.ok) {
      const error = await response.json();
      return res.status(response.status).json(error);
    }

    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error('❌ Error listing jobs:', error);
    res.status(500).json({
      error: 'Failed to list jobs',
      message: error.message
    });
  }
});

/**
 * GET /api/multiagent/messages/:jobId
 * Get interaction messages from a job
 */
app.get('/api/multiagent/messages/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30 seconds

    const response = await fetch(`${PYTHON_MULTIAGENT_URL}/api/messages/${jobId}`, {
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const error = await response.json();
      return res.status(response.status).json(error);
    }

    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error('❌ Error fetching messages:', error);
    res.status(500).json({
      error: 'Failed to fetch messages',
      message: error.message
    });
  }
});

/**
 * POST /api/multiagent/response/:jobId
 * Submit a user response to an agent question
 */
app.post('/api/multiagent/response/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const response = await fetch(`${PYTHON_MULTIAGENT_URL}/api/response/${jobId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });

    if (!response.ok) {
      const error = await response.json();
      return res.status(response.status).json(error);
    }

    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error('❌ Error submitting response:', error);
    res.status(500).json({
      error: 'Failed to submit response',
      message: error.message
    });
  }
});

/**
 * POST /api/multiagent/chat
 * Simple chat endpoint for general conversation with GPT
 */
app.post('/api/multiagent/chat', async (req, res) => {
  try {
    const response = await fetch(`${PYTHON_MULTIAGENT_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });

    if (!response.ok) {
      const error = await response.json();
      return res.status(response.status).json(error);
    }

    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error('❌ Error in chat:', error);
    res.status(500).json({
      error: 'Failed to chat',
      message: error.message
    });
  }
});

// ============================================================================
// End Python Multiagent Proxy Endpoints
// ============================================================================

// Initialize server and start
const PORT = process.env.PORT || 5050;

async function startServer() {
  await ensureKidneySlideAssets();
  await ensureJobQueueInitialized();
  await initializeServer();

  const server = app.listen(PORT, () => {
    console.log(`🚀 Enhanced SlidChat server running on port ${PORT}`);
    console.log(`📊 Functions registered: 4`);
    console.log(`🤖 LangChain agent: ${global.langchainAgent ? 'enabled' : 'disabled'}`);
    console.log(`🧠 Conversation memory: ${conversationMemory ? 'enabled' : 'disabled'} (storage: ${conversationMemory?.storagePath || 'n/a'})`);
    console.log(`\n🧪 Try these toy examples:`);
    console.log(`   GET  http://localhost:${PORT}/api/examples`);
    console.log(`   GET  http://localhost:${PORT}/api/functions`);
    console.log(`   POST http://localhost:${PORT}/api/functions/getSlideInfo/execute`);
    console.log(`   POST http://localhost:${PORT}/api/chat`);
  });

  server.on('close', () => {
    console.log('🛑 HTTP server closed');
  });

  server.on('error', (error) => {
    console.error('❌ HTTP server error:', error);
  });
}

startServer();
