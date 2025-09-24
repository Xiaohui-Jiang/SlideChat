## 09/19/2025 - 09/26/2025

### General  
- [ ] Download **QuPath** and **Fiji** and briefly review their available functions.  
- [ ] Check the files and processing methods in the provided link. For Xenium reference, see:  
  - [10x Genomics official Xenium outputs](https://www.10xgenomics.com/support/software/xenium-onboard-analysis/latest/analysis/xoa-output-understanding-outputs)  
  - [10x public Xenium datasets](https://www.10xgenomics.com/resources/datasets?query=xenium)  
  - [Scanpy/Squidpy workflow for Xenium](https://squidpy.readthedocs.io/en/stable/notebooks/tutorials/tutorial_xenium.html)  
- [ ] Review the related works. Each person will take responsibility for one paper:  
  - **Tianhao**: [SpatialAgent](https://www.biorxiv.org/content/10.1101/2025.04.03.646459v1.full-text)  
  - **Jiacheng**: [CellAgentChat](https://pubmed.ncbi.nlm.nih.gov/40316422/)  
  - **Xiaohui**: [CellAgent](https://www.biorxiv.org/content/10.1101/2024.05.13.593861v4)  

### Tianhao  
- [ ] Prepare for file management. Create a dedicated folder outside the GitLab repository to manage files. Plan to store images together with other preprocessed files related to each image. At this stage, assume files are local.  
Proposed data file structure:
/data/slidechat_files/
  ├─ slide_001/
  │   ├─ raw/
  │   │   ├─ slide_001.svs
  │   │   ├─ cells.csv
  │   │   ├─ transcripts.csv
  │   │   └─ boundaries.csv
  │   ├─ preprocessed/
  │   │   ├─ thumbnail.png
  │   │   ├─ roi_1_crop.png
  │   │   └─ roi_2_crop.png
  │   ├─ analysis/
  │   │   ├─ roi_1_metrics.json
  │   │   ├─ roi_2_metrics.json
  │   │   ├─ niche_annotation.json
  │   │   └─ cci_results.json
  │   └─ metadata.json
  │
  └─ slide_002/
      └─ ...
      
Assumed data json file:
{
  "slideId": "slide_001",
  "uploadedAt": "2025-09-25T14:00:00Z",
  "raw": {
    "image": "raw/slide_001.svs",
    "xeniumOutputs": {
      "cells": "raw/cells.csv",
      "transcripts": "raw/transcripts.csv",
      "boundaries": "raw/boundaries.csv"
    }
  },
  "rois": [
    {
      "roiId": "roi_1",
      "name": "Tumor margin",
      "geometry": "polygon",
      "crop": "preprocessed/roi_1_crop.png",
      "analysis": [
        "analysis/roi_1_metrics.json"
      ]
    },
    {
      "roiId": "roi_2",
      "name": "Stroma region",
      "geometry": "rect",
      "crop": "preprocessed/roi_2_crop.png",
      "analysis": [
        "analysis/roi_2_metrics.json",
        "analysis/niche_annotation.json"
      ]
    }
  ]
}

- [ ] Adjust the display logic: place the thumbnail on the far left, enlarge the image display area by default, and reduce the chat area.  
- [ ] Enable storing multiple ROIs, display them in the lower-left area, and allow naming of each ROI.  

### Jiacheng  
- [ ] Check how to call APIs using LangChain or similar methods to execute existing functions, and provide a toy example.  
- [ ] Ensure that the function structure is maintained properly for future extension.  

### Xiaohui  
- [ ] Develop a preprocessing workflow compatible with various downstream tasks.  
- [ ] Check how to enable user-participatory programming for backend data analysis, and provide an example.  