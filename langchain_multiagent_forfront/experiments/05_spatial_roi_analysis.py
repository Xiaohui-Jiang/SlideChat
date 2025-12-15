import sys
import os
import scanpy as sc
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from pathlib import Path

def main():
    # Load Lung5_Rep1.h5ad
    spatial_dir = Path("/Users/xiaohui/Downloads/spatial")
    data_file = spatial_dir / "Lung5_Rep1.h5ad"
    
    print(f"Loading {data_file.name}...")
    adata = sc.read_h5ad(data_file)
    
    print(f"\nDataset: {adata.n_obs} cells × {adata.n_vars} genes")
    
    # Get global spatial coordinates
    coords = adata.obsm['spatial_global']
    x_coords = coords[:, 0]
    y_coords = coords[:, 1]
    
    # Calculate coordinate ranges
    x_min, x_max = x_coords.min(), x_coords.max()
    y_min, y_max = y_coords.min(), y_coords.max()
    x_range = x_max - x_min
    y_range = y_max - y_min
    
    # Define two rectangular ROIs
    # ROI_1: Upper-left quadrant (box 1)
    roi1_x_min = x_min + 0.1 * x_range
    roi1_x_max = x_min + 0.4 * x_range
    roi1_y_min = y_min + 0.6 * y_range
    roi1_y_max = y_min + 0.9 * y_range
    
    # ROI_2: Lower-right quadrant (box 2)
    roi2_x_min = x_min + 0.6 * x_range
    roi2_x_max = x_min + 0.9 * x_range
    roi2_y_min = y_min + 0.1 * y_range
    roi2_y_max = y_min + 0.4 * y_range
    
    # Assign cells to ROIs (cells outside boxes remain unassigned)
    roi_labels = np.full(len(x_coords), np.nan, dtype=object)
    
    # ROI_1 mask
    roi1_mask = (
        (x_coords >= roi1_x_min) & (x_coords <= roi1_x_max) &
        (y_coords >= roi1_y_min) & (y_coords <= roi1_y_max)
    )
    roi_labels[roi1_mask] = 'ROI_1'
    
    # ROI_2 mask
    roi2_mask = (
        (x_coords >= roi2_x_min) & (x_coords <= roi2_x_max) &
        (y_coords >= roi2_y_min) & (y_coords <= roi2_y_max)
    )
    roi_labels[roi2_mask] = 'ROI_2'
    
    # Store ROI assignments
    adata.obs['roi'] = pd.Categorical(roi_labels, categories=['ROI_1', 'ROI_2'])
    
    # Also add 'spatial' key for compatibility with spatial domain tools
    adata.obsm['spatial'] = adata.obsm['spatial_global'].copy()
    
    n_roi1 = roi1_mask.sum()
    n_roi2 = roi2_mask.sum()
    n_unassigned = (~roi1_mask & ~roi2_mask).sum()
    
    print(f"\nROI assignment:")
    print(f"  ROI_1: {n_roi1} cells (upper-left box)")
    print(f"  ROI_2: {n_roi2} cells (lower-right box)")
    print(f"  Unassigned: {n_unassigned} cells (outside ROIs)")
    
    # Create visualization
    output_dir = Path(__file__).parent / 'results'
    output_dir.mkdir(exist_ok=True)
    
    fig, ax = plt.subplots(figsize=(14, 12))
    
    # Plot unassigned cells first (background)
    unassigned_mask = ~roi1_mask & ~roi2_mask
    ax.scatter(x_coords[unassigned_mask], y_coords[unassigned_mask], 
               c='lightgray', s=0.5, alpha=0.3, label='Unassigned', rasterized=True)
    
    # Plot ROI cells on top
    ax.scatter(x_coords[roi1_mask], y_coords[roi1_mask], 
               c='#E74C3C', s=2, alpha=0.7, label='ROI_1 (Upper-Left)', rasterized=True)
    ax.scatter(x_coords[roi2_mask], y_coords[roi2_mask], 
               c='#3498DB', s=2, alpha=0.7, label='ROI_2 (Lower-Right)', rasterized=True)
    
    # Draw ROI boundary boxes
    from matplotlib.patches import Rectangle
    
    # ROI_1 box
    roi1_rect = Rectangle((roi1_x_min, roi1_y_min), 
                           roi1_x_max - roi1_x_min, 
                           roi1_y_max - roi1_y_min,
                           linewidth=3, edgecolor='#E74C3C', facecolor='none', 
                           linestyle='--', label='ROI_1 Boundary')
    ax.add_patch(roi1_rect)
    
    # ROI_2 box
    roi2_rect = Rectangle((roi2_x_min, roi2_y_min), 
                           roi2_x_max - roi2_x_min, 
                           roi2_y_max - roi2_y_min,
                           linewidth=3, edgecolor='#3498DB', facecolor='none', 
                           linestyle='--', label='ROI_2 Boundary')
    ax.add_patch(roi2_rect)
    
    ax.set_xlabel('X coordinate (global)', fontsize=12)
    ax.set_ylabel('Y coordinate (global)', fontsize=12)
    ax.set_title(f'Spatial ROI Assignment - {data_file.stem}\n'
                 f'ROI_1: {n_roi1} cells | ROI_2: {n_roi2} cells | Unassigned: {n_unassigned} cells', 
                 fontsize=14, fontweight='bold')
    ax.legend(loc='upper right', fontsize=10, markerscale=3)
    ax.set_aspect('equal')
    ax.grid(True, alpha=0.2)
    
    plt.tight_layout()
    plot_path = output_dir / f'{data_file.stem}_roi_visualization.png'
    plt.savefig(plot_path, dpi=300, bbox_inches='tight')
    print(f"\nROI visualization saved to: {plot_path}")
    plt.close()
    
    # Save the annotated data
    output_data_path = spatial_dir / f"{data_file.stem}_with_roi.h5ad"
    adata.write_h5ad(output_data_path)
    print(f"Annotated data saved to: {output_data_path}")

if __name__ == "__main__":
    main()
