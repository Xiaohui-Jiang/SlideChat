import sys
import os
import json
import pandas as pd
import matplotlib.pyplot as plt
import numpy as np
from pathlib import Path

# Use package imports
from langchain_multiagent.planner import LLMPlanBuilder
from langchain_multiagent.agent import _ensure_openai_api_key

def main():
    # Ensure API key is loaded
    if not _ensure_openai_api_key():
        print("Error: OpenAI API key not found. Please set OPENAI_API_KEY or check the key file.")
        sys.exit(1)

    print("Initializing LLMPlanBuilder...")
    builder = LLMPlanBuilder()
    
    test_cases = [
        {
            "query": "Analyze this dataset.",
            "expected_min": ["metadata", "preprocess"], 
            "expected_possible": ["cell_typing", "spatial_domain", "de"] # Bonus if these appear
        },
        {
            "query": "What is in this data?",
            "expected_min": ["metadata"],
            "expected_possible": ["preprocess", "cell_typing"]
        },
        {
            "query": "Run the standard pipeline.",
            "expected_min": ["metadata", "preprocess"],
            "expected_possible": ["cell_typing", "de"]
        },
        {
            "query": "Help me understand the cell types.",
            "expected_min": ["metadata", "preprocess", "cell_typing"],
            "expected_possible": []
        },
        {
            "query": "Show me the spatial layout.",
            "expected_min": ["metadata", "preprocess", "spatial_domain"],
            "expected_possible": ["spatial_gene_plot"]
        }
    ]

    results = []
    print(f"Running {len(test_cases)} vague test cases...")

    for i, case in enumerate(test_cases):
        query = case["query"]
        expected_min = set(case["expected_min"])
        expected_possible = set(case["expected_possible"])
        
        print(f"\nCase {i+1}: '{query}'")
        try:
            plan = builder.build(query)
            generated_ids = [step.identifier for step in plan]
            generated_set = set(generated_ids)
            
            # Recall
            if len(expected_min) > 0:
                recall = len(generated_set.intersection(expected_min)) / len(expected_min)
            else:
                recall = 1.0 # Nothing expected, nothing missed
            
            # Precision
            valid_steps = expected_min.union(expected_possible)
            if len(generated_set) > 0:
                precision = len(generated_set.intersection(valid_steps)) / len(generated_set)
            else:
                precision = 0.0
            
            print(f"  Generated: {generated_ids}")
            print(f"  Expected Min: {case['expected_min']}")
            print(f"  Precision: {precision:.2f}, Recall: {recall:.2f}")
            
            results.append({
                "Query": query,
                "Generated": generated_ids,
                "Precision": precision,
                "Recall": recall
            })
            
        except Exception as e:
            print(f"  Error: {e}")
            results.append({
                "Query": query,
                "Generated": [],
                "Precision": 0.0,
                "Recall": 0.0,
                "Error": str(e)
            })

    # Calculate metrics
    df = pd.DataFrame(results)
    avg_precision = df["Precision"].mean()
    avg_recall = df["Recall"].mean()
    print(f"\nAverage Precision: {avg_precision:.2f}")
    print(f"Average Recall:    {avg_recall:.2f}")

    # Save results
    output_dir = os.path.join(os.path.dirname(__file__), 'results')
    os.makedirs(output_dir, exist_ok=True)
    
    json_path = os.path.join(output_dir, 'planner_vague_results.json')
    df.to_json(json_path, orient='records', indent=2)
    print(f"Results saved to {json_path}")
    
    # Plot
    plt.figure(figsize=(10, 6))
    x = np.arange(len(df))
    width = 0.35
    
    plt.bar(x - width/2, df["Precision"], width, label="Precision", color="#4C72B0")
    plt.bar(x + width/2, df["Recall"], width, label="Recall", color="#55A868")
    
    plt.ylabel("Score")
    plt.title("Planner Robustness per Instruction (Vague)")
    labels = [f"Case {i+1}" for i in x]
    plt.xticks(x, labels)
    plt.ylim(0, 1.1)
    plt.legend(loc='lower right')
    plt.grid(axis='y', linestyle='--', alpha=0.7)
    
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, 'planner_vague_plot.png'), dpi=150)

if __name__ == "__main__":
    main()
