// server/lib/function-registry.js
import { z } from 'zod';

/**
 * Extensible function registry system for biological analysis functions
 * Supports Zod schema validation and LangChain tool conversion
 */
class FunctionRegistry {
  constructor() {
    this.functions = new Map();
  }

  /**
   * Register a new function with schema validation
   * @param {Object} functionDef - Function definition with name, description, schemas, and execute method
   */
  register(functionDef) {
    const { name, description, inputSchema, outputSchema, tags = [], execute } = functionDef;

    if (!name || !description || !inputSchema || !outputSchema || !execute) {
      throw new Error('Function definition must include name, description, inputSchema, outputSchema, and execute method');
    }

    if (typeof execute !== 'function') {
      throw new Error('Execute must be a function');
    }

    this.functions.set(name, {
      name,
      description,
      inputSchema,
      outputSchema,
      tags,
      execute
    });

    console.log(`✅ Registered function: ${name}`);
  }

  /**
   * Execute a registered function with input validation
   * @param {string} name - Function name
   * @param {Object} input - Input parameters
   * @returns {Promise<Object>} - Validated output
   */
  async execute(name, input) {
    const func = this.functions.get(name);
    if (!func) {
      throw new Error(`Function '${name}' not found`);
    }

    // Validate input
    try {
      const validatedInput = func.inputSchema.parse(input);
      console.log(`🔄 Executing function: ${name} with input:`, validatedInput);
      
      // Execute function
      const result = await func.execute(validatedInput);
      
      // Validate output
      const validatedOutput = func.outputSchema.parse(result);
      console.log(`✅ Function ${name} completed successfully`);
      
      return validatedOutput;
    } catch (error) {
      console.error(`❌ Function ${name} failed:`, error);
      throw error;
    }
  }

  /**
   * List all registered functions
   * @returns {Array} - Array of function metadata
   */
  list() {
    return Array.from(this.functions.values()).map(func => ({
      name: func.name,
      description: func.description,
      tags: func.tags,
      inputSchema: func.inputSchema._def || func.inputSchema,
      outputSchema: func.outputSchema._def || func.outputSchema
    }));
  }

  /**
   * Get a specific function definition
   * @param {string} name - Function name
   * @returns {Object|null} - Function definition or null if not found
   */
  get(name) {
    return this.functions.get(name) || null;
  }

  /**
   * Convert registered functions to LangChain tools format
   * @returns {Array} - Array of LangChain tool definitions
   */
  toLangChainTools() {
    return Array.from(this.functions.values()).map(func => ({
      name: func.name,
      description: func.description,
      schema: func.inputSchema,
      func: async (input) => {
        try {
          const result = await this.execute(func.name, input);
          return JSON.stringify(result);
        } catch (error) {
          return JSON.stringify({ error: error.message });
        }
      }
    }));
  }
}

// Create global registry instance
export const functionRegistry = new FunctionRegistry();