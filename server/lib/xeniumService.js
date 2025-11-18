/**
 * Xenium ROI Processing Service
 *
 * Node.js service that wraps the Python xenium_processor module.
 * Handles all Xenium data preprocessing and ROI management automatically.
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default class XeniumService {
  constructor(uploadDir, outputDir) {
    this.uploadDir = uploadDir;
    this.outputDir = outputDir;
    this.pythonScript = path.join(__dirname, 'xenium_processor_cli.py');
    this.pythonPath = process.env.PYTHON_PATH || 'python3';
  }

  /**
   * Preprocess dataset when user uploads all files
   * This runs STEPS 1-2 automatically
   */
  async preprocessDataset(slideId, files) {
    const {
      matrix_path,  // cell_feature_matrix.h5
      cells_path,   // cells.csv or cells.csv.gz
      alignment_path, // alignment.csv
      image_path    // .tif or .ome.tif
    } = files;

    const command = {
      action: 'preprocess',
      slide_id: slideId,
      matrix_path,
      cells_path,
      alignment_path,
      image_path
    };

    return this._executePython(command);
  }

  /**
   * Add ROI when user draws polygon
   * This runs STEP 4 automatically
   */
  async addROI(slideId, roiName, vertices) {
    const command = {
      action: 'add_roi',
      slide_id: slideId,
      roi_name: roiName,
      roi_vertices: vertices // [[x,y], [x,y], ...]
    };

    return this._executePython(command);
  }

  /**
   * Delete ROI column when user deletes ROI
   */
  async deleteROI(slideId, roiName) {
    const command = {
      action: 'delete_roi',
      slide_id: slideId,
      roi_name: roiName
    };

    return this._executePython(command);
  }

  /**
   * Get list of all ROIs for a slide
   */
  async getROIList(slideId) {
    const command = {
      action: 'get_roi_list',
      slide_id: slideId
    };

    return this._executePython(command);
  }

  /**
   * Get h5ad file path for download
   */
  async getH5ADPath(slideId) {
    const outputPath = path.join(this.outputDir, `${slideId}_processed.h5ad`);
    try {
      await fs.access(outputPath);
      return outputPath;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get cell overlay data for visualization
   */
  async getCellOverlay(slideId, downsample = 1) {
    const command = {
      action: 'get_overlay',
      slide_id: slideId,
      downsample
    };

    return this._executePython(command);
  }

  /**
   * Execute Python processor with JSON input/output
   */
  _executePython(command) {
    return new Promise((resolve, reject) => {
      const args = [
        this.pythonScript,
        '--upload-dir', this.uploadDir,
        '--output-dir', this.outputDir,
        '--command', JSON.stringify(command)
      ];

      const python = spawn(this.pythonPath, args);
      let stdout = '';
      let stderr = '';

      python.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      python.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      python.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Python process failed: ${stderr}`));
          return;
        }

        try {
          const result = JSON.parse(stdout);
          resolve(result);
        } catch (error) {
          reject(new Error(`Failed to parse Python output: ${stdout}`));
        }
      });

      python.on('error', (error) => {
        reject(new Error(`Failed to spawn Python: ${error.message}`));
      });
    });
  }
}
