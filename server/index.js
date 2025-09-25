// server/index-enhanced.js
// Enhanced server with LangChain integration - toy example
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// Import LangChain tools
import { 
  getSlideInfoTool, 
  createROITool, 
  analyzeBiologicalFeaturesTool, 
  findSimilarSlidesTool 
} from './lib/slide-functions.js';
import { ChatOpenAI } from '@langchain/openai';
import { createToolCallingAgent, AgentExecutor } from 'langchain/agents';
import { ChatPromptTemplate } from '@langchain/core/prompts';

// Load environment variables
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use('/public', express.static(path.join(process.cwd(), 'public')));

const upload = multer({ dest: path.join(process.cwd(), 'uploads') });

// Initialize function registry and LangChain agent
async function initializeServer() {
  try {
    // Initialize LangChain tools and agent
    const tools = [
      getSlideInfoTool,
      createROITool, 
      analyzeBiologicalFeaturesTool,
      findSimilarSlidesTool
    ];

    console.log('✅ Loaded LangChain tool: getSlideInfo');
    console.log('✅ Loaded LangChain tool: createROI');
    console.log('✅ Loaded LangChain tool: analyzeBiologicalFeatures');
    console.log('✅ Loaded LangChain tool: findSimilarSlides');

    // Create the LangChain agent
    const llm = new ChatOpenAI({
      model: "gpt-3.5-turbo",
      temperature: 0,
    });

    const prompt = ChatPromptTemplate.fromMessages([
      ["system", `You are a biological slide analysis assistant. You have access to various analysis functions for medical slides and ROIs.

Available functions:
- getSlideInfo: Retrieve detailed information and metadata about a specific slide
- createROI: Create a new Region of Interest (ROI) on a slide with specified geometry
- analyzeBiologicalFeatures: Perform biological feature analysis on a slide or ROI (morphology, immunostaining, cellular density, tissue classification)
- findSimilarSlides: Find slides with similar biological features using AI-powered similarity search

When a user asks about slide analysis, ROI creation, or biological features, use the appropriate functions to help them.
Always provide clear, helpful responses and explain what functions you're using.

If you need to analyze multiple aspects or perform complex workflows, you can call multiple functions in sequence.`],
      ["human", "{input}"],
      ["placeholder", "{agent_scratchpad}"],
    ]);

    const agent = await createToolCallingAgent({ llm, tools, prompt });
    global.langchainAgent = new AgentExecutor({ agent, tools });
    
    console.log('🤖 LangChain agent initialized successfully');

  } catch (error) {
    console.error('❌ Server initialization failed:', error);
    process.exit(1);
  }
}

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

// Enhanced chat endpoint with direct LangChain tool integration
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    console.log('🔵 SERVER: Received chat request:', { message });

    if (!global.langchainAgent) {
      throw new Error('LangChain agent not initialized');
    }

    // Use LangChain agent for response
    console.log('🤖 Using LangChain agent for response');
    
    const result = await global.langchainAgent.invoke({
      input: message
    });

    res.json({
      reply: result.output,
      source: 'langchain',
      functions_used: result.steps?.map(step => step.action?.tool) || []
    });

  } catch (error) {
    console.error('❌ LangChain agent error:', error);
    
    // Fallback response
    console.log('🔵 SERVER: LangChain failed, using fallback');
    res.json({
      reply: "I can help you get slide information. The system has functions to retrieve slide metadata, dimensions, staining information, and other details. To get specific information, I would need to call the getSlideInfo function with a slide ID.",
      source: 'fallback',
      error: error.message
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

// Initialize server and start
const PORT = process.env.PORT || 5050;

async function startServer() {
  await initializeServer();
  
  app.listen(PORT, () => {
    console.log(`🚀 Enhanced SlidChat server running on port ${PORT}`);
    console.log(`📊 Functions registered: 4`);
    console.log(`🤖 LangChain agent: ${global.langchainAgent ? 'enabled' : 'disabled'}`);
    console.log(`\n🧪 Try these toy examples:`);
    console.log(`   GET  http://localhost:${PORT}/api/examples`);
    console.log(`   GET  http://localhost:${PORT}/api/functions`);
    console.log(`   POST http://localhost:${PORT}/api/functions/getSlideInfo/execute`);
    console.log(`   POST http://localhost:${PORT}/api/chat`);
  });
}

startServer();