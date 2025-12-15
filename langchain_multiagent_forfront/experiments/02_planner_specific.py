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

    # Define SPECIFIC test cases
    # We expect the planner to generate EXACTLY what is requested (plus core steps if needed).
    test_cases = [
        {
            "query": "Preprocess this dataset.",
            "expected": ["metadata", "preprocess"]
        },
        {
            "query": "Find marker genes for the tumor cluster.",
            "expected": ["metadata", "preprocess", "de"]
        },
        {
            "query": "Show the spatial expression of CD3E.",
            "expected": ["metadata", "preprocess", "spatial_gene_plot"]
        },
        {
            "query": "Analyze cell-cell communication.",
            "expected": ["metadata", "preprocess", "cell_communication"]
        },
        {
            "query": "Correct batch effects using Combat.",
            "expected": ["metadata", "preprocess", "batch_correction"]
        },
        {
            "query": "Identify spatial domains using Leiden.",
            "expected": ["metadata", "preprocess", "spatial_domain"]
        },
        {
            "query": "Annotate cell types using these markers.",
            "expected": ["metadata", "preprocess", "cell_typing"]
        },
        {
            "query": "Visualize CD3E and CD19 on UMAP.",
            "expected": ["metadata", "preprocess", "umap_gene_plot"]
        },
        {
            "query": "Calculate pseudotime starting from the stem cell cluster.",
            "expected": ["metadata", "preprocess", "pseudotime"]
        }
    ]

    results = []
    print(f"Running {len(test_cases)} specific test cases...")

    for i, case in enumerate(test_cases):
        query = case["query"]
        expected = set(case["expected"])
        
        print(f"\nCase {i+1}: '{query}'")
        try:
            plan = builder.build(query)
            generated_ids = [step.identifier for step in plan]
            generated_set = set(generated_ids)
            
            # Recall
            if len(expected) > 0:
                recall = len(generated_set.intersection(expected)) / len(expected)
            else:
                recall = 1.0
            
            # Precision
            if len(generated_set) > 0:
                precision = len(generated_set.intersection(expected)) / len(generated_set)
            else:
                precision = 0.0
            
            print(f"  Generated: {generated_ids}")
            print(f"  Expected:  {case['expected']}")
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
    
    json_path = os.path.join(output_dir, 'planner_specific_results.json')
    df.to_json(json_path, orient='records', indent=2)
    print(f"Results saved to {json_path}")
    
    # Plot
    plt.figure(figsize=(12, 6))
    x = np.arange(len(df))
    width = 0.35
    
    plt.bar(x - width/2, df["Precision"], width, label="Precision", color="#4C72B0")
    plt.bar(x + width/2, df["Recall"], width, label="Recall", color="#55A868")
    
    plt.ylabel("Score")
    plt.title("Planner Accuracy per Instruction (Specific)")
    # Use short labels or Case IDs
    labels = [f"Case {i+1}" for i in x]
    plt.xticks(x, labels)
    plt.ylim(0, 1.1)
    plt.legend(loc='lower right')
    plt.grid(axis='y', linestyle='--', alpha=0.7)
    
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, 'planner_specific_plot.png'), dpi=150)

if __name__ == "__main__":
    main()
