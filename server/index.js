// server/index-enhanced.js
// Enhanced server with LangChain integration - toy example
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// Import our LangChain integration
import { functionRegistry } from './lib/function-registry.js';
import { registerSlideFunctions } from './lib/slide-functions.js';
import { createSlideChatAgent } from './lib/langchain-integration.js';

// Load environment variables
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use('/public', express.static(path.join(process.cwd(), 'public')));

const upload = multer({ dest: path.join(process.cwd(), 'uploads') });

// Initialize LangChain agent
let slideChatAgent = null;

async function initializeAgent() {
  try {
    // Register slide-related functions
    registerSlideFunctions();
    
    // Create LangChain agent (will use mock if no API key)
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      slideChatAgent = await createSlideChatAgent(apiKey);
      console.log('🤖 LangChain agent initialized successfully');
    } else {
      console.log('⚠️ No OpenAI API key found. Using mock responses.');
    }
  } catch (error) {
    console.error('❌ Failed to initialize LangChain agent:', error);
  }
}

// Initialize agent on startup
initializeAgent();

// Existing upload endpoint (unchanged)
app.post('/api/upload', upload.single('file'), async (req, res) => {
  const file = req.file;
  const id = path.parse(file.originalname).name.replace(/\W+/g, '_') + '_' + Date.now();

  const isImage = (file.mimetype || '').startsWith('image/');
  const outDir = path.join(process.cwd(), 'public', 'slides', id);
  fs.mkdirSync(outDir, { recursive: true });

  let imageUrl, thumbnailUrl;
  if (isImage) {
    const dest = path.join(outDir, file.originalname);
    fs.renameSync(file.path, dest);
    imageUrl = `/public/slides/${id}/${file.originalname}`;
    thumbnailUrl = imageUrl;
  } else {
    fs.unlinkSync(file.path);
    imageUrl = 'https://picsum.photos/seed/newslide/1600/1200';
    thumbnailUrl = 'https://picsum.photos/seed/newslide/240/180';
  }

  res.json({ id, name: file.originalname, imageUrl, thumbnailUrl });
});

// Existing slides endpoint (unchanged)
app.get('/api/slides', (req, res) => {
  res.json([
    {
      id: 'lung_01',
      name: 'lung_01.svs',
      imageUrl: 'https://picsum.photos/seed/lung/1600/1200',
      thumbnailUrl: 'https://picsum.photos/seed/lung/240/180',
      sourceType: 'uploaded',
    },
  ]);
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'Server is running!',
    langchainEnabled: !!slideChatAgent,
    functionsRegistered: functionRegistry.list().length
  });
});

// In-memory storage for ROIs (unchanged)
const rois = new Map();

// Existing ROI endpoints (unchanged)
app.get('/api/slides/:slideId/rois', (req, res) => {
  const { slideId } = req.params;
  const slideRois = rois.get(slideId) || [];
  res.json(slideRois);
});

app.post('/api/slides/:slideId/rois', (req, res) => {
  const { slideId } = req.params;
  const { name, geometry } = req.body;
  
  const roi = {
    id: `roi_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    name: name || `ROI ${Date.now()}`,
    slideId,
    geometry,
    createdAt: Date.now()
  };
  
  const slideRois = rois.get(slideId) || [];
  slideRois.push(roi);
  rois.set(slideId, slideRois);
  
  res.json(roi);
});

app.put('/api/slides/:slideId/rois/:roiId', (req, res) => {
  const { slideId, roiId } = req.params;
  const { name } = req.body;
  
  const slideRois = rois.get(slideId) || [];
  const roi = slideRois.find(r => r.id === roiId);
  
  if (!roi) {
    return res.status(404).json({ error: 'ROI not found' });
  }
  
  roi.name = name;
  res.json(roi);
});

app.delete('/api/slides/:slideId/rois/:roiId', (req, res) => {
  const { slideId, roiId } = req.params;
  
  const slideRois = rois.get(slideId) || [];
  const index = slideRois.findIndex(r => r.id === roiId);
  
  if (index === -1) {
    return res.status(404).json({ error: 'ROI not found' });
  }
  
  slideRois.splice(index, 1);
  res.json({ success: true });
});

// Enhanced chat endpoint with LangChain integration
app.post('/api/chat', async (req, res) => {
  console.log('🔵 SERVER: Received chat request:', req.body);
  const { message, context = {} } = req.body;

  try {
    if (slideChatAgent) {
      // Use LangChain agent for intelligent responses
      console.log('🤖 Using LangChain agent for response');
      const result = await slideChatAgent.processQuery(message, context);
      
      if (result.success) {
        console.log('🔵 SERVER: LangChain response:', result.response);
        res.json({ 
          reply: result.response,
          source: 'langchain',
          context: result.context
        });
      } else {
        // Fallback to mock response
        console.log('🔵 SERVER: LangChain failed, using fallback');
        res.json({ 
          reply: result.fallback || 'I encountered an issue processing your request.',
          source: 'fallback',
          error: result.error
        });
      }
    } else {
      // Original mock responses for fallback
      const responses = [
        `I see you're asking about: "${message}". This appears to be a region of interest in the tissue sample.`,
        `Based on the ROI you've selected, I can observe cellular structures that suggest active immune infiltration.`,
        `The morphological features in this area indicate potential pathological changes worth further investigation.`,
      ];
      const response = responses[Math.floor(Math.random() * responses.length)];
      console.log('🔵 SERVER: Using mock response:', response);
      res.json({ 
        reply: response,
        source: 'mock'
      });
    }
  } catch (error) {
    console.error('🚨 Chat endpoint error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      reply: 'Sorry, I encountered an error processing your request.'
    });
  }
});

// NEW: Function registry endpoints for development and debugging
app.get('/api/functions', (req, res) => {
  res.json({
    functions: functionRegistry.list(),
    total: functionRegistry.list().length
  });
});

app.get('/api/functions/:name', (req, res) => {
  const { name } = req.params;
  const func = functionRegistry.get(name);
  
  if (!func) {
    return res.status(404).json({ error: 'Function not found' });
  }
  
  res.json(func);
});

// NEW: Direct function execution endpoint (for testing)
app.post('/api/functions/:name/execute', async (req, res) => {
  const { name } = req.params;
  const { input = {} } = req.body;

  try {
    if (slideChatAgent) {
      const result = await slideChatAgent.executeFunction(name, input);
      res.json(result);
    } else {
      const result = await functionRegistry.execute(name, input);
      res.json({
        success: true,
        function: name,
        input: input,
        result: result
      });
    }
  } catch (error) {
    res.status(400).json({
      success: false,
      function: name,
      input: input,
      error: error.message
    });
  }
});

// NEW: Toy examples endpoint
app.get('/api/examples', (req, res) => {
  res.json({
    message: "SlidChat LangChain Integration Examples",
    examples: [
      {
        type: "slide_analysis",
        query: "What information do you have about slide lung_01?",
        expected_functions: ["getSlideInfo"],
        description: "Retrieves detailed slide metadata and information"
      },
      {
        type: "roi_creation", 
        query: "Create a new ROI called 'tumor_region' at position x:100, y:200 with width 300 and height 250 on slide lung_01",
        expected_functions: ["createROI"],
        description: "Creates a new region of interest with specified geometry"
      },
      {
        type: "biological_analysis",
        query: "Perform morphology analysis on slide lung_01",
        expected_functions: ["analyzeBiologicalFeatures"],
        description: "Analyzes biological features like cell count, nuclear area, etc."
      },
      {
        type: "similarity_search",
        query: "Find slides similar to lung_01 with morphology similarity above 0.85",
        expected_functions: ["findSimilarSlides"],
        description: "Searches for slides with similar biological features"
      },
      {
        type: "combined_workflow",
        query: "Analyze the cellular density in slide lung_01 and then find similar slides",
        expected_functions: ["analyzeBiologicalFeatures", "findSimilarSlides"],
        description: "Demonstrates multi-step function calling workflow"
      }
    ]
  });
});

// Start server
const PORT = process.env.PORT || 5050;
app.listen(PORT, () => {
  console.log(`🚀 Enhanced SlidChat server running on port ${PORT}`);
  console.log(`📊 Functions registered: ${functionRegistry.list().length}`);
  console.log(`🤖 LangChain agent: ${slideChatAgent ? 'enabled' : 'disabled'}`);
  console.log(`\n🧪 Try these toy examples:`);
  console.log(`   GET  http://localhost:${PORT}/api/examples`);
  console.log(`   GET  http://localhost:${PORT}/api/functions`);
  console.log(`   POST http://localhost:${PORT}/api/functions/getSlideInfo/execute`);
  console.log(`   POST http://localhost:${PORT}/api/chat`);
});