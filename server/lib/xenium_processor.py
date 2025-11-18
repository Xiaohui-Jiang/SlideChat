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
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
import shutil

import h5py
import numpy as np
import pandas as pd
import tifffile
from anndata import AnnData
from scipy import sparse
from matplotlib.path import Path as MplPath

logging.basicConfig(level=logging.INFO)
LOGGER = logging.getLogger(__name__)


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
            
            # Save preprocessed h5ad
            output_path = self.output_dir / f"{slide_id}_processed.h5ad"
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
        LOGGER.info(f"[{slide_id}] Adding ROI: {roi_name}")
        
        try:
            # Load preprocessed h5ad
            h5ad_path = self.output_dir / f"{slide_id}_processed.h5ad"
            if not h5ad_path.exists():
                raise FileNotFoundError(f"Preprocessed h5ad not found. Run preprocess_dataset first.")
            
            adata = self._read_h5ad(h5ad_path)
            
            # Convert vertices to numpy array
            vertices_array = np.array(roi_vertices_pixels, dtype=float)
            if vertices_array.ndim != 2 or vertices_array.shape[1] != 2:
                raise ValueError("roi_vertices_pixels must be [[x, y], [x, y], ...]")
            
            # Get affine matrix from uns
            affine_matrix = np.array(adata.uns.get('affine_matrix', None))
            
            # Label cells in ROI
            adata = self._label_cells_in_roi(adata, vertices_array, roi_name, affine_matrix)
            
            # Save updated h5ad
            adata.write_h5ad(h5ad_path)
            
            # Calculate statistics
            roi_mask = adata.obs[roi_name].values
            n_in_roi = int(roi_mask.sum())
            percentage = 100 * n_in_roi / adata.n_obs
            
            # Get list of all ROIs
            roi_columns = [col for col in adata.obs.columns if col.startswith('roi_') or col == 'roi']
            
            LOGGER.info(f"[{slide_id}] ROI '{roi_name}' added: {n_in_roi} cells ({percentage:.1f}%)")
            
            return {
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
            
        except Exception as e:
            LOGGER.error(f"[{slide_id}] Failed to add ROI '{roi_name}': {str(e)}")
            return {
                'success': False,
                'slide_id': slide_id,
                'roi_name': roi_name,
                'error': str(e),
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
            
            # Save updated h5ad
            adata.write_h5ad(h5ad_path)
            
            # Get remaining ROIs
            roi_columns = [col for col in adata.obs.columns if col.startswith('roi_') or col == 'roi']
            
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
            
            # Find all ROI columns
            roi_columns = [col for col in adata.obs.columns if col.startswith('roi_') or col == 'roi']
            
            rois = []
            for roi_name in roi_columns:
                n_cells = int(adata.obs[roi_name].sum())
                percentage = 100 * n_cells / adata.n_obs
                
                rois.append({
                    'name': roi_name,
                    'n_cells': n_cells,
                    'percentage': round(percentage, 2),
                    'polygon_pixels': adata.uns.get(f"{roi_name}_polygon_pixels", None),
                    'polygon_centroids': adata.uns.get(f"{roi_name}_polygon_centroids", None)
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
        pixel_coords = self._apply_affine(centroid_coords, affine_matrix)
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
        roi_path = MplPath(roi_vertices_pixels)
        mask = roi_path.contains_points(pixel_coords)
        
        adata.obs[roi_column] = mask
        adata.uns[f"{roi_column}_polygon_pixels"] = roi_vertices_pixels.tolist()
        
        if affine_matrix is not None:
            inv_affine = np.linalg.inv(affine_matrix)
            centroid_vertices = self._apply_affine(roi_vertices_pixels, inv_affine)
            adata.uns[f"{roi_column}_polygon_centroids"] = centroid_vertices.tolist()
        
        return adata
    
    def _read_h5ad(self, h5ad_path: Path) -> AnnData:
        """Read h5ad file."""
        import scanpy as sc
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
