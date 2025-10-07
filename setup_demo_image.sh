#!/bin/bash
# Script to set up the demo H&E tissue image

echo "📷 Setting up demo H&E tissue image..."

# Create the directory if it doesn't exist
mkdir -p /Users/cth/Desktop/slidechat/server/public/slides/demo_he_tissue

echo "💡 Instructions to add your H&E image:"
echo "1. Save the H&E tissue image as 'demo_he_tissue.jpg'"
echo "2. Copy it to: /Users/cth/Desktop/slidechat/server/public/slides/demo_he_tissue/"
echo "3. The image will be available at: http://localhost:5050/public/slides/demo_he_tissue/demo_he_tissue.jpg"
echo ""
echo "🔧 Commands to copy your image:"
echo "   # If your image is on Desktop:"
echo "   cp ~/Desktop/your_he_image.jpg /Users/cth/Desktop/slidechat/server/public/slides/demo_he_tissue/demo_he_tissue.jpg"
echo ""
echo "   # Or drag the image to the folder in Finder:"
echo "   open /Users/cth/Desktop/slidechat/server/public/slides/demo_he_tissue/"
echo ""
echo "📁 Directory structure created:"
ls -la /Users/cth/Desktop/slidechat/server/public/slides/demo_he_tissue/ 2>/dev/null || echo "   (Directory will be created when you copy the image)"

echo ""
echo "✅ After copying the image, restart the servers and the demo image will appear in the dashboard!"
echo "   Server: npm run dev (in server directory)"  
echo "   Client: npm run dev (in client directory)"