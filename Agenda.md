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
```
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
```
Assumed data json file:
```
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
```

- [x] Adjust the display logic: place the thumbnail on the far left, enlarge the image display area by default, and reduce the chat area.  
- [x] Enable storing multiple ROIs, display them in the lower-left area, and allow naming of each ROI.  
- [x] Debug and fix analyze button functionality - identified ROI selection issue and implemented auto-selection
- [x] Implement comprehensive debugging system with console logging for analyze workflow
- [x] Fix API communication issues between frontend and backend for chat/analyze functionality
- [ ] Test analyze functionality end-to-end with actual ROI analysis
- [ ] Implement proper error handling for ROI analysis failures
- [ ] Add server-side logging for better request tracing  

### Jiacheng  
- [x] Check how to call APIs using LangChain or similar methods to execute existing functions, and provide a toy example.
- [x] Ensure that the function structure is maintained properly for future extension.
- [x] Implement LangChain integration with OpenAI GPT for biological slide analysis
- [x] Create extensible function registry system with 4 analysis functions
- [x] Build comprehensive testing suite and demo scripts
- [x] Fix LangChain schema validation issues and OpenAI function calling integration
- [x] Refactor from manual schema conversion to LangChain's tool() wrapper system
- [x] Implement proper snake_case parameter naming for OpenAI API compatibility
- [x] Complete server architecture update with direct LangChain tool integration


### Xiaohui  
- [x] Develop a preprocessing workflow compatible with various downstream tasks.  
- [ ] Check how to enable user-participatory programming for backend data analysis, and provide an example.

### Recent Progress (September 24, 2025)
**Completed:**
- ✅ Fixed SlideChat application startup issues (npm scripts, ES modules)
- ✅ Implemented 4-column grid layout with thumbnails on left, enlarged image area
- ✅ Built comprehensive ROI management system with persistence
- ✅ Added ROI naming dialog and lower-left display panel
- ✅ Debugged analyze button functionality - root cause: ROI selection workflow
- ✅ Added comprehensive debugging with step-by-step console logging
- ✅ Fixed API file corruption issues and TypeScript compilation errors
- ✅ **LangChain Integration Complete**: Implemented AI-powered biological analysis system
  - Function registry with 4 analysis functions (getSlideInfo, createROI, analyzeBiologicalFeatures, findSimilarSlides)
  - OpenAI GPT integration with fallback system for operation without API keys
  - Comprehensive testing suite with demo scripts
  - TypeScript frontend API client and testing UI component

**Technical Issues Resolved:**
- ROI analyze button required pre-selection, now auto-selects ROI on analyze
- Frontend-backend API communication flow now properly traced with debugging
- Server running on port 5050, client on port 3000 with proper proxy configuration
- LangChain dependencies installed and core system files restored after rollback


**Poentail Issue:**
 - ROI is not temperarily stored in Server RAM while the server is running. When the server is done or stopped, Memory lost.
 - Still not too clear about the workflow. And we may need the real example to see how it works
 - Data file Storage Structure is not clear.

**Next Steps:**
- Verify complete analyze workflow from ROI creation to server response
- Implement actual pathology analysis logic (CD68 cell density, immune patterns)
- Add error handling for analyze failures
- Test with real .svs files and Xenium data integration
- Complete LangChain server integration (update index.js with new routes)
- Test end-to-end LangChain functionality with frontend components
- **Implement chat memory persistence**: Add conversation history storage to maintain context during chat sessions (currently lost when server restarts)  