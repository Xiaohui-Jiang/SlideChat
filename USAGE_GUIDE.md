# 🧪 SlidChat LangChain Usage Guide

## Quick Start

### 1. Start Server
```bash
cd server
node index-enhanced.js
```

### 2. Basic Testing (No OpenAI API Key Required)

#### Check Server Status
```bash
curl http://localhost:5050/api/health
```

#### View Available Functions
```bash
curl http://localhost:5050/api/functions
```

#### View Toy Examples
```bash
curl http://localhost:5050/api/examples
```

### 3. Test Individual Functions

#### Get Slide Information
```bash
curl -X POST http://localhost:5050/api/functions/getSlideInfo/execute \
  -H "Content-Type: application/json" \
  -d '{"input": {"slideId": "lung_01"}}'
```

#### Create ROI
```bash
curl -X POST http://localhost:5050/api/functions/createROI/execute \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "slideId": "lung_01", 
      "name": "tumor_region",
      "geometry": {"x": 100, "y": 200, "w": 300, "h": 250}
    }
  }'
```

#### Biological Analysis
```bash
curl -X POST http://localhost:5050/api/functions/analyzeBiologicalFeatures/execute \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "slideId": "lung_01",
      "analysisType": "morphology"
    }
  }'
```

#### Find Similar Slides
```bash
curl -X POST http://localhost:5050/api/functions/findSimilarSlides/execute \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "slideId": "lung_01",
      "similarityType": "morphology",
      "threshold": 0.85
    }
  }'
```

### 4. Test Chat API (No OpenAI Key Required)

Basic fallback functionality test:
```bash
curl -X POST http://localhost:5050/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What information do you have about slide lung_01?"}'
```

### 5. Full LangChain Integration (Requires OpenAI API Key)

#### Setup API Key
Create a `.env` file in the server directory:
```bash
echo "OPENAI_API_KEY=your_actual_api_key_here" > server/.env
```

#### Advanced Chat Examples
```bash
# Multi-function analysis
curl -X POST http://localhost:5050/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Analyze slide lung_01 morphology and find similar slides with threshold 0.8"
  }'

# Create and analyze ROI
curl -X POST http://localhost:5050/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Create a ROI called tumor_area at coordinates x:150, y:250, width:400, height:300 on slide lung_01, then analyze its biological features"
  }'
```

## Automated Testing Scripts

### Run Function Tests
```bash
cd server
node test-functions.js
```

### Run Server API Tests
```bash
cd server
node test-server.js
```

### Run Complete Demo
```bash
# English version
./demo-langchain-en.sh

# Chinese version (original)
./demo-langchain.sh
```

## Frontend Integration

The React frontend includes LangChain API integration. See `client/src/lib/langchain-api.ts` and `client/src/components/FunctionTester.tsx` for implementation details.

### Start Frontend
```bash
cd client
npm install
npm run dev
```

## Function Registry Architecture

The system uses an extensible function registry pattern:

1. **Function Registration**: Functions are registered in `server/lib/slide-functions.js`
2. **Schema Validation**: Uses Zod for input/output validation
3. **LangChain Integration**: Automatic conversion to LangChain tools
4. **Execution Engine**: Unified execution interface in `server/lib/function-registry.js`

### Adding New Functions

1. Define function in `server/lib/slide-functions.js`:
```javascript
const myNewFunction = {
    name: 'myNewFunction',
    description: 'Description of what this function does',
    inputSchema: z.object({
        param1: z.string().describe('Parameter description'),
        param2: z.number().optional()
    }),
    outputSchema: z.object({
        result: z.string()
    }),
    tags: ['tag1', 'tag2'],
    execute: async (input) => {
        // Implementation
        return { result: 'success' };
    }
};
```

2. Register the function:
```javascript
registry.register(myNewFunction);
```

## API Endpoints

- `GET /api/health` - Server health check
- `GET /api/functions` - List all available functions
- `GET /api/examples` - Get usage examples
- `POST /api/functions/{name}/execute` - Execute specific function
- `POST /api/chat` - LangChain chat interface

## Troubleshooting

### Common Issues

1. **Port 5050 in use**: Kill existing processes with `pkill -f "node.*index"`
2. **OpenAI API errors**: Check `.env` file and API key validity
3. **Function not found**: Verify function registration in startup logs
4. **JSON parsing errors**: Ensure proper Content-Type headers

### Debug Mode

Start server with debug logging:
```bash
DEBUG=* node index-enhanced.js
```

## Dependencies

Key packages used:
- `@langchain/core` - Core LangChain functionality
- `@langchain/openai` - OpenAI integration
- `langchain` - Main LangChain package
- `zod` - Schema validation
- `express` - Web server
- `cors` - Cross-origin requests

Install all dependencies:
```bash
cd server
npm install
```

## Virtual Environment (Recommended)

For Python-style dependency isolation:
```bash
# Using nvm for Node.js version management
nvm install 18
nvm use 18

# Using npm workspaces for project isolation
npm init -w server
npm init -w client
```