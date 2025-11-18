# 📊 Multiagent Analysis Report Generation Guide

## Overview

Every analysis performed by the Multiagent system automatically generates three types of reports to help you understand and share your results.

## 📄 Report Types

### 1. PDF Report (figures.pdf)
**What it contains:**
- All visualizations and figures generated during analysis
- UMAP/t-SNE plots
- Heatmaps and clustering results
- Spatial plots (if applicable)
- Quality control metrics plots
- Differential expression volcano plots

**Best for:**
- Presentations and publications
- Quick visual overview of results
- Sharing with collaborators who want to see the figures

**How to access:**
Click the "📄 Download PDF" button in the results section.

### 2. Text Report (report.txt)
**What it contains:**
- Analysis summary and interpretation
- Step-by-step methodology
- Key findings and statistics
- Parameter settings used
- List of generated figures with descriptions
- Recommendations for next steps

**Structure:**
```
Analysis Report
===============
Command: [Your analysis command]
Date: [Timestamp]

Analysis Plan
-------------
1. Step 1: [Tool name and description]
2. Step 2: [Tool name and description]
...

Results
-------
[Detailed findings for each step]

Generated Figures
-----------------
- figure1.png: [Description]
- figure2.png: [Description]
...

Summary
-------
[Overall interpretation]
```

**Best for:**
- Understanding the methodology
- Reading detailed findings
- Including in supplementary materials
- Documentation purposes

**How to access:**
Click the "📝 Download Report" button in the results section.

### 3. Analysis Log (log.json)
**What it contains:**
- Complete execution log in JSON format
- Input parameters for each tool
- Output data from each step
- Tool execution metadata
- Error messages (if any)
- Timestamps for each operation

**Structure:**
```json
{
  "analysis_id": "uuid",
  "timestamp": "2025-11-14T...",
  "command": "Analyze cell types...",
  "steps": [
    {
      "tool": "PreprocessPipeline",
      "input": {...},
      "output": {...},
      "figures": [...],
      "timestamp": "..."
    },
    ...
  ]
}
```

**Best for:**
- Reproducibility
- Debugging
- Programmatic access to results
- Advanced users who want raw data

**How to access:**
Click the "📊 Download Log" button in the results section.

## 🎯 Report Generation Process

### Automatic Generation
Reports are generated automatically at the end of each analysis:

1. **During Analysis:**
   - Each tool saves its figures to the job results directory
   - Tool outputs are logged with metadata
   - Progress is tracked in real-time

2. **After Completion:**
   - Text report is rendered with all findings
   - All figures are collected and combined into PDF
   - Log is serialized to JSON format
   - Summary is extracted for quick preview

3. **Available in UI:**
   - Summary displayed in the web interface
   - Download buttons appear for all three report types
   - Reports are stored for future access

### Storage Location
Reports are stored in:
```
langchain_multiagent_forfront/job_results/{job_id}/
├── report.txt          # Text report
├── figures.pdf         # Combined PDF of all figures
├── log.json           # Detailed execution log
└── figures/           # Individual figure files
    ├── preprocess_umap.png
    ├── celltyping_results.png
    └── ...
```

## 📈 What's Included in Each Report

### For Cell Type Analysis:
- **PDF:** UMAP colored by cell types, marker gene expression heatmaps
- **Text Report:** Cell type proportions, marker genes for each type, clustering metrics
- **Log:** Cell type assignments, clustering parameters, marker gene scores

### For Differential Expression:
- **PDF:** Volcano plots, MA plots, top DE genes heatmap
- **Text Report:** Number of DE genes, top up/down-regulated genes, pathway enrichment
- **Log:** Full DE gene list with statistics, fold changes, p-values

### For Spatial Analysis:
- **PDF:** Spatial plots with cell types, neighborhood analysis, spatial domains
- **Text Report:** Spatial statistics, interaction scores, domain descriptions
- **Log:** Spatial coordinates, neighborhood matrices, domain assignments

### For Quality Control:
- **PDF:** QC violin plots, scatter plots (genes vs counts, mito%)
- **Text Report:** QC metrics summary, filtering thresholds, cells/genes retained
- **Log:** Per-cell QC values, filtering criteria, outlier detection

## 🔍 How to Interpret Reports

### Reading the Summary
The summary shown in the web interface provides:
- **Quick overview** of what was analyzed
- **Key findings** in plain language
- **Number of cells/genes** processed
- **Main cell types** identified (if applicable)

### Using the PDF Report
1. Open in any PDF viewer
2. Figures are ordered by analysis step
3. Each figure has a descriptive filename
4. Use for presentations or publications

### Using the Text Report
1. Open in any text editor
2. Read the Analysis Plan to understand methodology
3. Check Results section for detailed findings
4. Review Summary for overall interpretation

### Using the Analysis Log
1. Open in a text editor or JSON viewer
2. Parse programmatically with Python/R
3. Extract specific data points you need
4. Use for reproducibility or troubleshooting

## 💡 Tips for Best Results

### Before Analysis:
- Use descriptive analysis commands
- Specify what you want to see in the results
- Mention specific genes or cell types of interest

### After Analysis:
- Review the summary first for quick overview
- Download PDF for visual inspection
- Read text report for detailed methodology
- Keep log for reproducibility

### Example Commands for Good Reports:

**Basic:**
```
Analyze cell types in this PBMC sample
```

**Better:**
```
Identify cell types in this PBMC sample, with focus on T cell subtypes and their marker genes
```

**Best:**
```
Perform comprehensive analysis of this PBMC sample: identify major cell types with emphasis on T cell subpopulations (CD4+, CD8+, regulatory), analyze their proportions, and identify differentially expressed genes between activated and resting T cells
```

## 🚀 Advanced Usage

### Customizing Reports
To customize report generation, you can modify:
- `report_utils.py` - Report rendering functions
- `agent.py` - Summary generation logic
- `api.py` - Result formatting

### Batch Analysis
For multiple samples:
1. Submit separate jobs for each sample
2. Download reports for each job
3. Compare results across samples
4. Combine figures manually if needed

### Programmatic Access
Use the API to access reports:
```python
import requests

# Get job result
response = requests.get(f'http://localhost:5050/api/multiagent/result/{job_id}')
result = response.json()

# Download reports
pdf_url = f'http://localhost:5050/api/multiagent/download/{job_id}/pdf'
report_url = f'http://localhost:5050/api/multiagent/download/{job_id}/report'
log_url = f'http://localhost:5050/api/multiagent/download/{job_id}/log'
```

## 📚 Report Examples

### Example 1: Cell Type Analysis Report

**Summary:**
```
Analysis of PBMC sample identified 8 major cell types:
- CD4+ T cells (35%)
- CD8+ T cells (28%)
- B cells (15%)
- NK cells (10%)
- Monocytes (8%)
- Dendritic cells (3%)
- Platelets (1%)

Key marker genes successfully validated.
Generated 5 visualizations including UMAP and heatmaps.
```

**Figures in PDF:**
1. QC metrics (violin plots)
2. UMAP colored by cell type
3. Marker gene heatmap
4. Cell type proportions (bar chart)
5. Top marker genes (dot plot)

### Example 2: Spatial Analysis Report

**Summary:**
```
Spatial analysis identified 4 distinct tissue domains:
- Immune infiltration zone
- Tumor core
- Stromal region
- Necrotic area

Cell-cell interaction analysis revealed:
- Strong T cell - Macrophage interactions in infiltration zone
- Cancer cells show spatial organization in core
- Fibroblasts enriched in stromal region
```

**Figures in PDF:**
1. Spatial plot colored by cell type
2. Spatial domains overlay
3. Neighborhood enrichment heatmap
4. Interaction network graph
5. Gene expression spatial plots

## 🛠️ Troubleshooting

**Problem:** PDF report is empty
- **Solution:** Check if figures were generated (look in job_results folder)

**Problem:** Text report is very short
- **Solution:** Analysis may have failed early; check log for errors

**Problem:** Can't download reports
- **Solution:** Ensure job status is "completed", refresh the page

**Problem:** Reports don't contain expected figures
- **Solution:** Analysis command may need to be more specific about what you want

## 📞 Support

If you have questions about reports:
1. Check the analysis log for any error messages
2. Review the text report methodology section
3. Ensure all required tools completed successfully
4. Contact support with your job ID

---

**Generated reports help you:**
- ✅ Understand what the analysis did
- ✅ Share results with collaborators
- ✅ Reproduce analyses later
- ✅ Include in publications
- ✅ Troubleshoot any issues

Happy analyzing! 🎉
