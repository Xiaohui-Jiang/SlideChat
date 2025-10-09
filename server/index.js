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
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import ConversationMemoryStore from './lib/conversation-memory.js';

// Load environment variables
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use('/public', express.static(path.join(process.cwd(), 'public')));

const upload = multer({ dest: path.join(process.cwd(), 'uploads') });

const SUMMARY_MODEL =
  process.env.OPENAI_SUMMARY_MODEL ||
  process.env.LANGCHAIN_MODEL ||
  process.env.OPENAI_MODEL ||
  'gpt-4o-mini';
let summaryLLM = null;
let summarizerPrompt = null;

try {
  summaryLLM = new ChatOpenAI({
    model: SUMMARY_MODEL,
    temperature: 0.2
  });

  summarizerPrompt = ChatPromptTemplate.fromMessages([
    [
      'system',
      'You maintain concise running summaries of user conversations for a biological slide analysis assistant. Focus on factual context, outstanding questions, user preferences, and analysis steps that may matter later. Keep summaries under 200 words.'
    ],
    [
      'human',
      'Previous summary (use "None" if empty):\n{existingSummary}\n\nNew conversation turns:\n{transcript}\n\nUpdate the running summary in prose. Highlight slide IDs, ROI names, requested analyses, and any promised follow-ups.'
    ]
  ]);
} catch (error) {
  console.warn('⚠️ Conversation summarizer disabled:', error.message);
}

const conversationMemory = new ConversationMemoryStore({
  summarizer: null, // Disable summarizer to avoid crashes during testing
  config: {
    maxContextTokens: 3200,
    maxRecentMessages: 14,
    summaryTriggerMessages: 14,
    summaryRetainRecentMessages: 6
  }
});

global.conversationMemory = conversationMemory;

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

    global.langchainTools = tools;

    console.log('✅ Loaded LangChain tool: getSlideInfo');
    console.log('✅ Loaded LangChain tool: createROI');
    console.log('✅ Loaded LangChain tool: analyzeBiologicalFeatures');
    console.log('✅ Loaded LangChain tool: findSimilarSlides');

    // Create the LangChain agent
    const modelName = process.env.LANGCHAIN_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const temperature = process.env.LANGCHAIN_TEMPERATURE
      ? Number(process.env.LANGCHAIN_TEMPERATURE)
      : 0;

    console.log(`🧠 Initializing LangChain agent with model: ${modelName} (temperature=${temperature})`);

    const llm = new ChatOpenAI({
      model: modelName,
      temperature,
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
      new MessagesPlaceholder('chat_history'),
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

// Enhanced upload endpoint for biological images
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const id = path.parse(file.originalname).name.replace(/\W+/g, '_') + '_' + Date.now();
    const fileExt = path.extname(file.originalname).toLowerCase();
    const isStandardImage = (file.mimetype || '').startsWith('image/');
    const isBiologicalFormat = ['.svs', '.tif', '.tiff', '.ndpi', '.vsi', '.scn'].includes(fileExt);

    const outDir = path.join(process.cwd(), 'public', 'slides', id);
    fs.mkdirSync(outDir, { recursive: true });

    let imageUrl, thumbnailUrl, metadata = {};

    if (isStandardImage) {
      // Handle standard image formats (PNG, JPG, etc.)
      const dest = path.join(outDir, file.originalname);
      fs.renameSync(file.path, dest);
      imageUrl = `/public/slides/${id}/${file.originalname}`;
      thumbnailUrl = imageUrl;

      console.log(`📷 Standard image uploaded: ${file.originalname}`);
    } else if (isBiologicalFormat) {
      // Handle biological image formats (SVS, TIF, etc.)
      const dest = path.join(outDir, file.originalname);
      fs.renameSync(file.path, dest);

      // For now, create a placeholder preview
      // In production, you'd use tools like OpenSlide, VIPS, or similar
      imageUrl = `/public/slides/${id}/${file.originalname}`;
      thumbnailUrl = `https://picsum.photos/seed/${id}/240/180`;

      // Extract basic metadata
      const stats = fs.statSync(dest);
      metadata = {
        fileSize: stats.size,
        format: fileExt,
        uploadedAt: Date.now(),
        isBiologicalImage: true,
        needsProcessing: true
      };

      console.log(`🔬 Biological image uploaded: ${file.originalname} (${fileExt})`);
      console.log(`📊 File size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);
    } else {
      // Unsupported format
      fs.unlinkSync(file.path);
      return res.status(400).json({
        error: `Unsupported file format: ${fileExt}. Supported formats: JPG, PNG, TIF, SVS, NDPI, VSI, SCN`
      });
    }

    const result = {
      id,
      name: file.originalname,
      imageUrl,
      thumbnailUrl,
      sourceType: 'uploaded',
      format: fileExt,
      metadata
    };

    res.json(result);
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Sample biological slides endpoint
app.get('/api/slides', (req, res) => {
  res.json([
    {
      id: 'demo_he_tissue111111',
      name: 'demo_he_tissue11111.jpg',
      imageUrl: '/public/slides/demo_he_tissue/demopic.jpg',
      thumbnailUrl: '/public/slides/demo_he_tissue/demopic.jpg',
      sourceType: 'demo',
      format: '.jpg',
      metadata: {
        isBiologicalImage: true,
        tissueType: 'intestinal',
        staining: 'H&E',
        magnification: '20x',
        description: 'High-quality H&E stained tissue showing glandular structures and stromal components'
      }
    },
    {
      id: 'xenium_renal_he',
      name: 'Xenium_HE.ome.tiff',
      imageUrl: 'https://picsum.photos/seed/xenium-renal-he/1600/1200',
      thumbnailUrl: 'https://picsum.photos/seed/xenium-renal-he/240/180',
      sourceType: 'demo',
      format: '.tiff',
      metadata: {
        isBiologicalImage: true,
        tissueType: 'kidney',
        staining: 'H&E',
        magnification: '20x'
      }
    },
    {
      id: 'xenium_protein',
      name: 'Xenium_protein.ome.tiff',
      imageUrl: 'https://picsum.photos/seed/xenium-protein/1600/1200',
      thumbnailUrl: 'https://picsum.photos/seed/xenium-protein/240/180',
      sourceType: 'demo',
      format: '.tiff',
      metadata: {
        isBiologicalImage: true,
        tissueType: 'kidney',
        staining: 'Protein',
        channels: ['DAPI', 'CD68', 'CD3']
      }
    },
    {
      id: 'lung_svs_sample',
      name: 'lung_sample.svs',
      imageUrl: 'https://picsum.photos/seed/lung-svs/1600/1200',
      thumbnailUrl: 'https://picsum.photos/seed/lung-svs/240/180',
      sourceType: 'demo',
      format: '.svs',
      metadata: {
        isBiologicalImage: true,
        tissueType: 'lung',
        staining: 'H&E',
        scanner: 'Aperio'
      }
    }
  ]);
});

// Biological image metadata endpoint
app.get('/api/images/:imageId/metadata', (req, res) => {
  const { imageId } = req.params;

  // In a real implementation, this would read metadata from the actual file
  const mockMetadata = {
    id: imageId,
    dimensions: { width: 46000, height: 32914 },
    pixelSize: { x: 0.25, y: 0.25, unit: 'µm' },
    magnification: '20x',
    channels: ['DAPI', 'FITC', 'TRITC', 'Cy5'],
    tissueType: 'kidney',
    staining: 'Immunofluorescence',
    acquisitionDate: '2024-10-01T10:30:00Z',
    scanner: 'Xenium Analyzer',
    fileFormat: 'OME-TIFF',
    fileSize: '2.3 GB',
    pyramidLevels: 6
  };

  res.json(mockMetadata);
});

// Biological image processing status
app.get('/api/images/:imageId/processing-status', (req, res) => {
  const { imageId } = req.params;

  // Mock processing status
  res.json({
    id: imageId,
    status: 'completed',
    progress: 100,
    thumbnailReady: true,
    pyramidReady: true,
    analysisReady: true,
    lastUpdated: Date.now()
  });
});

// Get supported biological formats
app.get('/api/supported-formats', (req, res) => {
  res.json({
    biologicalFormats: [
      { extension: '.svs', description: 'Aperio SVS whole slide images', scanner: 'Aperio' },
      { extension: '.tif', description: 'Tagged Image File Format', scanner: 'Various' },
      { extension: '.tiff', description: 'Tagged Image File Format', scanner: 'Various' },
      { extension: '.ome.tiff', description: 'OME-TIFF biological images', scanner: 'Various' },
      { extension: '.ndpi', description: 'Hamamatsu NDPI', scanner: 'Hamamatsu' },
      { extension: '.vsi', description: 'Olympus VSI', scanner: 'Olympus' },
      { extension: '.scn', description: 'Leica SCN', scanner: 'Leica' }
    ],
    standardFormats: [
      { extension: '.jpg', description: 'JPEG images' },
      { extension: '.jpeg', description: 'JPEG images' },
      { extension: '.png', description: 'PNG images' },
      { extension: '.bmp', description: 'Bitmap images' }
    ]
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'Server is running!',
    langchainEnabled: !!global.langchainAgent,
    biologicalFormatsSupported: true,
    version: '2.0.0'
  });
});

// In-memory storage for ROIs (unchanged)
const rois = new Map();

// ROI endpoints - support both slideId and imageId
app.get('/api/slides/:slideId/rois', (req, res) => {
  const { slideId } = req.params;
  const slideRois = rois.get(slideId) || [];
  res.json(slideRois);
});

app.get('/api/images/:imageId/rois', (req, res) => {
  const { imageId } = req.params;
  const imageROIs = rois.get(imageId) || [];
  res.json(imageROIs);
});

app.post('/api/slides/:slideId/rois', (req, res) => {
  const { slideId } = req.params;
  const { name, geometry } = req.body;

  const roi = {
    id: `roi_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    name: name || `ROI ${Date.now()}`,
    slideId,
    imageId: slideId, // For backward compatibility
    geometry,
    createdAt: Date.now()
  };

  const slideRois = rois.get(slideId) || [];
  slideRois.push(roi);
  rois.set(slideId, slideRois);

  res.json(roi);
});

app.post('/api/images/:imageId/rois', (req, res) => {
  const { imageId } = req.params;
  const { name, geometry } = req.body;

  const roi = {
    id: `roi_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    name: name || `ROI ${Date.now()}`,
    imageId,
    slideId: imageId, // For backward compatibility
    geometry,
    createdAt: Date.now()
  };

  const imageROIs = rois.get(imageId) || [];
  imageROIs.push(roi);
  rois.set(imageId, imageROIs);

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

// Conversation memory inspection endpoints
app.get('/api/conversations', (req, res) => {
  res.json({
    conversations: conversationMemory.listConversations()
  });
});

app.get('/api/conversations/:conversationId', (req, res) => {
  const { conversationId } = req.params;
  const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 50));
  const conversation = conversationMemory.getConversation(conversationId);

  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  const messages = conversation.messages.slice(-limit);

  res.json({
    id: conversation.id,
    userId: conversation.userId,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    summary: conversation.summary,
    summaryUpdatedAt: conversation.summaryUpdatedAt,
    messageCount: conversation.messages.length,
    messages
  });
});

// Enhanced chat endpoint with conversation memory integration
app.post('/api/chat', async (req, res) => {
  try {
    console.log('🔵 SERVER: Received chat request:', req.body);

    const { message, conversationId, userId = 'anonymous', metadata = {} } = req.body || {};

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Get or create conversation
    let conversation;
    let currentConversationId = conversationId;

    if (currentConversationId) {
      conversation = conversationMemory.getConversation(currentConversationId);
      if (!conversation) {
        console.log(`⚠️ Conversation ${currentConversationId} not found, creating new one`);
        conversation = conversationMemory.createConversation({ userId, metadata });
        currentConversationId = conversation.id;
      }
    } else {
      conversation = conversationMemory.createConversation({ userId, metadata });
      currentConversationId = conversation.id;
      console.log(`🆕 Created new conversation: ${currentConversationId}`);
    }

    // Add user message to conversation
    conversationMemory.appendMessage(currentConversationId, {
      role: 'user',
      content: message,
      metadata
    });

    // Get conversation context for LangChain
    const context = conversationMemory.getContext(currentConversationId);
    
    // Convert messages to LangChain format
    const chatHistory = context.messages.slice(-5).map(msg => {
      try {
        if (msg.role === 'user') {
          return new HumanMessage(msg.content);
        } else if (msg.role === 'assistant') {
          return new AIMessage(msg.content);
        }
        return new SystemMessage(msg.content);
      } catch (error) {
        console.error('Error creating message:', error);
        return new HumanMessage(msg.content || '');
      }
    }).filter(Boolean);

    // Use LangChain agent with conversation context
    try {
      if (!global.langchainAgent) {
        throw new Error('LangChain agent not initialized');
      }

      console.log(`🤖 Using LangChain agent with ${chatHistory.length} context messages`);

      const result = await global.langchainAgent.invoke({
        input: message,
        chat_history: chatHistory
      });

      const agentReply = `${result.output ?? ''}`.trim();
      const functionsUsed = result.steps?.map((step) => step.action?.tool).filter(Boolean) || [];

      // Add assistant response to conversation
      conversationMemory.appendMessage(currentConversationId, {
        role: 'assistant',
        content: agentReply,
        metadata: { functions_used: functionsUsed }
      });

      // Try to summarize if needed
      await conversationMemory.maybeSummarize(currentConversationId);

      console.log('✅ LangChain agent response:', agentReply);

      res.json({
        conversationId: currentConversationId,
        reply: agentReply,
        source: 'langchain',
        functions_used: functionsUsed,
        summary: context.summary || null
      });
    } catch (error) {
      console.error('❌ LangChain agent error:', error);
      console.log('🔵 SERVER: Using enhanced fallback response');

      let contextualReply = 'I can help you analyze biological images and H&E stained tissue slides. ';
      const normalizedMessage = message.toLowerCase();

      if (normalizedMessage.includes('roi') || normalizedMessage.includes('region')) {
        contextualReply +=
          'For ROI analysis, I can help you:\n\n' +
          '🔬 **H&E Tissue Analysis:**\n' +
          '- Identify glandular structures and epithelial cells\n' +
          '- Analyze stromal components and connective tissue\n' +
          '- Quantify cell density in defined regions\n' +
          '- Assess tissue architecture and morphology\n\n' +
          '📊 **Available Functions:**\n' +
          '- getSlideInfo: Get slide metadata and properties\n' +
          '- analyzeBiologicalFeatures: Analyze cellular and tissue features\n' +
          '- createROI: Create regions of interest for analysis\n' +
          '- findSimilarSlides: Find similar tissue patterns';
      } else if (normalizedMessage.includes('cd68') || normalizedMessage.includes('immune')) {
        contextualReply +=
          'For immune cell analysis:\n\n' +
          '🧬 **Immune Infiltration Analysis:**\n' +
          '- CD68+ macrophage identification and quantification\n' +
          '- Spatial distribution of immune cells\n' +
          '- Tissue infiltration patterns\n' +
          '- Cell density calculations per ROI\n\n' +
          '💡 **Tip:** Draw ROIs around areas of interest and I can provide detailed analysis of immune cell populations.';
      } else {
        contextualReply +=
          "Here's what I can help you with:\n\n" +
          '🔬 **Image Analysis:**\n' +
          '- H&E stained tissue interpretation\n' +
          '- Cellular morphology assessment\n' +
          '- Tissue architecture analysis\n\n' +
          '📐 **ROI Functions:**\n' +
          '- Draw regions of interest on slides\n' +
          '- Quantitative analysis of selected areas\n' +
          '- Cell counting and density measurements\n\n' +
          "💬 **Try asking:**\n" +
          "- 'Analyze the tissue morphology in this ROI'\n" +
          "- 'What cell types are visible in this region?'\n" +
          "- 'Calculate cell density in ROI_1'";
      }

      // Add fallback message to conversation
      conversationMemory.appendMessage(currentConversationId, {
        role: 'assistant',
        content: contextualReply,
        metadata: { source: 'fallback', error: error.message }
      });

      res.json({
        conversationId: currentConversationId,
        reply: contextualReply,
        source: 'enhanced_fallback',
        demo_mode: true,
        error: error.message
      });
    }
  } catch (serverError) {
    console.error('❌ Chat endpoint error:', serverError);
    res.status(500).json({
      error: 'Internal server error',
      message: serverError.message
    });
  }
});

// Function tools inspection endpoints
app.get('/api/functions', (req, res) => {
  const tools = global.langchainTools || [];
  res.json({
    functions: tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      schema: tool.schema
    })),
    total: tools.length
  });
});

app.get('/api/functions/:name', (req, res) => {
  const { name } = req.params;
  const tools = global.langchainTools || [];
  const tool = tools.find(t => t.name === name);

  if (!tool) {
    return res.status(404).json({ error: 'Function not found' });
  }

  res.json({
    name: tool.name,
    description: tool.description,
    schema: tool.schema
  });
});

// Direct function execution endpoint (for testing)
app.post('/api/functions/:name/execute', async (req, res) => {
  const { name } = req.params;
  const { input = {} } = req.body;

  try {
    const tools = global.langchainTools || [];
    const tool = tools.find(t => t.name === name);

    if (!tool) {
      return res.status(404).json({ error: 'Function not found' });
    }

    const result = await tool.invoke(input);
    res.json({
      success: true,
      function: name,
      input: input,
      result: result
    });
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
    console.log(`🧠 Conversation memory: ${conversationMemory ? 'enabled' : 'disabled'} (storage: ${conversationMemory?.storagePath || 'n/a'})`);
    console.log(`\n🧪 Try these toy examples:`);
    console.log(`   GET  http://localhost:${PORT}/api/examples`);
    console.log(`   GET  http://localhost:${PORT}/api/functions`);
    console.log(`   POST http://localhost:${PORT}/api/functions/getSlideInfo/execute`);
    console.log(`   POST http://localhost:${PORT}/api/chat`);
  });
}

startServer();