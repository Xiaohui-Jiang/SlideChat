#!/bin/bash
# Demo script for using biological images with SlidChat

echo "🔬 SlidChat Biological Image Demo Setup"
echo "======================================="
echo

echo "📋 Current Setup:"
echo "- Server: http://localhost:5050 (Enhanced with biological image support)"
echo "- Client: http://localhost:3000 (Multi-panel workspace interface)"
echo

echo "🧬 Supported Biological Image Formats:"
echo "- .svs  (Aperio whole slide images)"
echo "- .tif/.tiff (Tagged Image Format)"
echo "- .ome.tiff (OME-TIFF biological images)"
echo "- .ndpi (Hamamatsu)"
echo "- .vsi  (Olympus)"
echo "- .scn  (Leica)"
echo

echo "📁 Demo Images Available:"
echo "- Xenium_HE.ome.tiff (H&E stained kidney tissue)"
echo "- Xenium_protein.ome.tiff (Protein markers, DAPI/CD68/CD3)"
echo "- lung_sample.svs (Lung tissue H&E)"
echo

echo "🚀 How to Use:"
echo "1. Open http://localhost:3000 in your browser"
echo "2. Create a new project or use the demo 'Xenium Renal Cell Carcinoma' project"
echo "3. Click 'Add Biological Images' to upload your TIF/SVS files"
echo "4. Select an image from the Images tab"
echo "5. Draw ROIs on the image"
echo "6. Click 'Analyze' on ROIs or chat with the agent"
echo "7. View results in the Log and Results panel"
echo

echo "💡 Key Features:"
echo "- Multi-format support (SVS, TIF, OME-TIFF, etc.)"
echo "- Metadata extraction for biological images"
echo "- Project-based organization"
echo "- ROI management and analysis"
echo "- LangChain-powered chat assistant"
echo "- Real-time logging and results"
echo

echo "🔧 Backend Enhancements Made:"
echo "- Enhanced upload endpoint for biological formats"
echo "- Metadata extraction and storage"
echo "- Format-specific processing"
echo "- New API endpoints for image metadata"
echo "- Support for large file uploads"
echo

echo "🎨 Frontend Enhancements Made:"
echo "- Project management panel"
echo "- Biological format icons and indicators"
echo "- Enhanced image viewer with ROI tools"
echo "- Log and results display"
echo "- Format-aware file handling"
echo

echo "✅ Setup Complete! Your biological image analysis workspace is ready."