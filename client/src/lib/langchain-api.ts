// client/src/lib/langchain-api.ts

export interface LangChainFunction {
  name: string;
  description: string;
  tags: string[];
  inputSchema: any;
  outputSchema: any;
}

export interface FunctionExecutionResult {
  success: boolean;
  data?: any;
  message?: string;
  error?: string;
}

export interface ChatResponse {
  reply: string;
  source: 'langchain' | 'fallback' | 'mock';
  context?: {
    functionsUsed?: string[];
    agentThought?: any[];
  };
  error?: string;
}

export interface UsageExample {
  type: string;
  query: string;
  expected_functions: string[];
  description: string;
}

export interface ExamplesResponse {
  message: string;
  examples: UsageExample[];
}

/**
 * LangChain API integration for frontend
 */
export class LangChainAPI {
  private baseUrl: string;

  constructor(baseUrl: string = '/api') {
    this.baseUrl = baseUrl;
  }

  /**
   * Get list of available LangChain functions
   */
  async getFunctions(): Promise<LangChainFunction[]> {
    try {
      const response = await fetch(`${this.baseUrl}/functions`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Failed to fetch functions:', error);
      throw error;
    }
  }

  /**
   * Execute a specific function
   */
  async executeFunction(functionName: string, input: any): Promise<FunctionExecutionResult> {
    try {
      const response = await fetch(`${this.baseUrl}/functions/${functionName}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ input }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`Failed to execute function ${functionName}:`, error);
      throw error;
    }
  }

  /**
   * Send a chat message to LangChain agent
   */
  async chat(message: string, context?: any): Promise<ChatResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message, context }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Failed to send chat message:', error);
      throw error;
    }
  }

  /**
   * Get usage examples
   */
  async getExamples(): Promise<ExamplesResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/examples`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Failed to fetch examples:', error);
      throw error;
    }
  }

  /**
   * Test function with sample data
   */
  async testFunction(functionName: string): Promise<FunctionExecutionResult> {
    const sampleInputs: Record<string, any> = {
      getSlideInfo: { slideId: 'lung_01' },
      createROI: { 
        slideId: 'lung_01', 
        name: 'test_region', 
        geometry: { x: 100, y: 200, w: 300, h: 250 } 
      },
      analyzeBiologicalFeatures: { 
        slideId: 'lung_01', 
        analysisType: 'morphology' 
      },
      findSimilarSlides: { 
        slideId: 'lung_01', 
        similarityType: 'morphology', 
        threshold: 0.8 
      }
    };

    const input = sampleInputs[functionName];
    if (!input) {
      throw new Error(`No sample input available for function: ${functionName}`);
    }

    return this.executeFunction(functionName, input);
  }
}

// Create default instance
export const langchainApi = new LangChainAPI();