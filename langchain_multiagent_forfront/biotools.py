"""
Core bioinformatics tools for data analysis pipeline.
Each tool is designed to return structured results.
"""

from typing import Dict, List, Any, Optional, Tuple, Union, Type, Sequence, Literal
from pathlib import Path
import json
import os
import re
import warnings
from langchain_core.messages import BaseMessage, SystemMessage, HumanMessage, AIMessage
from langchain_core.runnables import Runnable, RunnableConfig
from pydantic.v1 import BaseModel, Field, create_model
from langchain_openai import ChatOpenAI

import matplotlib.pyplot as plt

import scanpy as sc
import squidpy as sq
import numpy as np
import pandas as pd
from scipy import sparse
import logging
import traceback

LOG_FORMAT = (
    "%(asctime)s - %(name)s - %(levelname)s - %(pathname)s:%(lineno)d - %(message)s"
)
_ENV_LOG_LEVEL = os.getenv("BIOAGENT_LOG_LEVEL", "WARNING").upper()
LOG_LEVEL = getattr(logging, _ENV_LOG_LEVEL, logging.WARNING)

root_logger = logging.getLogger()
if not root_logger.handlers:
    logging.basicConfig(level=LOG_LEVEL, format=LOG_FORMAT)

logger = logging.getLogger(__name__)
logger.setLevel(LOG_LEVEL)

warnings.filterwarnings(
    "ignore",
    message="The legacy Dask DataFrame implementation is deprecated",
    category=FutureWarning,
)
warnings.filterwarnings(
    "ignore",
    message="pkg_resources is deprecated as an API",
    category=UserWarning,
)
warnings.filterwarnings(
    "ignore",
    message="Importing read_text from `anndata` is deprecated",
    category=FutureWarning,
)

from .prompts import LLM_PROMPTS, LLM_SYSTEM_MESSAGES
from .report_utils import save_figure


def _build_output_path(
    source: Union[str, Path],
    tool_name: str,
    descriptor: Optional[str],
    extension: str,
    output_dir: Optional[Union[str, Path]] = None,
) -> str:
    """Construct an output path colocated with source or a custom directory."""
    base_path = Path(source)
    stem = base_path.stem
    suffix = extension if extension.startswith(".") else f".{extension}"
    descriptor_part = f"_{descriptor}" if descriptor else ""
    filename = f"{stem}_after_{tool_name}{descriptor_part}{suffix}"

    target_dir = Path(output_dir) if output_dir else base_path.parent
    target_dir.mkdir(parents=True, exist_ok=True)
    return str(target_dir / filename)


def _persist_adata(adata, source: Union[str, Path], output_dir: Optional[Union[str, Path]] = None) -> str:
    source_path = Path(source)
    suffix = source_path.suffix or ".h5ad"
    target_dir = Path(output_dir) if output_dir else source_path.parent
    target_dir.mkdir(parents=True, exist_ok=True)
    stem = source_path.stem
    if stem.endswith("_agent"):
        output_stem = stem
    else:
        output_stem = f"{stem}_agent"
    destination = target_dir / f"{output_stem}{suffix}"
    adata.write(destination)
    return str(destination)

class BioToolBase(Runnable):
    """Base class for all bio analysis tools implementing the Runnable interface."""
    
    name: str
    description: str
    input_schema: Type[BaseModel]
    
    def __init__(self) -> None:
        """Initialize the tool."""
        super().__init__()

    def parse_input(self, input_data: Union[Dict[str, Any], str, BaseMessage]) -> Dict[str, Any]:
        """Parse and validate input from various formats."""
        try:
            # Handle message types
            if isinstance(input_data, BaseMessage):
                content = input_data.content
                if isinstance(content, str):
                    try:
                        # Try parsing as JSON
                        params = json.loads(content)
                    except json.JSONDecodeError:
                        # If not JSON, use as raw input
                        params = {"input": content}
                else:
                    # Content is already a dict or other structure
                    params = content
            # Handle string input
            elif isinstance(input_data, str):
                try:
                    params = json.loads(input_data)
                except json.JSONDecodeError:
                    params = {"input": input_data}
            # Handle dict/other input types
            else:
                params = input_data

            # Validate against schema
            return self.input_schema(**params).dict()

        except Exception as e:
            logger.error(f"Error parsing input in {self.name}: {str(e)}")
            logger.error(f"Input data: {input_data}")
            logger.error(f"Traceback: {traceback.format_exc()}")
            raise ValueError(f"Invalid input format for {self.name}: {str(e)}")

    def invoke(self, input: Any, config: Optional[RunnableConfig] = None) -> Any:
        """Execute the tool and return results."""
        try:
            # Parse and validate input
            parsed_input = self.parse_input(input)
            
            # Execute tool-specific logic
            return self._run(parsed_input)
            
        except ValueError as e:
            error_result = {
                "error": "validation_error",
                "message": str(e),
                "status": "failed",
                "traceback": traceback.format_exc()
            }
        except Exception as e:
            error_result = {
                "error": str(e),
                "status": "failed",
                "traceback": traceback.format_exc()
            }

        logger.error(
            f"Error in {self.name}: {error_result['message'] if 'message' in error_result else error_result['error']}"
        )
        logger.error(error_result["traceback"])
        return error_result

    def _run(self, parsed_input: Dict[str, Any]) -> Dict[str, Any]:
        """Tool-specific execution logic to be implemented by subclasses."""
        raise NotImplementedError(
            f"Tool {self.name} must implement _run method"
        )
        
    def batch(self, inputs: List[Any], config: Optional[RunnableConfig] = None) -> List[Any]:
        """Process multiple inputs in batch."""
        # Default implementation processes sequentially
        # Subclasses can override for true batch processing
        return [self.invoke(input, config) for input in inputs]
    
    def stream(self, input: Any, config: Optional[RunnableConfig] = None) -> Any:
        """Stream results if supported."""
        # Default implementation returns full results
        # Subclasses can override for true streaming
        yield self.invoke(input, config)

# Initialize schema classes
# ---------------------------------------------------------------------------
# Preprocess Pipeline Tool
# ---------------------------------------------------------------------------


class PreprocessPipelineInput(BaseModel):
    """Input schema for the preprocessing pipeline that combines QC and embedding."""

    adata_id: str = Field(description="Data object handle")
    min_cells: int = Field(gt=0, description="Minimum cells per gene (must be > 0)")
    min_genes: int = Field(gt=0, description="Minimum genes per cell (must be > 0)")
    max_pct_mito: float = Field(ge=0, le=100, description="Maximum percent mitochondrial (0-100)")
    method: str = Field(default="umap", description="Embedding method (UMAP/tSNE)")
    color_by: Optional[str] = Field(
        default="leiden",
        description="Observation key used for downstream coloring; defaults to Leiden clusters",
    )
    output_dir: Optional[str] = Field(
        default=None,
        description="Directory for generated artifacts and updated AnnData",
    )


class PreprocessPipelineTool(BioToolBase):
    name = "preprocess_pipeline"
    description = "Run QC filtering and embedding pipeline"
    input_schema = PreprocessPipelineInput

# ---------------------------------------------------------------------------
# Batch Correction Tool
# ---------------------------------------------------------------------------


class BatchCorrectionInput(BaseModel):
    """Input schema for batch correction."""

    adata_id: str = Field(description="Data object handle")
    batch_key: str = Field(description="Observation column containing batch labels")
    method: str = Field(
        default="combat",
        description="Batch correction method (currently supports 'combat')",
    )
    compute_embedding: bool = Field(
        default=True,
        description="Recompute PCA/neighbors/UMAP after correction",
    )
    n_pcs: int = Field(
        default=30,
        description="Number of principal components to compute when embedding",
        gt=1,
    )
    output_dir: Optional[str] = Field(
        default=None,
        description="Directory for generated artifacts and corrected AnnData",
    )


class BatchCorrectionTool(BioToolBase):
    name = "batch_correction"
    description = "Correct batch effects and optionally recompute embeddings"
    input_schema = BatchCorrectionInput

# ---------------------------------------------------------------------------
# Spatial Gene Plot Tool
# ---------------------------------------------------------------------------


class SpatialGenePlotInput(BaseModel):
    """Input schema for spatial gene expression plotting."""

    adata_id: str = Field(description="Data object handle")
    genes: Union[str, List[str]] = Field(
        description="Gene symbols to plot (comma-separated string or list)"
    )
    obsm_key: Optional[str] = Field(
        default="spatial",
        description="obsm key containing x,y coordinates",
    )
    point_size: Optional[float] = Field(
        default=5.0,
        description="Scatter point size",
        gt=0,
    )
    output_dir: Optional[str] = Field(
        default=None,
        description="Directory for generated plots",
    )


class SpatialGenePlotTool(BioToolBase):
    name = "spatial_gene_plot"
    description = "Plot selected gene expression on spatial coordinates"
    input_schema = SpatialGenePlotInput

class UMAPGenePlotInput(BaseModel):
    """Input schema for UMAP gene expression plotting."""

    adata_id: str = Field(description="Data object handle")
    genes: Union[str, List[str]] = Field(
        description="Gene symbols to plot (comma-separated string or list)"
    )
    obsm_key: Optional[str] = Field(
        default="X_umap",
        description="obsm key containing UMAP coordinates",
    )
    point_size: Optional[float] = Field(
        default=5.0,
        description="Scatter point size",
        gt=0,
    )
    output_dir: Optional[str] = Field(
        default=None,
        description="Directory for generated plots",
    )


class UMAPGenePlotTool(BioToolBase):
    name = "umap_gene_plot"
    description = "Plot selected gene expression on UMAP coordinates"
    input_schema = UMAPGenePlotInput

class PseudotimeInput(BaseModel):
    """Input schema for diffusion pseudotime analysis."""

    adata_id: str = Field(description="Data object handle")
    root_cell: Optional[str] = Field(
        default=None,
        description="Root cell identifier (obs name). Leave blank to auto-pick.",
    )
    root_label: Optional[str] = Field(
        default=None,
        description="Root label value in the label_key column.",
    )
    label_key: Optional[str] = Field(
        default="leiden",
        description="Observation column used to pick root_label.",
    )
    neighbors_key: Optional[str] = Field(
        default=None,
        description="Neighbors key to use (defaults to AnnData.uns['neighbors']).",
    )
    output_dir: Optional[str] = Field(
        default=None,
        description="Directory for generated artifacts",
    )


class PseudotimeTool(BioToolBase):
    name = "pseudotime"
    description = "Compute diffusion pseudotime and visualize on UMAP"
    input_schema = PseudotimeInput

class CellCommunicationInput(BaseModel):
    """Input schema for cell-cell communication inference."""

    adata_id: str = Field(description="Data object handle")
    group_key: str = Field(
        default="leiden",
        description="Observation column defining sender/receiver groups",
    )
    n_top_pairs: int = Field(
        default=20,
        gt=0,
        description="Number of top ligand-receptor pairs to report",
    )
    min_expr: Optional[float] = Field(
        default=0.05,
        description="Minimum mean expression to keep ligand/receptor",
        ge=0.0,
    )
    output_dir: Optional[str] = Field(
        default=None,
        description="Directory for generated tables/plots",
    )


class CellCommunicationTool(BioToolBase):
    name = "cell_communication"
    description = "Infer ligand-receptor interactions across clusters"
    input_schema = CellCommunicationInput


def _run_batch_correction(self, params: Dict[str, Any]) -> Dict[str, Any]:
    """Perform batch correction using Scanpy's Combat and optional embedding."""
    try:
        input_path = Path(params["adata_id"])
        file_path = str(input_path)
        if file_path.endswith(".h5ad"):
            adata = sc.read_h5ad(file_path)
        elif file_path.endswith(".h5"):
            adata = sc.read_10x_h5(file_path)
        else:
            raise ValueError(f"Unsupported file format: {file_path}")

        batch_key = params["batch_key"]
        if batch_key not in adata.obs.columns:
            raise ValueError(f"Column '{batch_key}' not found in adata.obs")

        method = (params.get("method") or "combat").lower()
        if method != "combat":
            raise ValueError(f"Unsupported batch correction method: {method}")

        adata = adata.copy()
        if not adata.var_names.is_unique:
            adata.var_names_make_unique()

        sc.pp.combat(adata, key=batch_key)

        compute_embedding = bool(params.get("compute_embedding", True))
        embedding_plot = None
        embedding_coords = None

        if compute_embedding:
            n_pcs = int(params.get("n_pcs") or 30)
            n_pcs = max(2, min(n_pcs, max(adata.n_vars - 1, 2)))
            sc.pp.pca(adata, n_comps=n_pcs)
            sc.pp.neighbors(adata)
            sc.tl.umap(adata)

            embedding_coords = _build_output_path(
                input_path,
                self.name,
                "umap_coords",
                ".csv",
                output_dir=params.get("output_dir"),
            )
            pd.DataFrame(adata.obsm["X_umap"], columns=["umap1", "umap2"]).to_csv(
                embedding_coords, index=False
            )

            embedding_plot = _build_output_path(
                input_path,
                self.name,
                "umap_batches",
                ".png",
                output_dir=params.get("output_dir"),
            )
            fig, ax = plt.subplots(figsize=(6, 5))
            batches = adata.obs[batch_key].astype(str)
            unique_batches = sorted(batches.unique())
            cmap = plt.colormaps.get_cmap("tab20")
            colors = cmap(np.linspace(0, 1, max(len(unique_batches), 1)))
            for idx, label in enumerate(unique_batches):
                mask = batches == label
                coords = adata.obsm["X_umap"]
                ax.scatter(
                    coords[mask, 0],
                    coords[mask, 1],
                    s=4,
                    color=colors[idx],
                    edgecolors="none",
                    alpha=0.9,
                    label=str(label),
                )
            ax.set_xlabel("UMAP 1")
            ax.set_ylabel("UMAP 2")
            ax.set_title("UMAP coloured by batch")
            if unique_batches:
                ax.legend(
                    loc="center left",
                    bbox_to_anchor=(1.02, 0.5),
                    frameon=False,
                    fontsize=8,
                )
                fig.subplots_adjust(right=0.78)
            save_figure(fig, embedding_plot, tight_layout=False)

        batches = adata.obs[batch_key].astype(str)
        batch_counts = batches.value_counts().sort_index().to_dict()
        output_file = _persist_adata(adata, input_path, output_dir=params.get("output_dir"))

        summary_text = (
            f"Batch correction ({method}) applied on column '{batch_key}' across {len(batch_counts)} batches. "
            f"Corrected AnnData saved to {output_file}."
        )
        if compute_embedding:
            summary_text += " Recomputed PCA/neighbors/UMAP and exported coordinates and batch-coloured plot."

        result: Dict[str, Any] = {
            "output_data": output_file,
            "batch_key": batch_key,
            "batches": {str(k): int(v) for k, v in batch_counts.items()},
            "method": method,
            "summary_text": summary_text,
        }
        if embedding_plot:
            result["plots"] = {"umap_batches": embedding_plot}
        if embedding_coords:
            result["embedding_coords"] = embedding_coords

        return result

    except Exception as e:
        raise RuntimeError(f"Batch correction failed: {str(e)}")


# ---------------------------------------------------------------------------
# Spatial Gene Plot Tool implementation
# ---------------------------------------------------------------------------


def _run_spatial_gene_plot(self, params: Dict[str, Any]) -> Dict[str, Any]:
    """Plot selected genes on 2D spatial coordinates."""
    try:
        input_path = Path(params["adata_id"])
        file_path = str(input_path)
        if file_path.endswith(".h5ad"):
            adata = sc.read_h5ad(file_path)
        elif file_path.endswith(".h5"):
            adata = sc.read_10x_h5(file_path)
        else:
            raise ValueError(f"Unsupported file format: {file_path}")

        obsm_key = (params.get("obsm_key") or "spatial").strip()
        if obsm_key not in adata.obsm:
            raise ValueError(f"obsm key '{obsm_key}' not found in AnnData")
        coords = adata.obsm[obsm_key]
        if coords is None or coords.shape[1] < 2:
            raise ValueError(f"obsm['{obsm_key}'] must have at least two columns for x,y coordinates")

        raw_genes = params["genes"]
        if isinstance(raw_genes, str):
            gene_list = [g.strip() for g in raw_genes.replace(";", ",").split(",") if g.strip()]
        else:
            gene_list = [str(g).strip() for g in raw_genes if str(g).strip()]
        if not gene_list:
            raise ValueError("No gene symbols provided for plotting.")

        point_size = float(params.get("point_size") or 5.0)
        output_dir = params.get("output_dir")

        available = set(map(str, adata.var_names))
        valid_genes = [g for g in gene_list if g in available]
        missing = [g for g in gene_list if g not in available]
        if not valid_genes:
            raise ValueError("None of the requested genes are present in the dataset.")

        plots: Dict[str, str] = {}
        for gene in valid_genes:
            try:
                expr = adata[:, gene].X
                if sparse.issparse(expr):
                    expr = expr.toarray()
                expr = np.asarray(expr).ravel()
            except Exception:
                logger.debug("Failed to extract expression for gene %s", gene)
                continue

            plot_path = _build_output_path(
                input_path,
                self.name,
                f"{gene}_spatial",
                ".png",
                output_dir=output_dir,
            )
            fig, ax = plt.subplots(figsize=(5.5, 5))
            sc_plt = ax.scatter(
                coords[:, 0],
                coords[:, 1],
                c=expr,
                cmap="viridis",
                s=point_size,
                edgecolors="none",
                alpha=0.9,
            )
            ax.set_title(f"{gene} expression")
            ax.set_xlabel("x")
            ax.set_ylabel("y")
            cbar = fig.colorbar(sc_plt, ax=ax, fraction=0.046, pad=0.04)
            cbar.set_label("Expression")
            save_figure(fig, plot_path, tight_layout=False)
            plots[gene] = plot_path

        summary_parts = [
            f"Plotted {len(plots)}/{len(gene_list)} genes on obsm '{obsm_key}'."
        ]
        if missing:
            summary_parts.append(f"Missing genes: {', '.join(missing)}")
        summary_text = " ".join(summary_parts)

        result: Dict[str, Any] = {
            "plots": plots,
            "genes_plotted": valid_genes,
            "missing_genes": missing,
            "obsm_key": obsm_key,
            "summary_text": summary_text,
        }
        return result

    except Exception as e:
        raise RuntimeError(f"Spatial gene plotting failed: {str(e)}")


def _run_umap_gene_plot(self, params: Dict[str, Any]) -> Dict[str, Any]:
    """Plot selected genes on UMAP coordinates."""
    try:
        input_path = Path(params["adata_id"])
        file_path = str(input_path)
        if file_path.endswith(".h5ad"):
            adata = sc.read_h5ad(file_path)
        elif file_path.endswith(".h5"):
            adata = sc.read_10x_h5(file_path)
        else:
            raise ValueError(f"Unsupported file format: {file_path}")

        obsm_key = (params.get("obsm_key") or "X_umap").strip()
        if obsm_key not in adata.obsm:
            raise ValueError(f"obsm key '{obsm_key}' not found in AnnData")
        coords = adata.obsm[obsm_key]
        if coords is None or coords.shape[1] < 2:
            raise ValueError(f"obsm['{obsm_key}'] must have at least two columns for x,y coordinates")

        raw_genes = params["genes"]
        if isinstance(raw_genes, str):
            gene_list = [g.strip() for g in raw_genes.replace(";", ",").split(",") if g.strip()]
        else:
            gene_list = [str(g).strip() for g in raw_genes if str(g).strip()]
        if not gene_list:
            raise ValueError("No gene symbols provided for plotting.")

        point_size = float(params.get("point_size") or 5.0)
        output_dir = params.get("output_dir")

        available = set(map(str, adata.var_names))
        valid_genes = [g for g in gene_list if g in available]
        missing = [g for g in gene_list if g not in available]
        if not valid_genes:
            raise ValueError("None of the requested genes are present in the dataset.")

        plots: Dict[str, str] = {}
        for gene in valid_genes:
            try:
                expr = adata[:, gene].X
                if sparse.issparse(expr):
                    expr = expr.toarray()
                expr = np.asarray(expr).ravel()
            except Exception:
                logger.debug("Failed to extract expression for gene %s", gene)
                continue

            plot_path = _build_output_path(
                input_path,
                self.name,
                f"{gene}_umap",
                ".png",
                output_dir=output_dir,
            )
            fig, ax = plt.subplots(figsize=(5.5, 5))
            sc_plt = ax.scatter(
                coords[:, 0],
                coords[:, 1],
                c=expr,
                cmap="viridis",
                s=point_size,
                edgecolors="none",
                alpha=0.9,
            )
            ax.set_title(f"{gene} expression on UMAP")
            ax.set_xlabel("UMAP 1")
            ax.set_ylabel("UMAP 2")
            cbar = fig.colorbar(sc_plt, ax=ax, fraction=0.046, pad=0.04)
            cbar.set_label("Expression")
            save_figure(fig, plot_path, tight_layout=False)
            plots[gene] = plot_path

        summary_parts = [
            f"Plotted {len(plots)}/{len(gene_list)} genes on obsm '{obsm_key}' (UMAP)."
        ]
        if missing:
            summary_parts.append(f"Missing genes: {', '.join(missing)}")
        summary_text = " ".join(summary_parts)

        result: Dict[str, Any] = {
            "plots": plots,
            "genes_plotted": valid_genes,
            "missing_genes": missing,
            "obsm_key": obsm_key,
            "summary_text": summary_text,
        }
        return result

    except Exception as e:
        raise RuntimeError(f"UMAP gene plotting failed: {str(e)}")


def _run_pseudotime(self, params: Dict[str, Any]) -> Dict[str, Any]:
    """Compute diffusion pseudotime and plot on UMAP."""
    try:
        input_path = Path(params["adata_id"])
        file_path = str(input_path)
        if file_path.endswith(".h5ad"):
            adata = sc.read_h5ad(file_path)
        elif file_path.endswith(".h5"):
            adata = sc.read_10x_h5(file_path)
        else:
            raise ValueError(f"Unsupported file format: {file_path}")

        adata = adata.copy()
        if not adata.var_names.is_unique:
            adata.var_names_make_unique()

        neighbors_key = params.get("neighbors_key")
        if neighbors_key:
            if neighbors_key + "_connectivities" not in adata.obsp:
                raise ValueError(f"Neighbors key '{neighbors_key}' not found in adata.obsp")
            adata.uns["neighbors"] = {
                "connectivities": adata.obsp[f"{neighbors_key}_connectivities"],
                "distances": adata.obsp.get(f"{neighbors_key}_distances"),
                "params": {"key": neighbors_key},
            }

        # Ensure neighbors exist
        if "neighbors" not in adata.uns:
            sc.pp.neighbors(adata)

        # Root selection
        root_cell = params.get("root_cell")
        root_label = params.get("root_label")
        label_key = params.get("label_key") or "leiden"
        root_index: Optional[int] = None

        if root_cell and root_cell in adata.obs_names:
            root_index = int(np.where(adata.obs_names == root_cell)[0][0])
        elif root_label and label_key in adata.obs.columns:
            root_indices = np.where(adata.obs[label_key].astype(str) == str(root_label))[0]
            if root_indices.size > 0:
                root_index = int(root_indices[0])

        sc.tl.dpt(adata, n_dcs=10, neighbors_key=neighbors_key, root=root_index)

        if "X_umap" not in adata.obsm:
            # Try to generate a UMAP for visualization if missing
            sc.tl.umap(adata)

        pseudotime_vals = adata.obs.get("dpt_pseudotime")
        if pseudotime_vals is None:
            raise RuntimeError("Pseudotime values were not computed.")

        output_dir = params.get("output_dir")
        output_file = _persist_adata(adata, input_path, output_dir=output_dir)

        umap_coords = adata.obsm.get("X_umap")
        plot_path = None
        coords_file = None
        if umap_coords is not None and umap_coords.shape[1] >= 2:
            coords_file = _build_output_path(
                input_path,
                self.name,
                "umap_coords",
                ".csv",
                output_dir=output_dir,
            )
            pd.DataFrame(umap_coords, columns=["umap1", "umap2"]).assign(
                pseudotime=pseudotime_vals.values if hasattr(pseudotime_vals, "values") else pseudotime_vals
            ).to_csv(coords_file, index=False)

            plot_path = _build_output_path(
                input_path,
                self.name,
                "pseudotime_umap",
                ".png",
                output_dir=output_dir,
            )
            fig, ax = plt.subplots(figsize=(6, 5))
            sc_plt = ax.scatter(
                umap_coords[:, 0],
                umap_coords[:, 1],
                c=pseudotime_vals,
                cmap="plasma",
                s=5,
                edgecolors="none",
                alpha=0.9,
            )
            ax.set_title("Diffusion pseudotime")
            ax.set_xlabel("UMAP 1")
            ax.set_ylabel("UMAP 2")
            cbar = fig.colorbar(sc_plt, ax=ax, fraction=0.046, pad=0.04)
            cbar.set_label("Pseudotime")
            save_figure(fig, plot_path, tight_layout=False)

        summary_parts = [
            "Computed diffusion pseudotime.",
        ]
        if root_cell:
            summary_parts.append(f"Root cell: {root_cell}")
        elif root_label:
            summary_parts.append(f"Root label '{root_label}' in column '{label_key}'")
        else:
            summary_parts.append("Root auto-selected by Scanpy.")
        summary_text = " ".join(summary_parts) + f" Outputs saved to {output_file}."

        result: Dict[str, Any] = {
            "output_data": output_file,
            "pseudotime_key": "dpt_pseudotime",
            "root": root_cell or root_label,
            "plots": {"pseudotime_umap": plot_path} if plot_path else {},
            "coords": coords_file,
            "summary_text": summary_text,
        }
        return result

    except Exception as e:
        raise RuntimeError(f"Pseudotime analysis failed: {str(e)}")


def _run_cell_communication(self, params: Dict[str, Any]) -> Dict[str, Any]:
    """Infer ligand-receptor interactions using average expression per cluster."""
    try:
        input_path = Path(params["adata_id"])
        file_path = str(input_path)
        if file_path.endswith(".h5ad"):
            adata = sc.read_h5ad(file_path)
        elif file_path.endswith(".h5"):
            adata = sc.read_10x_h5(file_path)
        else:
            raise ValueError(f"Unsupported file format: {file_path}")

        group_key = params["group_key"]
        if group_key not in adata.obs.columns:
            raise ValueError(f"Column '{group_key}' not found in adata.obs")

        min_expr = params.get("min_expr")
        output_dir = params.get("output_dir")
        n_top_pairs = int(params.get("n_top_pairs") or 20)

        # Load ligand-receptor reference from squidpy if available
        try:
            from squidpy.datasets import ligand_receptor as _lr_dataset

            lr_db = _lr_dataset()
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError("Ligand-receptor reference could not be loaded from squidpy.") from exc

        if lr_db is None or lr_db.empty:
            raise RuntimeError("Ligand-receptor reference is empty.")

        lr_pairs = lr_db[["ligand_complex", "receptor_complex"]].dropna()
        lr_pairs = lr_pairs.rename(columns={"ligand_complex": "ligand", "receptor_complex": "receptor"})

        # Compute mean expression per group
        clusters = adata.obs[group_key].astype(str)
        X = adata.X
        if sparse.issparse(X):
            X = X.toarray()
        expr_df = pd.DataFrame(X, index=adata.obs_names, columns=adata.var_names)
        group_means = expr_df.groupby(clusters).mean()

        # Filter genes present
        available = set(map(str, adata.var_names))
        lr_pairs = lr_pairs[
            lr_pairs["ligand"].isin(available) & lr_pairs["receptor"].isin(available)
        ]
        if lr_pairs.empty:
            raise RuntimeError("No ligand-receptor pairs found in dataset genes.")

        records: List[Dict[str, Any]] = []
        for ligand, receptor in lr_pairs.itertuples(index=False):
            ligand_expr = group_means[ligand]
            receptor_expr = group_means[receptor]
            if min_expr is not None:
                ligand_expr = ligand_expr.where(ligand_expr >= float(min_expr), other=0.0)
                receptor_expr = receptor_expr.where(receptor_expr >= float(min_expr), other=0.0)
            for sender, lig_val in ligand_expr.items():
                if lig_val <= 0:
                    continue
                for receiver, rec_val in receptor_expr.items():
                    if rec_val <= 0:
                        continue
                    score = float(lig_val * rec_val)
                    if score <= 0:
                        continue
                    records.append(
                        {
                            "sender": sender,
                            "receiver": receiver,
                            "ligand": ligand,
                            "receptor": receptor,
                            "score": score,
                        }
                    )

        if not records:
            raise RuntimeError("No interactions passed the expression filters.")

        interactions = pd.DataFrame(records)
        interactions.sort_values("score", ascending=False, inplace=True)
        top_interactions = interactions.head(n_top_pairs)

        output_table = _build_output_path(input_path, self.name, "top_interactions", ".csv", output_dir=output_dir)
        interactions.to_csv(output_table, index=False)

        plot_path = _build_output_path(input_path, self.name, "top_interactions", ".png", output_dir=output_dir)
        fig, ax = plt.subplots(figsize=(8, 5))
        display = top_interactions.copy()
        display["pair"] = display["ligand"] + "→" + display["receptor"]
        ax.barh(display["pair"], display["score"], color="#4C72B0")
        ax.invert_yaxis()
        ax.set_xlabel("Interaction score (mean ligand * mean receptor)")
        ax.set_title(f"Top {len(display)} ligand-receptor pairs")
        fig.tight_layout()
        fig.savefig(plot_path, dpi=150)
        plt.close(fig)

        summary_text = (
            f"Inferred {len(interactions)} ligand-receptor interactions across {interactions['sender'].nunique()} senders "
            f"and {interactions['receiver'].nunique()} receivers. "
            f"Top {len(display)} pairs saved to {output_table}."
        )

        return {
            "table": output_table,
            "top_pairs": top_interactions.to_dict(orient="records"),
            "plot": plot_path,
            "summary_text": summary_text,
        }

    except Exception as e:
        raise RuntimeError(f"Cell-cell communication analysis failed: {str(e)}")


def _run_preprocess_pipeline(self, params: Dict[str, Any]) -> Dict[str, Any]:
    """Combined QC filtering and clustering/embedding pipeline."""
    try:
        input_path = Path(params["adata_id"])
        file_path = str(input_path)
        if file_path.endswith(".h5ad"):
            adata = sc.read_h5ad(file_path)
        elif file_path.endswith(".h5"):
            adata = sc.read_10x_h5(file_path)
        else:
            raise ValueError(f"Unsupported file format: {file_path}")

        if not adata.var_names.is_unique:
            logger.warning("Detected duplicated gene names during preprocessing; making them unique.")
            adata.var_names_make_unique()
        if not adata.obs_names.is_unique:
            logger.warning("Detected duplicated cell identifiers during preprocessing; making them unique.")
            adata.obs_names_make_unique()

        if adata.raw is not None:
            logger.warning(
                "Replacing existing AnnData.raw to keep identifiers in sync with deduplicated obs/var names."
            )
            adata.raw = None

        adata.var["gene_symbols"] = adata.var_names.astype(str)

        output_dir = params.get("output_dir")

        # --- QC filtering section ---
        initial_stats = {"n_cells": adata.n_obs, "n_genes": adata.n_vars}

        qc_vars: Optional[Dict[str, Any]] = None
        if "mt" in adata.var.columns:
            qc_vars = {"mt": adata.var["mt"].astype(bool)}
        else:
            mito_mask = adata.var_names.str.upper().str.startswith("MT-") if hasattr(adata.var_names, "str") else None
            if mito_mask is not None and mito_mask.any():
                mito_mask = np.asarray(mito_mask, dtype=bool)
                adata.var["mt"] = mito_mask
                qc_vars = {"mt": adata.var["mt"]}

        try:
            sc.pp.calculate_qc_metrics(
                adata,
                qc_vars=qc_vars if qc_vars else {},
                percent_top=None,
                log1p=False,
                inplace=True,
            )
        except (TypeError, ValueError) as qc_err:
            logger.warning("QC metrics calculation failed (%s), proceeding without qc_vars", qc_err)
            # Retry with empty dict (scanpy doesn't accept None)
            sc.pp.calculate_qc_metrics(
                adata,
                qc_vars={},
                percent_top=None,
                log1p=False,
                inplace=True,
            )

        gene_counts = np.asarray((adata.X > 0).sum(axis=0)).ravel()
        cell_counts = np.asarray((adata.X > 0).sum(axis=1)).ravel()
        min_cells_mask = gene_counts >= params["min_cells"]
        min_genes_mask = cell_counts >= params["min_genes"]

        mito_columns = [col for col in adata.obs.columns if col.startswith("pct_counts_")]
        mito_column = next((col for col in mito_columns if "mt" in col.lower()), None)
        if mito_column:
            max_pct_mito_mask = adata.obs[mito_column] <= params["max_pct_mito"]
        else:
            logger.warning("No mitochondrial genes found. Skipping mitochondrial filtering.")
            max_pct_mito_mask = np.ones(adata.n_obs, dtype=bool)

        adata = adata[min_genes_mask & max_pct_mito_mask, min_cells_mask].copy()

        final_stats = {
            "n_cells": adata.n_obs,
            "n_genes": adata.n_vars,
            "cells_removed": initial_stats["n_cells"] - adata.n_obs,
            "genes_removed": initial_stats["n_genes"] - adata.n_vars,
        }

        if final_stats["n_cells"] == 0 or final_stats["n_genes"] == 0:
            raise RuntimeError(
                "Preprocess pipeline removed all cells or genes; please relax QC thresholds."
            )

        # Preserve raw counts before normalization
        adata.layers["raw_counts"] = adata.X.copy()
        adata.raw = adata.copy()

        # --- Embedding/clustering section ---
        sc.pp.normalize_total(adata)
        sc.pp.log1p(adata)
        adata.layers["log1p"] = adata.X.copy()
        try:
            sc.pp.highly_variable_genes(adata)
        except ValueError as hv_err:
            logger.warning(
                "Skipping highly variable gene selection due to: %s", hv_err
            )
        sc.pp.pca(adata)
        sc.pp.neighbors(adata)

        method = params["method"].lower()
        if method == "umap":
            sc.tl.umap(adata)
            embedding_key = "X_umap"
        elif method == "tsne":
            sc.tl.tsne(adata)
            embedding_key = "X_tsne"
        else:
            raise ValueError(f"Unsupported embedding method: {params['method']}")

        try:
            sc.tl.leiden(adata, flavor="igraph", n_iterations=2, directed=False)
        except Exception as err:
            logger.warning(
                "Leiden igraph flavor unavailable (%s); falling back to legacy settings.", err
            )
            sc.tl.leiden(adata, flavor="leidenalg")

        color_by = params.get("color_by") or "leiden"
        if color_by not in adata.obs.columns and "leiden" in adata.obs.columns:
            color_by = "leiden"

        cluster_labels = adata.obs[color_by].astype(str)
        cluster_sizes = cluster_labels.value_counts().sort_index().to_dict()

        try:
            from sklearn.metrics import silhouette_score

            if adata.obsm[embedding_key].shape[0] > 1 and len(cluster_sizes) > 1:
                silhouette = float(
                    silhouette_score(adata.obsm[embedding_key], cluster_labels, metric="euclidean")
                )
            else:
                silhouette = 0.0
        except Exception:
            silhouette = 0.0

        output_file = _persist_adata(adata, input_path, output_dir=output_dir)
        embedding_file = _build_output_path(input_path, self.name, "coords", ".csv", output_dir=output_dir)
        cluster_plot = _build_output_path(input_path, self.name, "clusters", ".json", output_dir=output_dir)

        embedding_df = pd.DataFrame(adata.obsm[embedding_key], columns=["dim1", "dim2"])
        embedding_df.to_csv(embedding_file, index=False)

        with open(cluster_plot, "w", encoding="utf-8") as handle:
            json.dump(
                {
                    "method": method,
                    "color_by": color_by,
                    "clusters": cluster_sizes,
                },
                handle,
            )

        qc_plots = {
            "gene_dist": _build_output_path(input_path, self.name, "gene_dist", ".pdf", output_dir=output_dir),
            "mito_dist": _build_output_path(input_path, self.name, "mito_dist", ".pdf", output_dir=output_dir),
            "correlation": _build_output_path(input_path, self.name, "correlation", ".pdf", output_dir=output_dir),
        }

        # Generate QC visualisations
        gene_series = adata.obs.get("n_genes_by_counts")
        if gene_series is not None and len(gene_series) > 0:
            fig, ax = plt.subplots(figsize=(6, 4))
            ax.hist(gene_series, bins=50, color="#4C72B0", alpha=0.85)
            ax.set_xlabel("Genes per cell")
            ax.set_ylabel("Number of cells")
            ax.set_title("Distribution of detected genes")
            save_figure(fig, qc_plots["gene_dist"])
        else:
            fig, ax = plt.subplots(figsize=(6, 4))
            ax.axis("off")
            ax.text(0.5, 0.5, "Gene count metrics unavailable", ha="center", va="center", fontsize=12)
            save_figure(fig, qc_plots["gene_dist"], tight_layout=False)

        if mito_column and mito_column in adata.obs:
            mito_series = adata.obs[mito_column]
            fig, ax = plt.subplots(figsize=(6, 4))
            ax.hist(mito_series, bins=50, color="#55A868", alpha=0.85)
            ax.set_xlabel("Percent mitochondrial counts")
            ax.set_ylabel("Number of cells")
            ax.set_title("Mitochondrial content distribution")
            save_figure(fig, qc_plots["mito_dist"])
        else:
            fig, ax = plt.subplots(figsize=(6, 4))
            ax.axis("off")
            ax.text(0.5, 0.5, "No mitochondrial metrics available", ha="center", va="center", fontsize=12)
            save_figure(fig, qc_plots["mito_dist"], tight_layout=False)

        if (
            "n_genes_by_counts" in adata.obs
            and "total_counts" in adata.obs
            and len(adata.obs) > 0
        ):
            fig, ax = plt.subplots(figsize=(6, 4))
            ax.scatter(
                adata.obs["total_counts"],
                adata.obs["n_genes_by_counts"],
                s=2,
                alpha=1.0,
                color="#C44E52",
                edgecolors="none",
            )
            ax.set_xlabel("Total counts")
            ax.set_ylabel("Genes per cell")
            ax.set_title("QC metric correlation")
            save_figure(fig, qc_plots["correlation"])
        else:
            fig, ax = plt.subplots(figsize=(6, 4))
            ax.axis("off")
            ax.text(0.5, 0.5, "QC correlation metrics unavailable", ha="center", va="center", fontsize=12)
            save_figure(fig, qc_plots["correlation"], tight_layout=False)

        embedding_plot = _build_output_path(input_path, self.name, f"{method}_embedding", ".png", output_dir=output_dir)
        cluster_sizes_plot = _build_output_path(input_path, self.name, "cluster_sizes", ".png", output_dir=output_dir)

        coords = adata.obsm.get(embedding_key)
        if coords is not None and coords.shape[1] >= 2:
            fig, ax = plt.subplots(figsize=(6, 5))
            unique_labels = sorted(cluster_sizes.keys())
            cmap = plt.colormaps.get_cmap("tab20")
            colors = cmap(np.linspace(0, 1, max(len(unique_labels), 1)))
            for idx, label in enumerate(unique_labels):
                mask = cluster_labels == str(label)
                ax.scatter(
                    coords[mask.values if hasattr(mask, "values") else mask, 0],
                    coords[mask.values if hasattr(mask, "values") else mask, 1],
                    s=2,
                    color=colors[idx],
                    alpha=1.0,
                    edgecolors="none",
                    label=str(label),
                )
            ax.set_xlabel("Dim1")
            ax.set_ylabel("Dim2")
            ax.set_title(f"{method.upper()} embedding coloured by {color_by}")
            if unique_labels:
                legend_columns = 1
                if len(unique_labels) > 24:
                    legend_columns = 3
                elif len(unique_labels) > 12:
                    legend_columns = 2
                ax.legend(
                    loc="center left",
                    bbox_to_anchor=(1.02, 0.5),
                    frameon=False,
                    markerscale=1.5,
                    fontsize=8,
                    ncol=legend_columns,
                )
                right_margin = 0.78
                if legend_columns == 2:
                    right_margin = 0.72
                elif legend_columns >= 3:
                    right_margin = 0.66
                fig.subplots_adjust(right=right_margin)
            save_figure(fig, embedding_plot, tight_layout=False)
        else:
            fig, ax = plt.subplots(figsize=(6, 4))
            ax.axis("off")
            ax.text(0.5, 0.5, "Embedding coordinates unavailable", ha="center", va="center", fontsize=12)
            save_figure(fig, embedding_plot, tight_layout=False)

        if cluster_sizes:
            cluster_series = pd.Series(cluster_sizes).sort_index()
            fig, ax = plt.subplots(figsize=(6, 4))
            cluster_series.plot(kind="bar", ax=ax, color="#8172B2")
            ax.set_xlabel(color_by)
            ax.set_ylabel("Cell count")
            ax.set_title("Cluster sizes")
            save_figure(fig, cluster_sizes_plot)
        else:
            fig, ax = plt.subplots(figsize=(6, 4))
            ax.axis("off")
            ax.text(0.5, 0.5, "No clusters detected", ha="center", va="center", fontsize=12)
            save_figure(fig, cluster_sizes_plot, tight_layout=False)

        cell_retained_pct = (
            (final_stats["n_cells"] / initial_stats["n_cells"] * 100)
            if initial_stats["n_cells"]
            else 0
        )
        gene_retained_pct = (
            (final_stats["n_genes"] / initial_stats["n_genes"] * 100)
            if initial_stats["n_genes"]
            else 0
        )
        mito_note = (
            "Mitochondrial filtering applied."
            if mito_column
            else "Mitochondrial filtering skipped (no mt genes detected)."
        )
        top_clusters = sorted(cluster_sizes.items(), key=lambda kv: kv[1], reverse=True)[:3]
        top_cluster_summary = (
            ", ".join(f"{label}: {count}" for label, count in top_clusters)
            if top_clusters
            else "None"
        )

        summary_text = (
            f"Preprocess pipeline retained {final_stats['n_cells']:,}/{initial_stats['n_cells']:,} cells "
            f"({cell_retained_pct:.1f}%) and {final_stats['n_genes']:,}/{initial_stats['n_genes']:,} genes "
            f"({gene_retained_pct:.1f}%). {mito_note} Generated {method.upper()} embedding with {len(cluster_sizes)} clusters "
            f"(top: {top_cluster_summary}) and silhouette score {silhouette:.2f}. Outputs saved to {output_file}."
        )

        return {
            "output_data": output_file,
            "initial_stats": initial_stats,
            "final_stats": final_stats,
            "qc_plots": qc_plots,
            "embedding_plot": embedding_plot,
            "cluster_sizes_plot": cluster_sizes_plot,
            "embedding_coords": embedding_file,
            "cluster_plot": cluster_plot,
            "clusters": {
                "n_clusters": len(cluster_sizes),
                "sizes": cluster_sizes,
                "silhouette_score": silhouette,
            },
            "summary_text": summary_text,
        }

    except Exception as e:
        raise RuntimeError(f"Preprocess pipeline failed: {str(e)}")


# ---------------------------------------------------------------------------
# Differential Expression Tool
# ---------------------------------------------------------------------------


class DEToolInput(BaseModel):
    """Input schema for DE analysis tool."""

    adata_id: str = Field(description="Data object handle")
    group_key: str = Field(description="Observation column to use for group comparisons")
    log2fc_threshold: float = Field(description="Log2 fold change threshold")
    fdr_threshold: float = Field(description="FDR threshold")
    output_dir: Optional[str] = Field(
        default=None,
        description="Directory for differential expression outputs",
    )


class DEAnalysisTool(BioToolBase):
    name = "de_analysis"
    description = "Perform differential expression analysis"
    input_schema = DEToolInput


def _run_de_analysis(self, params: Dict[str, Any]) -> Dict[str, Any]:
    """Implementation of differential expression analysis."""
    try:
        # Load data
        input_path = Path(params["adata_id"])
        adata = sc.read_h5ad(str(input_path))
        group_key = params["group_key"]

        if group_key not in adata.obs.columns:
            raise ValueError(f"Column '{group_key}' not found in adata.obs")

        adata.obs[group_key] = adata.obs[group_key].astype(str).astype("category")
        groups = list(adata.obs[group_key].cat.categories)
        
        # Filter out NaN/nan groups
        groups = [g for g in groups if g.lower() not in ['nan', 'none', '']]

        if len(groups) < 2:
            raise ValueError(
                f"Group column '{group_key}' must contain at least two distinct values (after filtering NaN)"
            )

        # Run DE analysis comparing each group against the rest
        sc.tl.rank_genes_groups(
            adata,
            groupby=group_key,
            groups=groups,
            reference="rest",
            rankby_abs=True,
            method="t-test_overestim_var",
            use_raw=False,
        )

        all_results: List[pd.DataFrame] = []
        significant_results: Dict[str, Dict[str, Dict[str, float]]] = {}
        summary: Dict[str, Dict[str, int]] = {}
        volcano_payload: Dict[str, List[Dict[str, float]]] = {}
        top_gene_records: List[Dict[str, Any]] = []

        total_significant = 0
        log2fc_threshold = params["log2fc_threshold"]
        fdr_threshold = params["fdr_threshold"]

        for group in groups:
            group_df = sc.get.rank_genes_groups_df(adata, group=group)
            group_df["group"] = group
            all_results.append(group_df)

            sig_mask = (
                group_df["logfoldchanges"].abs() >= log2fc_threshold
            ) & (group_df["pvals_adj"] <= fdr_threshold)
            sig_df = group_df[sig_mask].copy()

            significant_results[group] = {}
            for _, row in sig_df.iterrows():
                gene_name = row["names"]
                logfc_value = float(row["logfoldchanges"])
                padj_value = float(row["pvals_adj"]) if pd.notna(row["pvals_adj"]) else None

                significant_results[group][gene_name] = {
                    "log2fc": logfc_value,
                    "padj": padj_value,
                }

            if not sig_df.empty:
                top_local = (
                    sig_df.sort_values("pvals_adj", ascending=True, na_position="last")
                    .head(3)
                )
                for _, row in top_local.iterrows():
                    padj_value = float(row["pvals_adj"]) if pd.notna(row["pvals_adj"]) else None
                    top_gene_records.append(
                        {
                            "group": group,
                            "gene": row["names"],
                            "log2fc": float(row["logfoldchanges"]),
                            "padj": padj_value,
                        }
                    )

            summary[group] = {
                "significant": int(len(sig_df)),
                "upregulated": int((sig_df["logfoldchanges"] > 0).sum()),
                "downregulated": int((sig_df["logfoldchanges"] < 0).sum()),
            }

            total_significant += len(sig_df)

            volcano_payload[group] = [
                {
                    "gene": row["names"],
                    "log2fc": float(row["logfoldchanges"]),
                    "padj": float(row["pvals_adj"]),
                }
                for _, row in group_df.iterrows()
            ]

        combined_df = pd.concat(all_results, ignore_index=True)

        output_dir = params.get("output_dir")

        # Persist tabular output for downstream use
        results_table = _build_output_path(
            input_path,
            self.name,
            "table",
            ".csv",
            output_dir=output_dir,
        )
        combined_df.to_csv(results_table, index=False)

        # Generate volcano plots for each group
        volcano_plots = {}
        for group in groups:
            group_df = sc.get.rank_genes_groups_df(adata, group=group)
            
            # Calculate -log10(pval)
            group_df['neg_log10_pval'] = -np.log10(group_df['pvals_adj'].clip(lower=1e-300))
            
            # Create volcano plot
            fig, ax = plt.subplots(figsize=(8, 6))
            
            # Classify points
            sig_up = (group_df['logfoldchanges'] >= log2fc_threshold) & (group_df['pvals_adj'] <= fdr_threshold)
            sig_down = (group_df['logfoldchanges'] <= -log2fc_threshold) & (group_df['pvals_adj'] <= fdr_threshold)
            not_sig = ~(sig_up | sig_down)
            
            # Plot points
            ax.scatter(group_df.loc[not_sig, 'logfoldchanges'], 
                      group_df.loc[not_sig, 'neg_log10_pval'],
                      c='gray', s=10, alpha=0.5, label='Not significant')
            ax.scatter(group_df.loc[sig_up, 'logfoldchanges'], 
                      group_df.loc[sig_up, 'neg_log10_pval'],
                      c='#E74C3C', s=15, alpha=0.7, label='Upregulated')
            ax.scatter(group_df.loc[sig_down, 'logfoldchanges'], 
                      group_df.loc[sig_down, 'neg_log10_pval'],
                      c='#3498DB', s=15, alpha=0.7, label='Downregulated')
            
            # Add threshold lines
            ax.axhline(y=-np.log10(fdr_threshold), color='black', linestyle='--', linewidth=1, alpha=0.5)
            ax.axvline(x=log2fc_threshold, color='black', linestyle='--', linewidth=1, alpha=0.5)
            ax.axvline(x=-log2fc_threshold, color='black', linestyle='--', linewidth=1, alpha=0.5)
            
            ax.set_xlabel('Log2 Fold Change', fontsize=12)
            ax.set_ylabel('-Log10(Adjusted P-value)', fontsize=12)
            ax.set_title(f'Volcano Plot: {group} vs rest', fontsize=14, fontweight='bold')
            ax.legend(loc='upper right', fontsize=9)
            ax.grid(True, alpha=0.2)
            
            volcano_plot_path = _build_output_path(
                input_path,
                self.name,
                f"volcano_{group}",
                ".png",
                output_dir=output_dir,
            )
            save_figure(fig, volcano_plot_path)
            volcano_plots[group] = volcano_plot_path

        leading_groups = [
            f"{group}: {metrics['significant']}" for group, metrics in summary.items()
        ]
        leading_desc = ", ".join(leading_groups[:3]) if leading_groups else "none"

        top_gene_records.sort(
            key=lambda rec: (
                rec["padj"] if rec["padj"] is not None else float("inf"),
                -abs(rec["log2fc"]),
            )
        )
        top_gene_summary = (
            ", ".join(
                f"{record['gene']}[{record['group']}]"
                for record in top_gene_records[:5]
            )
            if top_gene_records
            else "none"
        )
        summary_text = (
            f"Differential expression across '{group_key}' compared each of {len(groups)} groups to the rest, "
            f"yielding {total_significant} significant genes. Top groups by hits: {leading_desc}. "
            f"Top genes: {top_gene_summary}. Detailed results saved to {results_table}."
        )

        return {
            "table": results_table,
            "volcano_plots": volcano_plots,
            "results": significant_results,
            "summary": summary,
            "significant_genes": int(total_significant),
            "top_genes": top_gene_records[:10],
            "summary_text": summary_text,
        }

    except Exception as e:
        raise RuntimeError(f"DE analysis failed: {str(e)}")

# ---------------------------------------------------------------------------
# Cell Typing Tool
# ---------------------------------------------------------------------------


class MarkerSet(BaseModel):
    """Schema for marker gene set per cell type."""

    positive: List[str] = Field(
        description="Positive marker genes for this cell type (required by scanpy tl.score_genes)",
    )
    negative: List[str] = Field(
        default_factory=list,
        description="Optional negative marker genes (currently ignored by the scanpy workflow)",
    )
    rationale: str = Field(description="Explanation of why these markers are appropriate")


class CellTypingInput(BaseModel):
    """Input schema for cell typing tool."""

    adata_id: str = Field(description="Data object handle")
    marker_sets: Optional[Dict[str, MarkerSet]] = Field(
        default=None,
        description="Cell type marker sets; leave blank to auto-recommend",
    )
    tissue_type: Optional[str] = Field(
        default=None,
        description="Tissue type used for automatic marker recommendation",
    )
    expected_types: Optional[List[str]] = Field(
        default=None,
        description="Expected cell types (auto recommendation focus)",
    )
    question: Optional[str] = Field(
        default=None,
        description="Additional biological context for marker recommendation",
    )
    custom_markers: Optional[Dict[str, Dict[str, List[str]]]] = Field(
        default=None,
        description="User provided markers to merge into recommendations",
    )
    output_key: str = Field(
        default="predicted_type",
        description="Key in adata.obs for results",
    )
    output_dir: Optional[str] = Field(
        default=None,
        description="Directory for cell typing outputs and updated AnnData",
    )


class CellTypingTool(BioToolBase):
    name = "cell_typing"
    description = "Annotate cell types using marker genes"
    input_schema = CellTypingInput

    DEFAULT_MODEL_NAME = "gpt-4"

    def __init__(
        self,
        llm: Optional[Runnable] = None,
        model_name: Optional[str] = None,
        llm_kwargs: Optional[Dict[str, Any]] = None,
        **_: Any,
    ) -> None:
        super().__init__()
        self._llm_kwargs = llm_kwargs or {}
        if llm is not None:
            self.llm = llm
        else:
            chosen_model = model_name or self.DEFAULT_MODEL_NAME
            self.llm = ChatOpenAI(model=chosen_model, temperature=0, **self._llm_kwargs)

    def recommend_marker_sets(
        self,
        tissue_type: Optional[str] = None,
        expected_types: Optional[Sequence[str]] = None,
        question: Optional[str] = None,
        custom_markers: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return _recommend_marker_sets(
            self,
            tissue_type=tissue_type,
            expected_types=expected_types,
            question=question,
            custom_markers=custom_markers,
        )

    def select_marker_sets(
        self,
        params: Dict[str, Any],
        user_io,
        context: Dict[str, Any],
    ) -> Tuple[Dict[str, Any], Optional[str], str, Dict[str, Any]]:
        base_question = params.get("question") or context.get("metadata_summary")
        guidance = context.get("marker_guidance")
        if guidance:
            base_question = f"{(base_question or '').strip()} {guidance}".strip()
        recommendation_params: Dict[str, Any] = {
            "tissue_type": params.get("tissue_type") or context.get("tissue_type"),
            "expected_types": None,
            "question": base_question,
            "custom_markers": params.get("custom_markers"),
        }

        while True:
            try:
                recommendation = self.recommend_marker_sets(
                    tissue_type=recommendation_params.get("tissue_type"),
                    expected_types=recommendation_params.get("expected_types"),
                    question=recommendation_params.get("question"),
                    custom_markers=recommendation_params.get("custom_markers"),
                )
            except Exception as exc:  # noqa: BLE001
                user_io.display(f"Marker recommendation failed: {exc}")
                if not self._collect_additional_guidance(user_io, recommendation_params):
                    raise RuntimeError("Marker recommendation aborted: no usable panels could be generated.") from exc
                continue

            marker_sets = recommendation.get("marker_sets", {})
            summary_text = recommendation.get("summary_text")

            if marker_sets:
                self._display_marker_preview(user_io, marker_sets, summary_text)
                if user_io.confirm("Use the recommended marker panels above?", default=True):
                    params["marker_sets"] = marker_sets
                    refined_params: Dict[str, Any] = {}
                    if recommendation_params.get("question"):
                        refined_params["question"] = recommendation_params["question"]
                    return marker_sets, summary_text, "auto-recommended", refined_params

                user_hint = user_io.prompt(
                    "Explain how to refine these markers (leave blank to reuse previous hints):"
                ).strip()
                if user_hint:
                    existing_question = recommendation_params.get("question", "") or ""
                    combined_question = f"{existing_question} {user_hint}".strip()
                    recommendation_params["question"] = combined_question
                if self._collect_additional_guidance(user_io, recommendation_params):
                    continue
                raise RuntimeError("Marker recommendation cancelled by user.")
            else:
                user_io.display("Marker recommendation returned no marker panels.")
                if self._collect_additional_guidance(user_io, recommendation_params):
                    continue
                raise RuntimeError("Marker recommendation failed: no marker sets produced.")

    def _display_marker_preview(
        self,
        user_io,
        marker_sets: Dict[str, Any],
        summary: Optional[str] = None,
    ) -> None:
        if summary:
            user_io.display(f"Marker recommendation summary: {summary}")
        if not marker_sets:
            user_io.display("No marker panels available for preview.")
            return
        preview_lines = ["Marker panel preview:"]
        for idx, (cell_type, markers) in enumerate(marker_sets.items(), start=1):
            positives: List[str] = []
            negatives: List[str] = []
            if isinstance(markers, dict):
                positives = markers.get("positive") or markers.get("markers") or markers.get("genes") or []
                negatives = markers.get("negative") or []
                if isinstance(negatives, str):
                    negatives = [negatives]
                elif negatives is None:
                    negatives = []
                elif not isinstance(negatives, list):
                    negatives = list(negatives)
            elif isinstance(markers, (list, tuple)):
                positives = list(markers)
            preview_lines.append(f"  {idx}. {cell_type}:")
            preview_lines.append("    + Positive markers:")
            if positives:
                for gene in positives:
                    preview_lines.append(f"      - {gene}")
            else:
                preview_lines.append("      - <none>")
            preview_lines.append("    - Negative markers:")
            if negatives:
                for gene in negatives:
                    preview_lines.append(f"      - {gene}")
            else:
                preview_lines.append("      - <none>")
        user_io.display("\n".join(preview_lines))

    def _collect_additional_guidance(
        self,
        user_io,
        recommendation_params: Dict[str, Any],
    ) -> bool:
        updated = False

        extra_context = user_io.prompt(
            "Add additional biological guidance for the next recommendation (leave blank to keep current):"
        ).strip()
        if extra_context:
            existing_question = recommendation_params.get("question", "") or ""
            combined_question = f"{existing_question} {extra_context}".strip()
            recommendation_params["question"] = combined_question
            user_io.display("Retrying marker recommendation with updated guidance.")
            return True

        return user_io.confirm("Retry marker recommendation with the existing instructions?", default=False)


def _recommend_marker_sets(
    self,
    *,
    tissue_type: Optional[str],
    expected_types: Optional[Sequence[str]] = None,
    question: Optional[str] = None,
    custom_markers: Optional[Dict[str, Dict[str, List[str]]]] = None,
) -> Dict[str, Any]:
    """Generate marker sets via LLM to support automatic cell typing."""
    try:
        resolved_tissue = tissue_type.strip() if isinstance(tissue_type, str) else ""
        if not resolved_tissue:
            resolved_tissue = "unspecified tissue context"

        explicit_expected = []
        if isinstance(expected_types, (list, tuple)):
            explicit_expected = [
                str(cell_type).strip() for cell_type in expected_types if str(cell_type).strip()
            ]
            explicit_expected = list(dict.fromkeys(explicit_expected))

        resolved_question = question or (
            "Infer all relevant cell populations for this sample and propose comprehensive positive and negative marker panels that distinguish closely related phenotypes."
        )

        if explicit_expected:
            target_cell_types = "\n".join(f"- {cell_type}" for cell_type in explicit_expected)
        else:
            target_cell_types = "- Not specified; infer all relevant cell types from the tissue context and biological question."

        base_prompt = LLM_PROMPTS["marker_recommendation"].format(
            tissue_type=resolved_tissue,
            question=resolved_question,
            target_cell_types=target_cell_types,
        )

        if explicit_expected:
            prompt_variants = [
                base_prompt,
                base_prompt
                + "\nEnsure every requested cell type listed above appears in the JSON with rich positive and negative marker coverage. Respond with JSON only.",
                base_prompt
                + "\nIf any requested cell type seems ambiguous, return the closest well-defined alternative and explain the substitution in the rationale. Respond with JSON only.",
            ]
        else:
            prompt_variants = [
                base_prompt,
                base_prompt
                + "\nEnumerate every major cell population implied by the context and avoid umbrella categories. Respond with JSON only.",
                base_prompt
                + "\nDouble-check that each cell type has ≥4 positive markers, ≥2 negative markers when available, and no vague or duplicate labels. Respond with JSON only.",
            ]

        marker_sets: Dict[str, Dict[str, Any]] = {}
        last_error: Optional[str] = None
        missing_expected: List[str] = []

        for attempt_idx, attempt_prompt in enumerate(prompt_variants, start=1):
            messages = [
                SystemMessage(content=LLM_SYSTEM_MESSAGES["json_only"]),
                HumanMessage(content=attempt_prompt),
            ]
            try:
                response = self.llm.invoke(messages)
                content = response.content if hasattr(response, "content") else str(response)
            except Exception as exc:
                last_error = str(exc)
                logger.warning(
                    "Marker recommendation attempt %d failed to reach LLM: %s",
                    attempt_idx,
                    exc,
                )
                continue

            try:
                candidate_sets = _parse_marker_response(content)
                candidate_sets = _normalise_marker_panels(candidate_sets)
            except Exception as exc:
                last_error = str(exc)
                logger.warning(
                    "Marker recommendation attempt %d produced unusable output: %s",
                    attempt_idx,
                    exc,
                )
                continue

            if not candidate_sets:
                last_error = "LLM returned no usable marker panels"
                logger.warning(
                    "Marker recommendation attempt %d returned no usable marker panels; retrying with stricter instructions.",
                    attempt_idx,
                )
                continue

            missing_expected = []
            if explicit_expected:
                missing_expected = [
                    cell_type for cell_type in explicit_expected if cell_type not in candidate_sets
                ]
                if missing_expected:
                    last_error = (
                        f"Missing markers for requested cell types: {', '.join(missing_expected)}"
                    )
                    logger.warning(
                        "Marker recommendation attempt %d missing requested cell types: %s",
                        attempt_idx,
                        ", ".join(missing_expected),
                    )
                    continue

            if candidate_sets:
                marker_sets = candidate_sets
                break

        marker_sets, _ = _merge_marker_panels(marker_sets, custom_markers)

        if explicit_expected:
            missing_after_merge = [cell_type for cell_type in explicit_expected if cell_type not in marker_sets]
            if missing_after_merge:
                detail = (
                    " Missing marker panels for requested cell types: "
                    + ", ".join(missing_after_merge)
                )
                if last_error:
                    detail += f". Last error: {last_error}"
                raise RuntimeError(
                    "LLM did not return marker sets for all requested cell types." + detail
                )

        if not marker_sets:
            detail = f" Last error: {last_error}" if last_error else ""
            raise RuntimeError(
                "LLM did not return any marker sets for the requested configuration." + detail
            )

        cell_types = list(marker_sets.keys())
        highlighted = ", ".join(cell_types[:5]) if cell_types else ""
        summary_text = (
            f"Recommended marker panels for {len(cell_types)} cell types"
            + (f": {highlighted}" if highlighted else "")
        )

        return {
            "marker_sets": marker_sets,
            "summary_text": summary_text,
        }

    except Exception as e:
        raise RuntimeError(f"Marker recommendation failed: {str(e)}")


def _parse_marker_response(content: str) -> Dict[str, Any]:
    content = content.strip()
    try:
        parsed = json.loads(content)
        if not isinstance(parsed, dict):
            raise ValueError("Parsed JSON is not a dictionary")
        return parsed
    except Exception:
        # Attempt to recover JSON within code fences or embedded text
        fence_match = re.search(r"```json\s*(.*?)```", content, re.DOTALL)
        if fence_match:
            fenced = fence_match.group(1)
            parsed = json.loads(fenced)
            if not isinstance(parsed, dict):
                raise ValueError("Parsed JSON is not a dictionary")
            return parsed

        brace_match = re.search(r"({.*})", content, re.DOTALL)
        if brace_match:
            parsed = json.loads(brace_match.group(1))
            if not isinstance(parsed, dict):
                raise ValueError("Parsed JSON is not a dictionary")
            return parsed

        raise ValueError("Unable to parse JSON from LLM response.")


def _normalise_marker_panels(raw_sets: Optional[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Coerce raw marker responses into positive-only panels with rationales."""

    if not raw_sets:
        return {}

    normalised: Dict[str, Dict[str, Any]] = {}
    for cell_type, markers in raw_sets.items():
        if not cell_type:
            continue

        positive: List[str] = []
        negative: List[str] = []
        rationale: str = ""

        if isinstance(markers, dict):
            candidate = markers.get("positive") or markers.get("markers") or markers.get("genes")
            if isinstance(candidate, str):
                candidate = [candidate]
            if isinstance(candidate, list):
                positive = [str(gene).strip() for gene in candidate if str(gene).strip()]
            neg_candidate = markers.get("negative") or markers.get("neg") or markers.get("exclude")
            if isinstance(neg_candidate, str):
                neg_candidate = [neg_candidate]
            if isinstance(neg_candidate, list):
                negative = [str(gene).strip() for gene in neg_candidate if str(gene).strip()]
            rationale = str(markers.get("rationale", "")).strip()
        elif isinstance(markers, (list, tuple)):
            positive = [str(gene).strip() for gene in markers if str(gene).strip()]
        elif isinstance(markers, str):
            positive = [gene.strip() for gene in markers.split(",") if gene.strip()]

        positive = list(dict.fromkeys(positive))
        negative = [gene for gene in dict.fromkeys(negative) if gene and gene not in positive]
        if not positive:
            continue

        normalised[cell_type] = {
            "positive": positive,
            "negative": negative,
            "rationale": rationale or "LLM-suggested marker panel.",
        }

    return normalised


def _merge_marker_panels(
    base_sets: Optional[Dict[str, Any]],
    overlay_sets: Optional[Dict[str, Any]],
) -> Tuple[Dict[str, Dict[str, Any]], bool]:
    """Merge two marker panel dictionaries, preserving positives/negatives and rationales."""

    base_normalised = _normalise_marker_panels(base_sets)
    overlay_normalised = _normalise_marker_panels(overlay_sets)
    if not overlay_normalised:
        return base_normalised, False

    def _clone_panel(panel: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "positive": list(panel.get("positive", [])),
            "negative": list(panel.get("negative", [])),
            "rationale": str(panel.get("rationale", "")).strip(),
        }

    merged: Dict[str, Dict[str, Any]] = {
        cell_type: _clone_panel(panel) for cell_type, panel in base_normalised.items()
    }
    changed = False

    for cell_type, panel in overlay_normalised.items():
        existing = merged.get(cell_type)
        if existing is None:
            merged[cell_type] = _clone_panel(panel)
            changed = True
            continue

        combined_pos = list(dict.fromkeys([*existing.get("positive", []), *panel.get("positive", [])]))
        combined_neg = list(dict.fromkeys([*existing.get("negative", []), *panel.get("negative", [])]))
        combined_neg = [gene for gene in combined_neg if gene and gene not in combined_pos]

        rationale_parts = [
            existing.get("rationale", "").strip(),
            str(panel.get("rationale", "")).strip(),
        ]
        combined_rationale = " ".join(part for part in rationale_parts if part).strip()

        if (
            combined_pos != existing.get("positive", [])
            or combined_neg != existing.get("negative", [])
            or (combined_rationale and combined_rationale != existing.get("rationale", "").strip())
        ):
            changed = True

        existing["positive"] = combined_pos
        existing["negative"] = combined_neg
        if combined_rationale:
            existing["rationale"] = combined_rationale

    merged = _normalise_marker_panels(merged)
    return merged, changed
# ---------------------------------------------------------------------------
# Metadata Inspector Tool
# ---------------------------------------------------------------------------


class MetadataInspectorInput(BaseModel):
    """Input schema for metadata inspection tool."""

    file_path: str = Field(description="Path to the data file to inspect")


class MetadataInspectorTool(BioToolBase):
    name = "metadata_inspector"
    description = "Inspect metadata from single-cell datasets"
    input_schema = MetadataInspectorInput


def _run_metadata_inspector(self, params: Dict[str, Any]) -> Dict[str, Any]:
    """Implementation of basic metadata inspection."""
    try:
        file_path = params["file_path"]
        if file_path.endswith(".h5ad"):
            adata = sc.read_h5ad(file_path)
        elif file_path.endswith(".h5"):
            adata = sc.read_10x_h5(file_path)
        else:
            raise ValueError(f"Unsupported file format: {file_path}")

        metadata = {
            "data_scale": {
                "n_cells": int(adata.n_obs),
                "n_genes": int(adata.n_vars),
            },
            "layers": list(adata.layers.keys()) if hasattr(adata, "layers") else [],
            "observation_columns": list(adata.obs.columns),
            "variable_columns": list(adata.var.columns),
        }

        obs_cols = metadata["observation_columns"]
        var_cols = metadata["variable_columns"]
        obs_preview = ", ".join(obs_cols[:5]) if obs_cols else "none"
        var_preview = ", ".join(var_cols[:5]) if var_cols else "none"
        summary_text = (
            f"Dataset contains {metadata['data_scale']['n_cells']:,} cells and {metadata['data_scale']['n_genes']:,} genes. "
            f"Observation columns ({len(obs_cols)}): {obs_preview}. Variable columns ({len(var_cols)}): {var_preview}."
        )

        overview_plot = _build_output_path(file_path, self.name, "overview", ".png")
        fig, ax = plt.subplots(figsize=(6, 4))
        categories = ["Cells", "Genes"]
        values = [metadata["data_scale"]["n_cells"], metadata["data_scale"]["n_genes"]]
        bars = ax.bar(categories, values, color=["#4C72B0", "#55A868"])
        ax.set_ylabel("Count (log10 scale)")
        ax.set_title("Dataset scale overview")
        ax.set_yscale("log")
        for bar, value in zip(bars, values):
            ax.text(
                bar.get_x() + bar.get_width() / 2,
                value,
                f"{value:,}",
                ha="center",
                va="bottom",
                fontsize=10,
            )
        text_lines = [
            f"Observation columns ({len(obs_cols)}): {obs_preview}",
            f"Variable columns ({len(var_cols)}): {var_preview}",
        ]
        fig.text(0.02, 0.02, "\n".join(text_lines), fontsize=9, va="bottom")
        fig.tight_layout()
        fig.savefig(overview_plot, dpi=150)
        plt.close(fig)

        return {
            "results": metadata,
            "summary_text": summary_text,
            "plots": {"overview": overview_plot},
        }

    except Exception as e:
        raise RuntimeError(f"Metadata inspection failed: {str(e)}")

def _run_cell_typing(self, params: Dict[str, Any]) -> Dict[str, Any]:
    """Implementation of cell type annotation using the Scanpy positive-marker scoring workflow.

    Each marker panel must provide a non-empty ``positive`` list compatible with Scanpy
    ``tl.score_genes``. The workflow computes a signature score per cell type using positive markers
    only and assigns the label corresponding to the maximum score for every cell. Marker panels come
    from the LLM recommender or user overlays and are filtered to the genes present
    in the dataset before scoring.
    """
    try:
        # Load data - handle different file formats
        input_path = Path(params["adata_id"])
        file_path = str(input_path)
        if file_path.endswith('.h5ad'):
            adata = sc.read_h5ad(file_path)
        elif file_path.endswith('.h5'):
            try:
                adata = sc.read_h5ad(file_path)
            except Exception:
                adata = sc.read_10x_h5(file_path)
        else:
            raise ValueError(f"Unsupported file format: {file_path}")
        
        # Prepare data for scoring without repeating preprocessing
        adata = adata.copy()
        if not adata.var_names.is_unique:
            logger.warning(
                "Detected duplicated gene names; making them unique for marker scoring."
            )
            adata.var_names_make_unique()
        adata.var["gene_symbols"] = adata.var_names.astype(str)
        if "log1p" in adata.layers:
            adata.X = adata.layers["log1p"].copy()

        output_dir = params.get("output_dir")

        marker_sets = _normalise_marker_panels(params.get("marker_sets"))
        marker_summary: Optional[str] = None
        marker_origin = "provided"

        if not marker_sets:
            recommendation = _recommend_marker_sets(
                self,
                tissue_type=params.get("tissue_type"),
                expected_types=params.get("expected_types"),
                question=params.get("question"),
                custom_markers=params.get("custom_markers"),
            )
            marker_sets = _normalise_marker_panels(recommendation["marker_sets"])
            marker_summary = recommendation.get("summary_text")
            marker_origin = "auto-recommended"
        marker_sets, overlay_applied = _merge_marker_panels(marker_sets, params.get("custom_markers"))
        if overlay_applied and "custom" not in marker_origin:
            marker_origin = f"{marker_origin}+custom"

        # Score cells using marker genes
        predicted_types = []
        confidence_scores = []

        var_name_set = set(map(str, adata.var_names))
        filtered_marker_sets: Dict[str, Dict[str, List[str]]] = {}

        for cell_type, markers in marker_sets.items():
            pos_unique = [gene for gene in dict.fromkeys(markers.get("positive", [])) if gene]
            neg_unique = [gene for gene in dict.fromkeys(markers.get("negative", [])) if gene]

            filtered_pos = [gene for gene in pos_unique if gene in var_name_set]
            filtered_neg = [gene for gene in neg_unique if gene in var_name_set and gene not in filtered_pos]

            dropped_pos = sorted(set(pos_unique) - set(filtered_pos))
            if dropped_pos:
                logger.warning(
                    "Dropping %d positive marker genes for %s that are absent from the dataset: %s",
                    len(dropped_pos),
                    cell_type,
                    ", ".join(dropped_pos[:8]) + ("..." if len(dropped_pos) > 8 else ""),
                )

            dropped_neg = sorted(set(neg_unique) - set(filtered_neg))
            if dropped_neg:
                logger.warning(
                    "Dropping %d negative marker genes for %s that are absent from the dataset: %s",
                    len(dropped_neg),
                    cell_type,
                    ", ".join(dropped_neg[:8]) + ("..." if len(dropped_neg) > 8 else ""),
                )

            if not filtered_pos:
                logger.warning(
                    "Skipping cell type %s because no positive markers are present after filtering.",
                    cell_type,
                )
                continue

            filtered_marker_sets[cell_type] = {
                "positive": filtered_pos,
                "negative": filtered_neg,
                "rationale": markers.get("rationale", ""),
            }

        if not filtered_marker_sets:
            raise RuntimeError("No valid marker genes overlap with the dataset; cell typing cannot proceed.")

        marker_sets = filtered_marker_sets

        score_cols: List[str] = []
        for cell_type, markers in marker_sets.items():
            pos_markers = markers.get("positive", [])
            neg_markers = markers.get("negative", [])
            logger.info(
                "Using %d positive and %d negative markers for %s.",
                len(pos_markers),
                len(neg_markers),
                cell_type,
            )

            score_name = f"score_{cell_type}"
            sc.tl.score_genes(
                adata,
                gene_list=pos_markers,
                score_name=score_name,
                use_raw=False,
            )
            if neg_markers:
                neg_score_name = f"score_{cell_type}_neg"
                sc.tl.score_genes(
                    adata,
                    gene_list=neg_markers,
                    score_name=neg_score_name,
                    use_raw=False,
                )
                adata.obs[score_name] = adata.obs[score_name] - adata.obs[neg_score_name]
                del adata.obs[neg_score_name]
            score_cols.append(score_name)

        scores = adata.obs[score_cols].values
        max_indices = np.argmax(scores, axis=1)
        max_scores = np.take_along_axis(scores, max_indices[:, None], axis=1).ravel()
        max_types = np.array(list(marker_sets.keys()))[max_indices]

        score_min = float(max_scores.min())
        score_max = float(max_scores.max())
        if score_max > score_min:
            confidence_scores = (max_scores - score_min) / (score_max - score_min)
        else:
            confidence_scores = np.ones_like(max_scores)

        predicted_types = max_types
        
        # Create visualization artifacts based on existing embeddings
        umap_plot_file = _build_output_path(input_path, self.name, "umap", ".png", output_dir=output_dir)
        distribution_plot_file = _build_output_path(input_path, self.name, "distribution", ".png", output_dir=output_dir)

        embedding_key = None
        for candidate in ("X_umap", "X_tsne"):
            if candidate in adata.obsm:
                embedding_key = candidate
                break

        umap_coords = adata.obsm.get(embedding_key) if embedding_key else None
        if umap_coords is None:
            raise RuntimeError(
                "Preprocessing pipeline must provide a 2D embedding (UMAP or t-SNE) for visualization."
            )

        unique_types = np.unique(predicted_types)
        cmap = plt.colormaps.get_cmap("tab20")
        colors = cmap(np.linspace(0, 1, len(unique_types) or 1))
        fig, ax = plt.subplots(figsize=(6, 5))
        for idx, cell_type in enumerate(unique_types):
            mask = predicted_types == cell_type
            ax.scatter(
                umap_coords[mask, 0],
                umap_coords[mask, 1],
                s=2,
                label=str(cell_type),
                alpha=1.0,
                color=colors[idx],
                edgecolors="none",
            )
        ax.set_xlabel("Dim1")
        ax.set_ylabel("Dim2")
        ax.set_title("Cell type embedding")
        if len(unique_types) > 0:
            legend_columns = 1
            if len(unique_types) > 24:
                legend_columns = 3
            elif len(unique_types) > 12:
                legend_columns = 2
            ax.legend(
                loc="center left",
                bbox_to_anchor=(1.02, 0.5),
                frameon=False,
                markerscale=1.5,
                fontsize=8,
                ncol=legend_columns,
            )
            right_margin = 0.78
            if legend_columns == 2:
                right_margin = 0.72
            elif legend_columns >= 3:
                right_margin = 0.66
            fig.subplots_adjust(right=right_margin)
        save_figure(fig, umap_plot_file, tight_layout=False)

        counts = pd.Series(predicted_types).value_counts().sort_index()
        fig, ax = plt.subplots(figsize=(6, 4))
        counts.plot(kind="bar", ax=ax, color="#4C72B0")
        ax.set_xlabel("Cell type")
        ax.set_ylabel("Cell count")
        ax.set_title("Predicted cell type distribution")
        fig.tight_layout()
        fig.savefig(distribution_plot_file, dpi=150)
        plt.close(fig)

        # Save results
        adata.obs[params["output_key"]] = predicted_types
        output_file = _persist_adata(adata, input_path, output_dir=output_dir)

        total_cells = len(predicted_types)
        unique_counts = counts.sort_values(ascending=False)
        top_items = unique_counts.head(3)
        top_summary = ", ".join(
            f"{cell_type}: {count} ({(count / total_cells * 100) if total_cells else 0:.1f}%)"
            for cell_type, count in top_items.items()
        ) if total_cells else "None"
        summary_text_parts = [
            f"Annotated {total_cells:,} cells into {len(unique_counts)} cell types.",
            f"Top populations: {top_summary}.",
            f"Annotated data saved to {output_file}.",
        ]
        if marker_summary:
            summary_text_parts.insert(1, marker_summary)
        else:
            summary_text_parts.insert(1, f"Marker panels {marker_origin}.")
        summary_text = " ".join(summary_text_parts)

        return {
            "predicted_types": predicted_types.tolist(),
            "confidence_scores": confidence_scores.tolist(),
            "plots": {
                "celltype_distribution": distribution_plot_file,
                "umap": umap_plot_file,
            },
            "output_data": output_file,
            "marker_sets": marker_sets,
            "summary_text": summary_text,
        }
        
    except Exception as e:
        raise RuntimeError(f"Cell typing failed: {str(e)}")


# ---------------------------------------------------------------------------
# Spatial Domain Tool
# ---------------------------------------------------------------------------


class SpatialDomainInput(BaseModel):
    """Input schema for spatial domain detection."""

    adata_id: str = Field(description="Data object handle")
    method: str = Field(
        default="leiden",
        description="Domain detection method: leiden/louvain/kmeans",
    )
    resolution: float = Field(
        default=1.0,
        gt=0,
        description="Resolution parameter when using graph-based methods.",
    )
    n_clusters: Optional[int] = Field(
        default=None,
        gt=1,
        description="Number of clusters when method=kmeans.",
    )
    coord_type: str = Field(
        default="generic",
        description="Coordinate type when constructing spatial neighbors.",
    )
    n_neighbors: Optional[int] = Field(
        default=6,
        gt=0,
        description="Number of spatial neighbors if building graph.",
    )
    radius: Optional[float] = Field(
        default=None,
        gt=0,
        description="Spatial radius used for neighbor graph when provided.",
    )
    delaunay: bool = Field(
        default=True,
        description="Whether to compute Delaunay triangulation when applicable.",
    )
    set_diag: bool = Field(
        default=True,
        description="Whether to include self connections on diagonal.",
    )
    neighbors_key: str = Field(
        default="spatial",
        description="Key for spatial neighbors to use when detecting domains.",
    )
    domain_key: Optional[str] = Field(
        default=None,
        description="Observation column name to store detected domains.",
    )
    use_rep: Optional[str] = Field(
        default=None,
        description="AnnData representation to use (e.g., X_pca).",
    )
    n_comps: Optional[int] = Field(
        default=None,
        gt=0,
        description="Number of components when reducing dimensionality for domain detection.",
    )
    random_state: Optional[int] = Field(
        default=None,
        description="Random seed passed to Squidpy for reproducibility.",
    )
    output_dir: Optional[str] = Field(
        default=None,
        description="Optional directory to persist generated artifacts.",
    )
    expression_weight: Optional[float] = Field(
        default=0.3,
        ge=0.0,
        le=1.0,
        description="Blend factor for expression-based neighbors (0=spatial only).",
    )
    expression_n_neighbors: Optional[int] = Field(
        default=None,
        gt=0,
        description="Neighbor count when constructing expression graph.",
    )


class SpatialDomainTool(BioToolBase):
    name = "spatial_domain"
    description = "Detect spatial domains using Squidpy spatial graph methods"
    input_schema = SpatialDomainInput


def _run_spatial_domain(self, params: Dict[str, Any]) -> Dict[str, Any]:
    """Detect spatial domains leveraging Squidpy's spatial_domain API."""
    try:
        input_path = Path(params["adata_id"])
        file_path = str(input_path)
        if file_path.endswith(".h5ad"):
            adata = sc.read_h5ad(file_path)
        elif file_path.endswith(".h5"):
            adata = sc.read_10x_h5(file_path)
        else:
            raise ValueError(f"Unsupported file format: {file_path}")

        if "spatial" not in adata.obsm:
            raise ValueError("AnnData object must contain spatial coordinates in adata.obsm['spatial'].")

        neighbors_key = params.get("neighbors_key") or "spatial"
        coord_type = params.get("coord_type") or "generic"
        connectivity_key = f"{neighbors_key}_connectivities"
        distance_key = f"{neighbors_key}_distances"
        output_dir = params.get("output_dir")
        raw_weight = params.get("expression_weight")
        expression_weight = float(raw_weight) if raw_weight is not None else 0.0
        expression_weight = max(0.0, min(1.0, expression_weight))

        if connectivity_key not in adata.obsp:
            neighbor_kwargs: Dict[str, Any] = {
                "coord_type": coord_type,
                "delaunay": params.get("delaunay", True),
                "set_diag": params.get("set_diag", True),
                "key_added": neighbors_key,
            }
            if params.get("n_neighbors") is not None:
                neighbor_kwargs["n_neighs"] = int(params["n_neighbors"])
            if params.get("radius") is not None:
                neighbor_kwargs["radius"] = float(params["radius"])

            sq.gr.spatial_neighbors(adata, **neighbor_kwargs)

        adata = adata.copy()
        connectivities = adata.obsp.get(connectivity_key)
        if connectivities is None:
            raise RuntimeError("Spatial connectivity matrix unavailable for spatial domain detection.")

        distances = adata.obsp.get(distance_key)
        neighbors_metadata = {
            "connectivities": connectivities,
            "distances": distances,
            "params": {
                "type": "spatial",
                "coord_type": coord_type,
                "key": connectivity_key,
            },
        }
        adata.uns["neighbors"] = neighbors_metadata
        adata.obsp["connectivities"] = connectivities
        if distances is not None:
            adata.obsp["distances"] = distances

        if expression_weight > 0:
            expr_neighbors_key = f"{neighbors_key}_expression"
            expr_neighbors_kwargs: Dict[str, Any] = {
                "n_neighbors": int(params.get("expression_n_neighbors") or params.get("n_neighbors") or 6),
                "key_added": expr_neighbors_key,
            }

            if params.get("use_rep"):
                expr_neighbors_kwargs["use_rep"] = params["use_rep"]
            else:
                default_n_pcs = int(params.get("n_comps") or min(max(adata.n_vars - 1, 2), 50))
                if "X_pca" not in adata.obsm or adata.obsm["X_pca"].shape[1] < default_n_pcs:
                    sc.pp.pca(adata, n_comps=default_n_pcs)
                expr_neighbors_kwargs["n_pcs"] = default_n_pcs

            previous_neighbors = adata.uns.pop("neighbors", None)
            try:
                sc.pp.neighbors(adata, **expr_neighbors_kwargs)
            finally:
                adata.uns.pop("neighbors", None)
                if previous_neighbors is not None:
                    adata.uns["neighbors"] = previous_neighbors

            expr_connectivities = adata.obsp.get(f"{expr_neighbors_key}_connectivities")
            if expr_connectivities is None:
                raise RuntimeError("Expression neighbors could not be computed for spatial domain detection.")

            connectivities = sparse.csr_matrix(connectivities)
            expr_connectivities = sparse.csr_matrix(expr_connectivities)
            connectivities = connectivities.maximum(connectivities.transpose())
            expr_connectivities = expr_connectivities.maximum(expr_connectivities.transpose())
            combined = ((1.0 - expression_weight) * connectivities) + (expression_weight * expr_connectivities)
            adata.obsp["connectivities"] = combined
            adata.uns["neighbors"] = neighbors_metadata
            adata.uns["neighbors"]["connectivities"] = combined
            adata.uns["neighbors"]["params"]["expression_weight"] = expression_weight
            adata.obsp.pop(f"{expr_neighbors_key}_connectivities", None)
            adata.obsp.pop(f"{expr_neighbors_key}_distances", None)
            connectivities = combined

        method = (params.get("method") or "leiden").lower()
        resolution = float(params.get("resolution", 1.0))
        domain_key = params.get("domain_key") or f"spatial_{method}_domain"

        if method in {"leiden", "louvain"}:
            key_added = domain_key
            if method == "leiden":
                sc.tl.leiden(
                    adata,
                    resolution=resolution,
                    key_added=key_added,
                    flavor="igraph",
                    n_iterations=2,
                    directed=False,
                )
            else:
                sc.tl.louvain(adata, resolution=resolution, key_added=key_added)
        elif method == "kmeans":
            n_clusters = params.get("n_clusters") or 6
            if n_clusters < 2:
                raise ValueError("kmeans spatial domain detection requires n_clusters >= 2")
            coords = adata.obsm["spatial"]
            if params.get("n_comps") is not None and params.get("use_rep"):
                rep_key = params["use_rep"]
                if rep_key in adata.obsm:
                    coords = adata.obsm[rep_key]
                elif rep_key in adata.layers:
                    coords = adata.layers[rep_key]
            try:
                from sklearn.cluster import KMeans
            except ImportError as exc:
                raise RuntimeError("kmeans spatial domain detection requires scikit-learn to be installed.") from exc
            kmeans = KMeans(n_clusters=int(n_clusters), random_state=int(params.get("random_state") or 0), n_init="auto")
            labels = kmeans.fit_predict(coords)
            adata.obs[domain_key] = labels.astype(str)
        else:
            raise ValueError(f"Unsupported spatial domain method: {params['method']}")

        if domain_key not in adata.obs:
            raise RuntimeError("Spatial domain detection did not produce the expected observation column.")

        domains = adata.obs[domain_key].astype(str)
        domain_counts = domains.value_counts().sort_index()
        domain_sizes = domain_counts.to_dict()
        domain_counts_by_size = domain_counts.sort_values(ascending=False)

        coords = adata.obsm["spatial"]
        plot_file = _build_output_path(
            input_path,
            self.name,
            "domains",
            ".png",
            output_dir=output_dir,
        )
        unique_domains = domain_counts.index.tolist()
        cmap = plt.colormaps.get_cmap("tab20")
        colors = cmap(np.linspace(0, 1, len(unique_domains) or 1))
        fig, ax = plt.subplots(figsize=(5.5, 5))
        for idx, label in enumerate(unique_domains):
            mask = adata.obs[domain_key] == label
            ax.scatter(
                coords[mask, 0],
                coords[mask, 1],
                s=35,
                color=colors[idx],
                label=str(label),
                alpha=0.85,
                edgecolors="none",
            )
        ax.set_title(f"Spatial domains ({method})")
        ax.set_xlabel("spatial-x")
        ax.set_ylabel("spatial-y")
        ax.invert_yaxis()
        if len(unique_domains) <= 12:
            ax.legend(loc="best", frameon=False)
        fig.tight_layout()
        fig.savefig(plot_file, dpi=150)
        plt.close(fig)

        distribution_plot = _build_output_path(
            input_path,
            self.name,
            "domain_distribution",
            ".png",
            output_dir=output_dir,
        )
        fig, ax = plt.subplots(figsize=(6, 4))
        domain_counts_by_size.plot(kind="bar", ax=ax, color="#9370DB")
        ax.set_xlabel("Domain")
        ax.set_ylabel("Cell count")
        ax.set_title("Spatial domain composition")
        fig.tight_layout()
        fig.savefig(distribution_plot, dpi=150)
        plt.close(fig)

        try:
            from sklearn.metrics import silhouette_score

            if coords.shape[0] > 1 and len(unique_domains) > 1:
                silhouette = float(
                    silhouette_score(coords, adata.obs[domain_key].astype(str), metric="euclidean")
                )
            else:
                silhouette = 0.0
        except Exception:
            silhouette = 0.0

        domain_table = _build_output_path(
            input_path,
            self.name,
            "assignments",
            ".csv",
            output_dir=output_dir,
        )
        adata.obs[[domain_key]].to_csv(domain_table, index=True)

        output_file = _persist_adata(adata, input_path, output_dir=output_dir)

        total_cells = adata.n_obs
        top_domains = domain_counts_by_size.head(3)
        top_summary = (
            ", ".join(
                f"{label}: {count} ({(count / total_cells * 100) if total_cells else 0:.1f}%)"
                for label, count in top_domains.items()
            )
            if not top_domains.empty
            else "None"
        )

        summary_text = (
            f"Spatial domain detection ({method}) identified {len(domain_sizes)} domains across {total_cells:,} spots. "
            f"Top domains: {top_summary}. Assignments saved to {domain_table}. "
            f"Plots saved to {plot_file} and {distribution_plot}."
        )
        if expression_weight > 0:
            summary_text += f" Expression contribution weight: {expression_weight:.2f}."

        return {
            "output_data": output_file,
            "domain_assignments": domain_table,
            "domain_key": domain_key,
            "domains": {
                "n_domains": int(len(domain_sizes)),
                "sizes": {str(k): int(v) for k, v in domain_sizes.items()},
                "silhouette_score": silhouette,
                "expression_weight": expression_weight,
            },
            "plots": {
                "spatial_domains": plot_file,
                "domain_distribution": distribution_plot,
            },
            "summary_text": summary_text,
        }

    except Exception as e:
        raise RuntimeError(f"Spatial domain detection failed: {str(e)}")


# Attach implementations to classes
PreprocessPipelineTool._run = _run_preprocess_pipeline
DEAnalysisTool._run = _run_de_analysis
CellTypingTool._run = _run_cell_typing
SpatialDomainTool._run = _run_spatial_domain
MetadataInspectorTool._run = _run_metadata_inspector
BatchCorrectionTool._run = _run_batch_correction
SpatialGenePlotTool._run = _run_spatial_gene_plot
UMAPGenePlotTool._run = _run_umap_gene_plot
PseudotimeTool._run = _run_pseudotime
CellCommunicationTool._run = _run_cell_communication
