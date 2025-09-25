// server/lib/langchain-integration.js
import { ChatOpenAI } from '@langchain/openai';
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { functionRegistry } from './function-registry.js';

/**
 * LangChain integration for intelligent biological analysis
 */
class LangChainAgent {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.model = null;
    this.agent = null;
    this.tools = [];
    this.initialized = false;
  }

  /**
   * Initialize the LangChain agent with OpenAI and registered functions
   */
  async initialize() {
    try {
      if (!this.apiKey) {
        console.log('⚠️ No OpenAI API key provided. Agent will use fallback responses.');
        return;
      }

      // Initialize OpenAI model
      this.model = new ChatOpenAI({
        modelName: 'gpt-3.5-turbo',
        temperature: 0.1,
        openAIApiKey: this.apiKey
      });

      // Convert registered functions to LangChain tools
      this.tools = this.createLangChainTools();

      // Create agent prompt
      const prompt = ChatPromptTemplate.fromMessages([
        ['system', `You are a biological slide analysis assistant. You have access to various analysis functions for medical slides and ROIs.

Available functions:
${this.tools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n')}

When a user asks about slide analysis, ROI creation, or biological features, use the appropriate functions to help them.
Always provide clear, helpful responses and explain what functions you're using.

If you need to analyze multiple aspects or perform complex workflows, you can call multiple functions in sequence.`],
        ['human', '{input}'],
        ['placeholder', '{agent_scratchpad}']
      ]);

      // Create tool-calling agent
      const agent = await createToolCallingAgent({
        llm: this.model,
        tools: this.tools,
        prompt
      });

      // Create agent executor
      this.agent = new AgentExecutor({
        agent,
        tools: this.tools,
        verbose: true,
        maxIterations: 5,
        earlyStoppingMethod: 'generate'
      });

      this.initialized = true;
      console.log('🤖 LangChain agent initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize LangChain agent:', error);
      throw error;
    }
  }

  /**
   * Convert function registry to LangChain tools
   */
  createLangChainTools() {
    const functions = functionRegistry.list();
    
    return functions.map(func => {
      return new DynamicStructuredTool({
        name: func.name,
        description: func.description,
        schema: func.inputSchema,
        func: async (input) => {
          try {
            const result = await functionRegistry.execute(func.name, input);
            return JSON.stringify(result, null, 2);
          } catch (error) {
            return JSON.stringify({ 
              success: false, 
              error: error.message,
              message: `Failed to execute ${func.name}`
            });
          }
        }
      });
    });
  }

  /**
   * Process a user query using the LangChain agent
   */
  async processQuery(message, context = {}) {
    try {
      if (!this.initialized || !this.agent) {
        // Fallback response when agent is not available
        return this.getFallbackResponse(message, context);
      }

      // Invoke the agent with the message
      const response = await this.agent.invoke({
        input: message,
        context: JSON.stringify(context)
      });

      return {
        success: true,
        response: response.output,
        context: {
          functionsUsed: this.extractFunctionsUsed(response),
          agentThought: response.intermediateSteps || []
        }
      };

    } catch (error) {
      console.error('❌ LangChain agent error:', error);
      
      // Return fallback response on error
      const fallback = this.getFallbackResponse(message, context);
      return {
        success: false,
        error: error.message,
        fallback: fallback.response,
        context: fallback.context
      };
    }
  }

  /**
   * Extract function names used during agent execution
   */
  extractFunctionsUsed(response) {
    if (!response.intermediateSteps) return [];
    
    return response.intermediateSteps
      .map(step => step.action?.tool)
      .filter(tool => tool)
      .filter((tool, index, array) => array.indexOf(tool) === index); // unique
  }

  /**
   * Provide fallback responses when LangChain is not available
   */
  getFallbackResponse(message, context) {
    const lowerMessage = message.toLowerCase();
    
    // Simple keyword-based fallback responses
    if (lowerMessage.includes('slide') && lowerMessage.includes('info')) {
      return {
        success: true,
        response: "I can help you get slide information. The system has functions to retrieve slide metadata, dimensions, staining information, and other details. To get specific information, I would need to call the getSlideInfo function with a slide ID.",
        context: { fallback: true, suggestedFunction: 'getSlideInfo' }
      };
    }
    
    if (lowerMessage.includes('roi') || lowerMessage.includes('region')) {
      return {
        success: true,
        response: "I can help with Region of Interest (ROI) operations. The system can create new ROIs on slides with specified coordinates and dimensions. Would you like to create an ROI or analyze an existing one?",
        context: { fallback: true, suggestedFunction: 'createROI' }
      };
    }
    
    if (lowerMessage.includes('analyz') || lowerMessage.includes('morpholog') || lowerMessage.includes('cellular')) {
      return {
        success: true,
        response: "I can perform biological feature analysis including morphology analysis, immunostaining analysis, cellular density calculations, and tissue classification. These analyses can be performed on entire slides or specific ROIs.",
        context: { fallback: true, suggestedFunction: 'analyzeBiologicalFeatures' }
      };
    }
    
    if (lowerMessage.includes('similar') || lowerMessage.includes('search')) {
      return {
        success: true,
        response: "I can help find slides with similar biological features using AI-powered similarity search. This includes morphology-based, immunostaining-based, and cellular density-based similarity matching.",
        context: { fallback: true, suggestedFunction: 'findSimilarSlides' }
      };
    }
    
    // Generic fallback
    return {
      success: true,
      response: `I'm a biological slide analysis assistant. I can help with:
      
• Getting slide information and metadata
• Creating and managing Regions of Interest (ROIs)  
• Performing biological feature analysis (morphology, immunostaining, cellular density)
• Finding slides with similar characteristics

The system currently has ${functionRegistry.list().length} analysis functions available. How can I assist you with your slide analysis needs?`,
      context: { 
        fallback: true, 
        availableFunctions: functionRegistry.list().map(f => f.name)
      }
    };
  }
}

/**
 * Create and initialize a SlidChat LangChain agent
 */
export async function createSlideChatAgent(apiKey) {
  const agent = new LangChainAgent(apiKey);
  await agent.initialize();
  return agent;
}