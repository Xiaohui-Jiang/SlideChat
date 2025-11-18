/**
 * Xenium API Routes
 *
 * Express routes for automated Xenium ROI processing.
 * Add this to your existing Express server.
 */

import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import XeniumService from '../lib/xeniumService.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure multer for file uploads
const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');
const OUTPUT_ROOT = path.join(__dirname, '..', 'data', 'processed');

fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
fs.mkdirSync(OUTPUT_ROOT, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_ROOT);
  },
  filename: (req, file, cb) => {
    const slideId = req.body.slideId || 'unknown';
    const timestamp = Date.now();
    cb(null, `${slideId}_${timestamp}_${file.originalname}`);
  }
});

const upload = multer({ storage });

// Initialize Xenium service
const xeniumService = new XeniumService(UPLOAD_ROOT, OUTPUT_ROOT);

/**
 * POST /api/xenium/upload
 * Upload all Xenium files and auto-preprocess
 * 
 * Body (multipart/form-data):
 *   - slideId: unique identifier
 *   - matrix: cell_feature_matrix.h5
 *   - cells: cells.csv or cells.csv.gz
 *   - alignment: alignment.csv
 *   - image: .tif or .ome.tif
 */
router.post('/upload', upload.fields([
  { name: 'matrix', maxCount: 1 },
  { name: 'cells', maxCount: 1 },
  { name: 'alignment', maxCount: 1 },
  { name: 'image', maxCount: 1 }
]), async (req, res) => {
  try {
    const slideId = req.body.slideId;
    
    if (!slideId) {
      return res.status(400).json({ error: 'slideId is required' });
    }

    // Get uploaded file paths
    const files = {
      matrix_path: req.files.matrix?.[0]?.path,
      cells_path: req.files.cells?.[0]?.path,
      alignment_path: req.files.alignment?.[0]?.path,
      image_path: req.files.image?.[0]?.path
    };

    // Validate all files present
    for (const [key, value] of Object.entries(files)) {
      if (!value) {
        return res.status(400).json({ error: `Missing file: ${key}` });
      }
    }

    // Auto-preprocess (STEPS 1-2)
    console.log(`[${slideId}] Starting auto-preprocessing...`);
    const result = await xeniumService.preprocessDataset(slideId, files);

    res.json(result);
  } catch (error) {
    console.error('Upload/preprocess error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * POST /api/xenium/roi
 * Add ROI when user draws polygon
 * 
 * Body (JSON):
 *   - slideId: string
 *   - roiName: string (e.g., "roi_1", "tumor_region")
 *   - vertices: [[x,y], [x,y], ...] in pixel coordinates
 */
router.post('/roi', async (req, res) => {
  try {
    const { slideId, roiName, vertices } = req.body;

    if (!slideId || !roiName || !vertices) {
      return res.status(400).json({ 
        error: 'slideId, roiName, and vertices are required' 
      });
    }

    console.log(`[${slideId}] Adding ROI: ${roiName}`);
    const result = await xeniumService.addROI(slideId, roiName, vertices);

    res.json(result);
  } catch (error) {
    console.error('Add ROI error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * DELETE /api/xenium/roi
 * Delete ROI when user removes it
 * 
 * Body (JSON):
 *   - slideId: string
 *   - roiName: string
 */
router.delete('/roi', async (req, res) => {
  try {
    const { slideId, roiName } = req.body;

    if (!slideId || !roiName) {
      return res.status(400).json({ 
        error: 'slideId and roiName are required' 
      });
    }

    console.log(`[${slideId}] Deleting ROI: ${roiName}`);
    const result = await xeniumService.deleteROI(slideId, roiName);

    res.json(result);
  } catch (error) {
    console.error('Delete ROI error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * GET /api/xenium/rois/:slideId
 * Get list of all ROIs for a slide
 */
router.get('/rois/:slideId', async (req, res) => {
  try {
    const { slideId } = req.params;
    const result = await xeniumService.getROIList(slideId);
    res.json(result);
  } catch (error) {
    console.error('Get ROIs error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * GET /api/xenium/download/:slideId
 * Download modified h5ad with all ROIs
 */
router.get('/download/:slideId', async (req, res) => {
  try {
    const { slideId } = req.params;
    const h5adPath = await xeniumService.getH5ADPath(slideId);

    if (!h5adPath) {
      return res.status(404).json({ error: 'Dataset not found' });
    }

    res.download(h5adPath, `${slideId}_with_rois.h5ad`);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * GET /api/xenium/overlay/:slideId
 * Get cell positions for TIFF overlay visualization
 * 
 * Query params:
 *   - downsample: int (default 1, use 10+ for large datasets)
 */
router.get('/overlay/:slideId', async (req, res) => {
  try {
    const { slideId } = req.params;
    const downsample = parseInt(req.query.downsample) || 1;

    const result = await xeniumService.getCellOverlay(slideId, downsample);
    res.json(result);
  } catch (error) {
    console.error('Get overlay error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

export default router;
