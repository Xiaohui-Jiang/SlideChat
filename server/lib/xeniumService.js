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
    console.log('🔵 [XENIUM SERVICE] addROI called:', {
      slideId,
      roiName,
      verticesCount: vertices.length,
      vertices: vertices.slice(0, 3).concat(['...']) // Show first 3 vertices
    });
    
    const command = {
      action: 'add_roi',
      slide_id: slideId,
      roi_name: roiName,
      roi_vertices: vertices // [[x,y], [x,y], ...]
    };

    console.log('🐍 [XENIUM SERVICE] Executing Python with command:', {
      action: command.action,
      slide_id: command.slide_id,
      roi_name: command.roi_name,
      vertices_count: command.roi_vertices.length
    });
    
    const result = await this._executePython(command);
    
    console.log('✅ [XENIUM SERVICE] Python execution completed:', {
      success: result.success,
      n_cells_in_roi: result.n_cells_in_roi,
      n_cells_total: result.n_cells_total,
      percentage: result.percentage
    });
    
    return result;
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

      console.log('🚀 [PYTHON SPAWN] Starting Python subprocess:', {
        pythonPath: this.pythonPath,
        script: this.pythonScript,
        action: command.action
      });

      const python = spawn(this.pythonPath, args);
      let stdout = '';
      let stderr = '';

      python.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        // Log Python stdout in real-time
        if (output.trim()) {
          console.log('🐍 [PYTHON STDOUT]:', output.trim());
        }
      });

      python.stderr.on('data', (data) => {
        const error = data.toString();
        stderr += error;
        // Log Python stderr in real-time
        if (error.trim()) {
          console.log('⚠️  [PYTHON STDERR]:', error.trim());
        }
      });

      python.on('close', (code) => {
        console.log(`🏁 [PYTHON SPAWN] Process exited with code ${code}`);
        
        if (code !== 0) {
          console.error('❌ [PYTHON SPAWN] Process failed:', stderr);
          reject(new Error(`Python process failed: ${stderr}`));
          return;
        }

        try {
          const result = JSON.parse(stdout);
          console.log('✅ [PYTHON SPAWN] Successfully parsed result');
          resolve(result);
        } catch (error) {
          console.error('❌ [PYTHON SPAWN] Failed to parse output:', stdout);
          reject(new Error(`Failed to parse Python output: ${stdout}`));
        }
      });

      python.on('error', (error) => {
        console.error('❌ [PYTHON SPAWN] Failed to spawn:', error.message);
        reject(new Error(`Failed to spawn Python: ${error.message}`));
      });
    });
  }
}
