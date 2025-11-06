/**
 * ROI Processing API Integration
 * 
 * This module handles communication between the Node.js server and Python
 * xenium_roi_selector.py script for spatial transcriptomics ROI analysis.
 */

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Process an ROI polygon and generate annotated spatial data
 * 
 * @param {Object} options - Processing options
 * @param {Array<Array<number>>} options.roiPolygon - Array of [x, y] pixel coordinates
 * @param {string} options.slideId - Unique identifier for the slide
 * @param {string} options.dataDir - Path to Xenium data directory
 * @returns {Promise<Object>} - Result with paths and metadata
 */
export async function processROI({ roiPolygon, slideId, dataDir }) {
  // Validate inputs
  if (!roiPolygon || !Array.isArray(roiPolygon) || roiPolygon.length < 3) {
    throw new Error('ROI polygon must have at least 3 vertices');
  }

  if (!slideId) {
    throw new Error('Slide ID is required');
  }

  if (!dataDir) {
    throw new Error('Data directory is required');
  }

  // Create output directory for this slide
  const outputDir = path.join(__dirname, '..', 'data', 'roi_results', slideId);
  await fs.mkdir(outputDir, { recursive: true });

  // Write ROI polygon to JSON file
  const roiJsonPath = path.join(outputDir, 'roi_polygon.json');
  await fs.writeFile(roiJsonPath, JSON.stringify(roiPolygon, null, 2));

  // Define output paths
  const h5adPath = path.join(outputDir, 'annotated_data.h5ad');
  const overlayPath = path.join(outputDir, 'roi_overlay.png');
  const logPath = path.join(outputDir, 'processing.log');

  // Path to Python script
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'xenium_roi_selector.py');

  // Prepare Python command arguments
  const args = [
    scriptPath,
    '--data-dir', dataDir,
    '--roi-json', roiJsonPath,
    '--skip-plot',
    '--output', h5adPath,
    '--figure-path', overlayPath,
    '--point-size', '6.0',
    '--roi-column', 'roi',
  ];

  console.log(`[ROI Processor] Starting Python script for slide ${slideId}`);
  console.log(`[ROI Processor] Command: python ${args.join(' ')}`);

  return new Promise((resolve, reject) => {
    const logStream = [];
    const errorStream = [];

    // Spawn Python process
    const pythonProcess = spawn('python', args, {
      cwd: path.join(__dirname, '..', '..'),
      env: { ...process.env }
    });

    // Capture stdout
    pythonProcess.stdout.on('data', (data) => {
      const text = data.toString();
      logStream.push(text);
      console.log(`[Python stdout] ${text.trim()}`);
    });

    // Capture stderr
    pythonProcess.stderr.on('data', (data) => {
      const text = data.toString();
      errorStream.push(text);
      console.error(`[Python stderr] ${text.trim()}`);
    });

    // Handle process completion
    pythonProcess.on('close', async (code) => {
      // Write logs to file
      const fullLog = logStream.join('') + '\n--- ERRORS ---\n' + errorStream.join('');
      await fs.writeFile(logPath, fullLog).catch(err => 
        console.error('Failed to write log file:', err)
      );

      if (code !== 0) {
        reject(new Error(
          `Python script exited with code ${code}\n` +
          `Last error: ${errorStream.slice(-5).join('')}`
        ));
        return;
      }

      // Parse output to extract cell count
      let cellCount = null;
      const cellCountMatch = fullLog.match(/ROI column 'roi' updated for (\d+) cells/);
      if (cellCountMatch) {
        cellCount = parseInt(cellCountMatch[1], 10);
      }

      // Verify output files exist
      try {
        await fs.access(h5adPath);
        await fs.access(overlayPath);
      } catch (err) {
        reject(new Error(`Output files not generated: ${err.message}`));
        return;
      }

      // Get file sizes
      const h5adStats = await fs.stat(h5adPath);
      const overlayStats = await fs.stat(overlayPath);

      console.log(`[ROI Processor] Processing complete for slide ${slideId}`);
      console.log(`[ROI Processor] Cells in ROI: ${cellCount}`);

      resolve({
        success: true,
        slideId,
        cellCount,
        roiPolygon,
        files: {
          h5ad: {
            path: h5adPath,
            url: `/api/roi/${slideId}/data.h5ad`,
            size: h5adStats.size
          },
          overlay: {
            path: overlayPath,
            url: `/api/roi/${slideId}/overlay.png`,
            size: overlayStats.size
          },
          roiJson: {
            path: roiJsonPath,
            url: `/api/roi/${slideId}/polygon.json`,
            size: (await fs.stat(roiJsonPath)).size
          },
          log: {
            path: logPath,
            url: `/api/roi/${slideId}/log.txt`,
            size: (await fs.stat(logPath)).size
          }
        },
        timestamp: new Date().toISOString()
      });
    });

    // Handle process errors
    pythonProcess.on('error', (err) => {
      reject(new Error(`Failed to start Python process: ${err.message}`));
    });
  });
}

/**
 * List all ROI results for a slide
 * 
 * @param {string} slideId - Slide identifier
 * @returns {Promise<Object|null>} - Result metadata or null if not found
 */
export async function getROIResult(slideId) {
  const outputDir = path.join(__dirname, '..', 'data', 'roi_results', slideId);
  
  try {
    await fs.access(outputDir);
  } catch {
    return null;
  }

  const h5adPath = path.join(outputDir, 'annotated_data.h5ad');
  const overlayPath = path.join(outputDir, 'roi_overlay.png');
  const roiJsonPath = path.join(outputDir, 'roi_polygon.json');

  try {
    const [h5adStats, overlayStats, roiJsonStats, roiData] = await Promise.all([
      fs.stat(h5adPath),
      fs.stat(overlayPath),
      fs.stat(roiJsonPath),
      fs.readFile(roiJsonPath, 'utf-8').then(JSON.parse)
    ]);

    return {
      slideId,
      roiPolygon: roiData,
      files: {
        h5ad: {
          url: `/api/roi/${slideId}/data.h5ad`,
          size: h5adStats.size,
          modified: h5adStats.mtime
        },
        overlay: {
          url: `/api/roi/${slideId}/overlay.png`,
          size: overlayStats.size,
          modified: overlayStats.mtime
        },
        roiJson: {
          url: `/api/roi/${slideId}/polygon.json`,
          size: roiJsonStats.size,
          modified: roiJsonStats.mtime
        }
      }
    };
  } catch (err) {
    console.error(`Error reading ROI result for ${slideId}:`, err);
    return null;
  }
}

export default { processROI, getROIResult };
