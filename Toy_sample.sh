#!/bin/bash

# Complete LangChain testing demo script

echo "🚀 SlidChat LangChain Integration Test Demo"
echo "==========================================="
echo ""

# Check if port is occupied
if lsof -Pi :5050 -sTCP:LISTEN -t >/dev/null ; then
    echo "⚠️  Port 5050 is occupied, stopping existing processes..."
    pkill -f "node.*index" 2>/dev/null || true
    sleep 2
fi

echo "📦 Checking dependencies..."
cd /Users/jiachengsang/Desktop/Biological_agent/slidechat/server

# Start server
echo "🔥 Starting enhanced server..."
node index-enhanced.js &
SERVER_PID=$!
echo "Server PID: $SERVER_PID"

# Wait for server to start
echo "⏳ Waiting for server to start..."
sleep 5

echo ""
echo "🧪 Starting API tests..."
echo "========================"

# Test 1: Health check
echo ""
echo "1️⃣ Health check:"
curl -s http://localhost:5050/api/health | python3 -m json.tool 2>/dev/null || curl -s http://localhost:5050/api/health

# Test 2: Get functions list
echo ""
echo ""
echo "2️⃣ Available functions list:"
curl -s http://localhost:5050/api/functions | python3 -m json.tool 2>/dev/null || curl -s http://localhost:5050/api/functions

# Test 3: Get examples
echo ""
echo ""
echo "3️⃣ Toy examples:"
curl -s http://localhost:5050/api/examples | python3 -m json.tool 2>/dev/null || curl -s http://localhost:5050/api/examples

# Test 4: Direct function execution
echo ""
echo ""
echo "4️⃣ Direct function execution (getSlideInfo):"
curl -s -X POST http://localhost:5050/api/functions/getSlideInfo/execute \
  -H "Content-Type: application/json" \
  -d '{"input": {"slideId": "lung_01"}}' | python3 -m json.tool 2>/dev/null || \
curl -s -X POST http://localhost:5050/api/functions/getSlideInfo/execute \
  -H "Content-Type: application/json" \
  -d '{"input": {"slideId": "lung_01"}}'

# Test 5: Chat API
echo ""
echo ""
echo "5️⃣ Chat API test (no OpenAI Key required):"
curl -s -X POST http://localhost:5050/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What information do you have about slide lung_01?"}' | python3 -m json.tool 2>/dev/null || \
curl -s -X POST http://localhost:5050/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What information do you have about slide lung_01?"}'

echo ""
echo ""
echo "🎯 More test commands:"
echo "====================="
echo ""
echo "Test biological analysis:"
echo 'curl -X POST http://localhost:5050/api/functions/analyzeBiologicalFeatures/execute \'
echo '  -H "Content-Type: application/json" \'
echo '  -d '"'"'{"input": {"slideId": "lung_01", "analysisType": "morphology"}}'"'"''
echo ""
echo "Test ROI creation:"
echo 'curl -X POST http://localhost:5050/api/functions/createROI/execute \'
echo '  -H "Content-Type: application/json" \'
echo '  -d '"'"'{"input": {"slideId": "lung_01", "name": "tumor_region", "geometry": {"x": 100, "y": 200, "w": 300, "h": 250}}}'"'"''
echo ""
echo "Test similarity search:"
echo 'curl -X POST http://localhost:5050/api/functions/findSimilarSlides/execute \'
echo '  -H "Content-Type: application/json" \'
echo '  -d '"'"'{"input": {"slideId": "lung_01", "similarityType": "morphology", "threshold": 0.85}}'"'"''
echo ""
echo "📝 To use full LangChain functionality:"
echo "1. Set OPENAI_API_KEY in server/.env"
echo "2. Restart server"
echo ""
echo "⏹️  Press Ctrl+C to stop server (PID: $SERVER_PID)"

# Keep script running, wait for user input
read -p "Press Enter to stop server..."

# Cleanup
echo "🧹 Cleaning up processes..."
kill $SERVER_PID 2>/dev/null || true
pkill -f "node.*index" 2>/dev/null || true

echo "✅ Demo completed!"