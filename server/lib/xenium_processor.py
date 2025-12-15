"""
Xenium ROI Processor - Automated Pipeline for Web Application

This module provides a programmatic API for processing Xenium data and ROIs
without requiring command-line execution. Designed for integration with
Express/Node.js backend via child_process or direct Flask API.

Usage:
    processor = XeniumProcessor(upload_dir, output_dir)
    
    # When files are uploaded
    processor.preprocess_dataset(slide_id, matrix_path, cells_path, alignment_path, image_path)
    
    # When user draws ROI
    processor.add_roi(slide_id, roi_name, roi_vertices_pixels)
    
    # When user deletes ROI
    processor.delete_roi(slide_id, roi_name)
    
    # When user downloads
    h5ad_path = processor.get_h5ad_path(slide_id)
"""

import json
import logging
import sys
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
import shutil
import fcntl
import time

import h5py
import numpy as np
import pandas as pd
import tifffile
from anndata import AnnData
from scipy import sparse
from matplotlib.path import Path as MplPath

logging.basicConfig(level=logging.INFO)
LOGGER = logging.getLogger(__name__)


def debug_print(msg: str):
    """Print debug messages to stderr to avoid polluting stdout JSON."""
    print(msg, file=sys.stderr)


class H5ADFileLock:
    """Context manager for file locking to prevent concurrent h5ad access."""
    
    def __init__(self, h5ad_path: Path, mode: str = 'r', timeout: float = 30.0):
        """
        Args:
            h5ad_path: Path to the h5ad file
            mode: 'r' for read, 'w' for write
            timeout: Maximum time to wait for lock in seconds
        """
        self.h5ad_path = h5ad_path
        self.mode = mode
        self.timeout = timeout
        self.lock_file = h5ad_path.parent / f".{h5ad_path.name}.lock"
        self.lock_fd = None
        
    def __enter__(self):
        """Acquire file lock."""
        start_time = time.time()
        self.lock_fd = open(self.lock_file, 'w')
        
        while True:
            try:
                # LOCK_EX for exclusive lock (write), LOCK_SH for shared lock (read)
                lock_type = fcntl.LOCK_EX if self.mode == 'w' else fcntl.LOCK_SH
                fcntl.flock(self.lock_fd.fileno(), lock_type | fcntl.LOCK_NB)
                LOGGER.debug(f"Acquired {self.mode} lock on {self.h5ad_path.name}")
                return self
            except IOError as e:
                if time.time() - start_time > self.timeout:
                    raise TimeoutError(f"Could not acquire lock on {self.h5ad_path.name} after {self.timeout}s") from e
                time.sleep(0.1)
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Release file lock."""
        if self.lock_fd:
            fcntl.flock(self.lock_fd.fileno(), fcntl.LOCK_UN)
            self.lock_fd.close()
            LOGGER.debug(f"Released lock on {self.h5ad_path.name}")
            # Clean up lock file if no errors
            if exc_type is None and self.lock_file.exists():
                try:
                    self.lock_file.unlink()
                except:
                    pass


class XeniumProcessor:
    """Automated Xenium data processor for web applications."""
    
    def __init__(self, upload_dir: str, output_dir: str):
        """Initialize processor with upload and output directories.
        
        Args:
            upload_dir: Directory where user uploads are stored
            output_dir: Directory where processed h5ad files are saved
        """
        self.upload_dir = Path(upload_dir)
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
    def preprocess_dataset(
        self,
        slide_id: str,
        matrix_path: str,
        cells_path: str,
        alignment_path: str,
        image_path: str
    ) -> Dict[str, Any]:
        """STEPS 1-2: Preprocess dataset when user uploads files.
        
        This runs automatically after upload and prepares the data for ROI selection.
        
        Args:
            slide_id: Unique identifier for this slide/dataset
            matrix_path: Path to cell_feature_matrix.h5
            cells_path: Path to cells.csv (or .csv.gz)
            alignment_path: Path to alignment.csv (3×3 affine matrix)
            image_path: Path to TIFF image
            
        Returns:
            Dictionary with preprocessing results and statistics
        """
        LOGGER.info(f"[{slide_id}] Starting preprocessing pipeline")
        
        try:
            # STEP 1: Load and join expression + metadata
            LOGGER.info(f"[{slide_id}] STEP 1: Loading expression and metadata")
            adata = self._load_expression_matrix(matrix_path)
            cells_df = self._load_cells_metadata(cells_path)
            adata = self._join_expression_and_metadata(adata, cells_df)
            
            # STEP 2: Map coordinates to pixels
            LOGGER.info(f"[{slide_id}] STEP 2: Mapping coordinates to pixel space")
            affine_matrix = self._load_affine(alignment_path)
            adata = self._map_cells_to_pixels(adata, affine_matrix)
            
            # Store image path in uns for later reference
            adata.uns['image_path'] = str(image_path)
            adata.uns['affine_matrix'] = affine_matrix.tolist()
            
            # Save preprocessed h5ad with file locking
            output_path = self.output_dir / f"{slide_id}_processed.h5ad"
            with H5ADFileLock(output_path, mode='w'):
                adata.write_h5ad(output_path)
            
            LOGGER.info(f"[{slide_id}] Preprocessing complete: {output_path}")
            
            # Get image dimensions
            image_shape = self._get_image_shape(image_path)
            
            # Calculate coordinate ranges
            pixel_coords = adata.obs[["x_pixel", "y_pixel"]].values
            
            return {
                'success': True,
                'slide_id': slide_id,
                'h5ad_path': str(output_path),
                'n_cells': int(adata.n_obs),
                'n_features': int(adata.n_vars),
                'image_shape': image_shape,
                'coord_ranges': {
                    'x_pixel': {'min': float(pixel_coords[:, 0].min()), 'max': float(pixel_coords[:, 0].max())},
                    'y_pixel': {'min': float(pixel_coords[:, 1].min()), 'max': float(pixel_coords[:, 1].max())},
                    'x_centroid': {'min': float(adata.obs['x_centroid'].min()), 'max': float(adata.obs['x_centroid'].max())},
                    'y_centroid': {'min': float(adata.obs['y_centroid'].min()), 'max': float(adata.obs['y_centroid'].max())},
                },
                'message': 'Dataset preprocessed successfully'
            }
            
        except Exception as e:
            LOGGER.error(f"[{slide_id}] Preprocessing failed: {str(e)}")
            return {
                'success': False,
                'slide_id': slide_id,
                'error': str(e),
                'message': 'Preprocessing failed'
            }
    
    def add_roi(
        self,
        slide_id: str,
        roi_name: str,
        roi_vertices_pixels: List[List[float]]
    ) -> Dict[str, Any]:
        """STEP 4: Add ROI when user draws polygon in viewer.
        
        This runs automatically when user finishes drawing an ROI.
        
        Args:
            slide_id: Unique identifier for the slide
            roi_name: Name for this ROI (e.g., "roi_1", "tumor_region")
            roi_vertices_pixels: List of [x, y] coordinates in pixel space
            
        Returns:
            Dictionary with ROI statistics and updated h5ad path
        """
        debug_print(f"\n{'='*80}")
        debug_print(f"🔵 [PYTHON ROI] Starting add_roi()")
        debug_print(f"{'='*80}")
        debug_print(f"📋 Parameters:")
        debug_print(f"   - slide_id: {slide_id}")
        debug_print(f"   - roi_name: {roi_name}")
        debug_print(f"   - vertices count: {len(roi_vertices_pixels)}")
        debug_print(f"   - first vertex: {roi_vertices_pixels[0] if roi_vertices_pixels else None}")
        debug_print(f"   - last vertex: {roi_vertices_pixels[-1] if roi_vertices_pixels else None}")
        
        LOGGER.info(f"[{slide_id}] Adding ROI: {roi_name}")
        
        try:
            # Load preprocessed h5ad
            h5ad_path = self.output_dir / f"{slide_id}_processed.h5ad"
            debug_print(f"📂 [PYTHON ROI] Looking for h5ad at: {h5ad_path}")
            
            if not h5ad_path.exists():
                debug_print(f"❌ [PYTHON ROI] h5ad file not found!")
                raise FileNotFoundError(f"Preprocessed h5ad not found. Run preprocess_dataset first.")
            
            debug_print(f"✅ [PYTHON ROI] h5ad file found, loading...")
            adata = self._read_h5ad(h5ad_path)
            debug_print(f"✅ [PYTHON ROI] Loaded AnnData: {adata.n_obs} cells × {adata.n_vars} genes")
            
            # Convert vertices to numpy array
            debug_print(f"🔧 [PYTHON ROI] Converting vertices to numpy array...")
            vertices_array = np.array(roi_vertices_pixels, dtype=float)
            if vertices_array.ndim != 2 or vertices_array.shape[1] != 2:
                raise ValueError("roi_vertices_pixels must be [[x, y], [x, y], ...]")
            debug_print(f"✅ [PYTHON ROI] Vertices shape: {vertices_array.shape}")
            
            # Get affine matrix from uns
            affine_matrix = np.array(adata.uns.get('affine_matrix', None))
            debug_print(f"🔧 [PYTHON ROI] Affine matrix shape: {affine_matrix.shape if affine_matrix is not None else None}")
            
            # Label cells in ROI
            debug_print(f"🎯 [PYTHON ROI] Running point-in-polygon test...")
            adata = self._label_cells_in_roi(adata, vertices_array, roi_name, affine_matrix)
            debug_print(f"✅ [PYTHON ROI] Point-in-polygon test completed")
            
            # Save updated h5ad with file locking
            debug_print(f"💾 [PYTHON ROI] Saving updated h5ad to: {h5ad_path}")
            with H5ADFileLock(h5ad_path, mode='w'):
                adata.write_h5ad(h5ad_path)
            debug_print(f"✅ [PYTHON ROI] h5ad file saved successfully")
            
            # Calculate statistics
            roi_mask = adata.obs[roi_name].values
            n_in_roi = int(roi_mask.sum())
            percentage = 100 * n_in_roi / adata.n_obs
            
            debug_print(f"\n📊 [PYTHON ROI] Statistics:")
            debug_print(f"   - Total cells: {adata.n_obs}")
            debug_print(f"   - Cells in ROI: {n_in_roi}")
            debug_print(f"   - Percentage: {percentage:.2f}%")
            
            # Get list of all ROIs (case-insensitive)
            roi_columns = [col for col in adata.obs.columns if col.lower().startswith('roi_') or col.lower() == 'roi']
            debug_print(f"   - All ROIs in dataset: {roi_columns}")
            
            LOGGER.info(f"[{slide_id}] ROI '{roi_name}' added: {n_in_roi} cells ({percentage:.1f}%)")
            
            result = {
                'success': True,
                'slide_id': slide_id,
                'roi_name': roi_name,
                'n_cells_in_roi': n_in_roi,
                'n_cells_total': int(adata.n_obs),
                'percentage': round(percentage, 2),
                'roi_polygon_pixels': adata.uns[f"{roi_name}_polygon_pixels"],
                'roi_polygon_centroids': adata.uns.get(f"{roi_name}_polygon_centroids", None),
                'all_rois': roi_columns,
                'message': f'ROI {roi_name} added successfully'
            }
            
            debug_print(f"\n✅ [PYTHON ROI] ROI processing completed successfully!")
            debug_print(f"{'='*80}\n")
            
            return result
            
        except Exception as e:
            error_msg = str(e)
            debug_print(f"\n❌ [PYTHON ROI] Error occurred: {error_msg}")
            debug_print(f"{'='*80}\n")
            
            LOGGER.error(f"[{slide_id}] Failed to add ROI '{roi_name}': {error_msg}")
            return {
                'success': False,
                'slide_id': slide_id,
                'roi_name': roi_name,
                'error': error_msg,
                'message': 'Failed to add ROI'
            }
    
    def delete_roi(self, slide_id: str, roi_name: str) -> Dict[str, Any]:
        """Delete ROI column and metadata when user deletes an ROI.
        
        Args:
            slide_id: Unique identifier for the slide
            roi_name: Name of ROI to delete
            
        Returns:
            Dictionary with deletion status
        """
        LOGGER.info(f"[{slide_id}] Deleting ROI: {roi_name}")
        
        try:
            # Load h5ad
            h5ad_path = self.output_dir / f"{slide_id}_processed.h5ad"
            if not h5ad_path.exists():
                raise FileNotFoundError(f"h5ad not found for {slide_id}")
            
            adata = self._read_h5ad(h5ad_path)
            
            # Check if ROI exists
            if roi_name not in adata.obs.columns:
                raise ValueError(f"ROI '{roi_name}' not found in dataset")
            
            # Delete ROI column from obs
            adata.obs = adata.obs.drop(columns=[roi_name])
            
            # Delete ROI metadata from uns
            keys_to_delete = [
                f"{roi_name}_polygon_pixels",
                f"{roi_name}_polygon_centroids"
            ]
            for key in keys_to_delete:
                if key in adata.uns:
                    del adata.uns[key]
            
            # Save updated h5ad with file locking
            with H5ADFileLock(h5ad_path, mode='w'):
                adata.write_h5ad(h5ad_path)
            
            # Get remaining ROIs (case-insensitive)
            roi_columns = [col for col in adata.obs.columns if col.lower().startswith('roi_') or col.lower() == 'roi']
            
            LOGGER.info(f"[{slide_id}] ROI '{roi_name}' deleted")
            
            return {
                'success': True,
                'slide_id': slide_id,
                'roi_name': roi_name,
                'all_rois': roi_columns,
                'message': f'ROI {roi_name} deleted successfully'
            }
            
        except Exception as e:
            LOGGER.error(f"[{slide_id}] Failed to delete ROI '{roi_name}': {str(e)}")
            return {
                'success': False,
                'slide_id': slide_id,
                'roi_name': roi_name,
                'error': str(e),
                'message': 'Failed to delete ROI'
            }
    
    def get_roi_list(self, slide_id: str) -> Dict[str, Any]:
        """Get list of all ROIs for a slide.
        
        Args:
            slide_id: Unique identifier for the slide
            
        Returns:
            Dictionary with list of ROIs and their statistics
        """
        try:
            h5ad_path = self.output_dir / f"{slide_id}_processed.h5ad"
            if not h5ad_path.exists():
                return {
                    'success': False,
                    'slide_id': slide_id,
                    'error': 'Dataset not found',
                    'rois': []
                }
            
            adata = self._read_h5ad(h5ad_path)
            
            # Find all ROI columns (case-insensitive)
            roi_columns = [col for col in adata.obs.columns if col.lower().startswith('roi_') or col.lower() == 'roi']
            
            rois = []
            for roi_name in roi_columns:
                n_cells = int(adata.obs[roi_name].sum())
                percentage = 100 * n_cells / adata.n_obs
                
                # Get polygon data and convert ndarrays to lists for JSON serialization
                polygon_pixels = adata.uns.get(f"{roi_name}_polygon_pixels", None)
                polygon_centroids = adata.uns.get(f"{roi_name}_polygon_centroids", None)
                
                # Convert numpy arrays to lists
                if isinstance(polygon_pixels, np.ndarray):
                    polygon_pixels = polygon_pixels.tolist()
                if isinstance(polygon_centroids, np.ndarray):
                    polygon_centroids = polygon_centroids.tolist()
                
                rois.append({
                    'name': roi_name,
                    'n_cells': n_cells,
                    'percentage': round(percentage, 2),
                    'polygon_pixels': polygon_pixels,
                    'polygon_centroids': polygon_centroids
                })
            
            return {
                'success': True,
                'slide_id': slide_id,
                'n_cells_total': int(adata.n_obs),
                'rois': rois
            }
            
        except Exception as e:
            LOGGER.error(f"[{slide_id}] Failed to get ROI list: {str(e)}")
            return {
                'success': False,
                'slide_id': slide_id,
                'error': str(e),
                'rois': []
            }
    
    def get_h5ad_path(self, slide_id: str) -> Optional[str]:
        """Get path to processed h5ad file for download.
        
        Args:
            slide_id: Unique identifier for the slide
            
        Returns:
            Absolute path to h5ad file, or None if not found
        """
        h5ad_path = self.output_dir / f"{slide_id}_processed.h5ad"
        return str(h5ad_path) if h5ad_path.exists() else None
    
    def get_cell_overlay_data(
        self,
        slide_id: str,
        downsample: int = 1
    ) -> Dict[str, Any]:
        """Get cell positions for visualization overlay on TIFF.
        
        Args:
            slide_id: Unique identifier for the slide
            downsample: Return every Nth cell (1 = all cells)
            
        Returns:
            Dictionary with cell pixel coordinates for frontend visualization
        """
        try:
            h5ad_path = self.output_dir / f"{slide_id}_processed.h5ad"
            if not h5ad_path.exists():
                raise FileNotFoundError(f"Dataset not found for {slide_id}")
            
            adata = self._read_h5ad(h5ad_path)
            pixel_coords = adata.obs[["x_pixel", "y_pixel"]].values
            
            if downsample > 1:
                pixel_coords = pixel_coords[::downsample]
            
            return {
                'success': True,
                'slide_id': slide_id,
                'cells': pixel_coords.tolist(),
                'n_cells': len(pixel_coords),
                'n_cells_total': int(adata.n_obs),
                'downsampled': downsample > 1
            }
            
        except Exception as e:
            LOGGER.error(f"[{slide_id}] Failed to get overlay data: {str(e)}")
            return {
                'success': False,
                'slide_id': slide_id,
                'error': str(e),
                'cells': []
            }
    
    # ========================================================================
    # Internal helper methods (implementation of 4-step pipeline)
    # ========================================================================
    
    def _load_expression_matrix(self, h5_path: str) -> AnnData:
        """Load expression matrix from HDF5 file."""
        with h5py.File(h5_path, "r") as handle:
            matrix_group = handle["matrix"]
            data = matrix_group["data"][()]
            indices = matrix_group["indices"][()]
            indptr = matrix_group["indptr"][()]
            shape = tuple(matrix_group["shape"][()])
            barcodes = matrix_group["barcodes"][()].astype("U")
            feature_names = matrix_group["features"]["name"][()].astype("U")
            feature_ids = matrix_group["features"]["id"][()].astype("U")
            feature_types = matrix_group["features"]["feature_type"][()].astype("U")
        
        matrix_csc = sparse.csc_matrix((data, indices, indptr), shape=shape)
        matrix_csr = matrix_csc.transpose().tocsr()
        
        obs = pd.DataFrame(index=pd.Index(barcodes, name="cell_id"))
        var = pd.DataFrame({
            "feature_id": feature_ids,
            "feature_type": feature_types,
        }, index=pd.Index(feature_names, name="feature_name"))
        
        return AnnData(X=matrix_csr, obs=obs, var=var)
    
    def _load_cells_metadata(self, cells_path: str) -> pd.DataFrame:
        """Load cell metadata from CSV."""
        cells_df = pd.read_csv(cells_path)
        
        # Find cell ID column
        cell_id_column = None
        for candidate in ("cell_id", "CellID", "barcode"):
            if candidate in cells_df.columns:
                cell_id_column = candidate
                break
        if cell_id_column is None:
            raise ValueError("Could not find cell ID column in cells.csv")
        
        cells_df = cells_df.set_index(cell_id_column)
        
        # Find coordinate columns
        x_col, y_col = None, None
        for cand_x, cand_y in (("x_centroid", "y_centroid"), ("x_micron", "y_micron"), ("x", "y")):
            if cand_x in cells_df.columns and cand_y in cells_df.columns:
                x_col, y_col = cand_x, cand_y
                break
        if x_col is None or y_col is None:
            raise ValueError("Could not find coordinate columns in cells.csv")
        
        cells_df = cells_df.rename(columns={x_col: "x_centroid", y_col: "y_centroid"})
        return cells_df
    
    def _join_expression_and_metadata(self, adata: AnnData, cells_df: pd.DataFrame) -> AnnData:
        """Join expression and metadata."""
        missing = set(adata.obs_names) - set(cells_df.index)
        if missing:
            raise ValueError(f"Cells metadata missing {len(missing)} barcodes")
        
        cells_df = cells_df.loc[adata.obs_names]
        adata.obs = adata.obs.join(cells_df)
        return adata
    
    def _load_affine(self, affine_path: str) -> np.ndarray:
        """Load affine transformation matrix."""
        affine_df = pd.read_csv(affine_path, header=None)
        affine_df = affine_df.replace({"%": ""}, regex=True)
        affine_matrix = affine_df.astype(float).values
        if affine_matrix.shape != (3, 3):
            raise ValueError(f"Expected 3×3 affine matrix, got {affine_matrix.shape}")
        return affine_matrix
    
    def _apply_affine(self, points: np.ndarray, affine_matrix: np.ndarray) -> np.ndarray:
        """Apply affine transformation to points."""
        if points.ndim != 2 or points.shape[1] != 2:
            raise ValueError("points must be shape (N, 2)")
        ones = np.ones((points.shape[0], 1), dtype=float)
        homogeneous = np.hstack([points, ones])
        transformed = homogeneous @ affine_matrix.T
        return transformed[:, :2]
    
    def _map_cells_to_pixels(self, adata: AnnData, affine_matrix: np.ndarray) -> AnnData:
        """Map cell coordinates to pixel space."""
        centroid_coords = adata.obs[["x_centroid", "y_centroid"]].to_numpy(float)
        
        # DEBUG: Log coordinate transformation
        debug_print(f"\n🔍 [PREPROCESS DEBUG] Coordinate Transformation:")
        debug_print(f"   Original cell coordinates (x_centroid, y_centroid in microns):")
        debug_print(f"      - x range: [{centroid_coords[:, 0].min():.2f}, {centroid_coords[:, 0].max():.2f}]")
        debug_print(f"      - y range: [{centroid_coords[:, 1].min():.2f}, {centroid_coords[:, 1].max():.2f}]")
        debug_print(f"      - Sample cells (first 5):")
        for i in range(min(5, len(centroid_coords))):
            debug_print(f"         Cell {i}: ({centroid_coords[i, 0]:.2f}, {centroid_coords[i, 1]:.2f}) microns")
        
        pixel_coords = self._apply_affine(centroid_coords, affine_matrix)
        
        debug_print(f"   After affine transformation (x_pixel, y_pixel):")
        debug_print(f"      - x range: [{pixel_coords[:, 0].min():.2f}, {pixel_coords[:, 0].max():.2f}]")
        debug_print(f"      - y range: [{pixel_coords[:, 1].min():.2f}, {pixel_coords[:, 1].max():.2f}]")
        debug_print(f"      - Sample cells (first 5):")
        for i in range(min(5, len(pixel_coords))):
            debug_print(f"         Cell {i}: ({pixel_coords[i, 0]:.2f}, {pixel_coords[i, 1]:.2f}) pixels")
        debug_print(f"   Affine matrix used:")
        debug_print(f"      {affine_matrix}")
        
        adata.obs[["x_pixel", "y_pixel"]] = pixel_coords
        return adata
    
    def _label_cells_in_roi(
        self,
        adata: AnnData,
        roi_vertices_pixels: np.ndarray,
        roi_column: str,
        affine_matrix: Optional[np.ndarray]
    ) -> AnnData:
        """Label cells within ROI polygon."""
        pixel_coords = adata.obs[["x_pixel", "y_pixel"]].to_numpy(float)
        
        # DEBUG: Log coordinate ranges
        debug_print(f"\n🔍 [PYTHON ROI DEBUG] Coordinate Analysis:")
        debug_print(f"   Cell coordinates (x_pixel, y_pixel):")
        debug_print(f"      - x range: [{pixel_coords[:, 0].min():.2f}, {pixel_coords[:, 0].max():.2f}]")
        debug_print(f"      - y range: [{pixel_coords[:, 1].min():.2f}, {pixel_coords[:, 1].max():.2f}]")
        debug_print(f"      - Sample cells (first 5):")
        for i in range(min(5, len(pixel_coords))):
            debug_print(f"         Cell {i}: ({pixel_coords[i, 0]:.2f}, {pixel_coords[i, 1]:.2f})")
        
        debug_print(f"   ROI polygon vertices:")
        debug_print(f"      - x range: [{roi_vertices_pixels[:, 0].min():.2f}, {roi_vertices_pixels[:, 0].max():.2f}]")
        debug_print(f"      - y range: [{roi_vertices_pixels[:, 1].min():.2f}, {roi_vertices_pixels[:, 1].max():.2f}]")
        debug_print(f"      - Vertices:")
        for i, vertex in enumerate(roi_vertices_pixels):
            debug_print(f"         Vertex {i}: ({vertex[0]:.2f}, {vertex[1]:.2f})")
        
        debug_print(f"   Affine matrix:")
        debug_print(f"      {affine_matrix}")
        
        roi_path = MplPath(roi_vertices_pixels)
        mask = roi_path.contains_points(pixel_coords)
        
        debug_print(f"\n   Point-in-polygon result:")
        debug_print(f"      - Cells tested: {len(mask)}")
        debug_print(f"      - Cells inside ROI: {mask.sum()}")
        debug_print(f"      - Percentage: {100 * mask.sum() / len(mask):.2f}%")
        
        adata.obs[roi_column] = mask
        adata.uns[f"{roi_column}_polygon_pixels"] = roi_vertices_pixels.tolist()
        
        if affine_matrix is not None:
            inv_affine = np.linalg.inv(affine_matrix)
            centroid_vertices = self._apply_affine(roi_vertices_pixels, inv_affine)
            adata.uns[f"{roi_column}_polygon_centroids"] = centroid_vertices.tolist()
        
        return adata
    
    def _read_h5ad(self, h5ad_path: Path) -> AnnData:
        """Read h5ad file with file locking."""
        import scanpy as sc
        with H5ADFileLock(h5ad_path, mode='r'):
            return sc.read_h5ad(h5ad_path)
    
    def _get_image_shape(self, image_path: str) -> Tuple[int, int]:
        """Get image dimensions."""
        with tifffile.TiffFile(image_path) as tif:
            series = tif.series[0]
            image = series.asarray(level=0)
            if image.ndim == 3 and image.shape[0] in (3, 4):
                return (image.shape[2], image.shape[1])  # width, height
            return (image.shape[1], image.shape[0])  # width, height


# ============================================================================
# Flask/Express API Helper
# ============================================================================

def create_flask_api(upload_dir: str, output_dir: str):
    """Create Flask API endpoints for Xenium processing.
    
    Usage in your Flask app:
        from xenium_processor import create_flask_api
        create_flask_api('/uploads', '/data/processed')
    """
    from flask import request, jsonify, send_file
    
    processor = XeniumProcessor(upload_dir, output_dir)
    
    def preprocess_endpoint():
        """POST /api/xenium/preprocess"""
        data = request.json
        result = processor.preprocess_dataset(
            slide_id=data['slide_id'],
            matrix_path=data['matrix_path'],
            cells_path=data['cells_path'],
            alignment_path=data['alignment_path'],
            image_path=data['image_path']
        )
        return jsonify(result)
    
    def add_roi_endpoint():
        """POST /api/xenium/roi"""
        data = request.json
        result = processor.add_roi(
            slide_id=data['slide_id'],
            roi_name=data['roi_name'],
            roi_vertices_pixels=data['roi_vertices']
        )
        return jsonify(result)
    
    def delete_roi_endpoint():
        """DELETE /api/xenium/roi"""
        data = request.json
        result = processor.delete_roi(
            slide_id=data['slide_id'],
            roi_name=data['roi_name']
        )
        return jsonify(result)
    
    def get_rois_endpoint(slide_id: str):
        """GET /api/xenium/rois/<slide_id>"""
        result = processor.get_roi_list(slide_id)
        return jsonify(result)
    
    def download_endpoint(slide_id: str):
        """GET /api/xenium/download/<slide_id>"""
        h5ad_path = processor.get_h5ad_path(slide_id)
        if h5ad_path:
            return send_file(h5ad_path, as_attachment=True, download_name=f"{slide_id}_with_rois.h5ad")
        return jsonify({'error': 'File not found'}), 404
    
    def overlay_endpoint(slide_id: str):
        """GET /api/xenium/overlay/<slide_id>?downsample=10"""
        downsample = request.args.get('downsample', 1, type=int)
        result = processor.get_cell_overlay_data(slide_id, downsample)
        return jsonify(result)
    
    return {
        'preprocess': preprocess_endpoint,
        'add_roi': add_roi_endpoint,
        'delete_roi': delete_roi_endpoint,
        'get_rois': get_rois_endpoint,
        'download': download_endpoint,
        'overlay': overlay_endpoint
    }
