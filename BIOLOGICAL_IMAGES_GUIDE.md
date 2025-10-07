# Biological Image Analysis with SlidChat

## 🔬 Overview

Your SlidChat application has been enhanced to handle biological image formats commonly used in pathology and spatial transcriptomics research. The interface now provides a comprehensive workspace for managing projects, analyzing images, and interacting with AI-powered analysis tools.

## 🖼️ Supported Formats

### Biological Formats
- **SVS** (Aperio whole slide images) - 🔬
- **TIF/TIFF** (Tagged Image Format) - 🧬  
- **OME-TIFF** (Open Microscopy Environment) - 🧬
- **NDPI** (Hamamatsu) - 🏥
- **VSI** (Olympus) - 🔍
- **SCN** (Leica) - 📊

### Standard Formats
- JPG, PNG, BMP - 🖼️

## 🏗️ Interface Layout

### 1. Project Panel (Left)
- **Projects Tab**: Create and manage projects
- **Images Tab**: View project images with format indicators
- **Add Images**: Upload biological images with metadata

### 2. Image Viewer (Center Top)
- **Viewer Tab**: Interactive image display with zoom/pan
- **Code Canvas**: Future development for visual queries
- **ROI Tools**: Draw, select, and manage regions of interest

### 3. Log & Results (Center Bottom)
- **Log Tab**: System actions and upload progress
- **Results Tab**: Analysis outputs (cell counts, classifications)

### 4. Chat Panel (Right)
- Interactive agent for biological analysis
- Context-aware responses
- Integration with image analysis tools

## 🚀 Workflow for Biological Images

### Step 1: Project Setup
1. Open http://localhost:3000
2. Click "Create Project" 
3. Name your project (e.g., "Kidney Pathology Analysis")
4. Add description for context

### Step 2: Image Upload
1. Select your project
2. Switch to "Images" tab
3. Click "Add Biological Images"
4. Select your TIF/SVS files
5. Wait for upload and processing

### Step 3: Image Analysis
1. Select an uploaded image
2. Draw ROIs on areas of interest
3. Name your ROIs descriptively
4. Click "Analyze" for automated analysis

### Step 4: AI-Powered Chat
Use the chat panel for:
- "Analyze the immune infiltration in ROI_1"
- "What cell types are present in this tissue?"
- "Compare the staining patterns between ROIs"
- "Calculate cell density in the selected region"

## 🔧 Backend Features

### Enhanced Upload Processing
- **Format Detection**: Automatic recognition of biological formats
- **Metadata Extraction**: File size, dimensions, format info
- **Thumbnail Generation**: Preview images for large files
- **Error Handling**: Comprehensive upload validation

### New API Endpoints
- `GET /api/supported-formats` - List supported formats
- `GET /api/images/:id/metadata` - Image metadata
- `GET /api/images/:id/processing-status` - Processing status
- `POST /api/images/:id/rois` - Create ROIs for images

### Biological Image Metadata
```json
{
  "dimensions": { "width": 46000, "height": 32914 },
  "pixelSize": { "x": 0.25, "y": 0.25, "unit": "µm" },
  "magnification": "20x",
  "channels": ["DAPI", "FITC", "TRITC", "Cy5"],
  "tissueType": "kidney",
  "staining": "Immunofluorescence",
  "scanner": "Xenium Analyzer"
}
```

## 🧪 Demo Data

The application includes sample biological images:
- **Xenium_HE.ome.tiff**: H&E stained kidney tissue
- **Xenium_protein.ome.tiff**: Multi-channel protein markers
- **lung_sample.svs**: Lung tissue pathology

## 💡 Tips for Biological Images

1. **Large Files**: SVS/TIF files can be large (GB+). Upload may take time.
2. **ROI Naming**: Use descriptive names like "tumor_region_1", "normal_tissue"
3. **Analysis Context**: Provide tissue type and staining info to the chat agent
4. **Metadata**: Check the metadata for pixel size and magnification info
5. **Multiple Channels**: For multi-channel images, specify which channel to analyze

## 🔬 Example Analysis Workflows

### Pathology Workflow
1. Upload H&E stained tissue slides (SVS)
2. Draw ROIs around tumor and normal regions
3. Ask: "Compare cellular morphology between tumor and normal ROIs"
4. Analyze results for diagnostic features

### Spatial Transcriptomics Workflow
1. Upload OME-TIFF with protein markers
2. Create ROIs for different tissue regions
3. Ask: "Quantify CD68+ macrophages in each ROI"
4. Analyze spatial distribution patterns

### Research Workflow
1. Upload multiple images from experiment
2. Standardize ROI placement across images
3. Ask: "Compare expression patterns across samples"
4. Export results for statistical analysis

## 🛠️ Development Notes

The backend now includes:
- JIMP for image processing (thumbnails)
- Enhanced metadata extraction
- Format-specific handling
- Better error reporting

Future enhancements could include:
- OpenSlide integration for WSI formats
- Advanced image processing pipelines
- Integration with external analysis tools
- Export to standard formats (DICOM, OME-XML)

---

Your SlidChat application is now ready for professional biological image analysis! 🚀