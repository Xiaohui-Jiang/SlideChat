from celltypist import models

def get_models_for_tissue(tissue: str):
    """
    Return all CellTypist models and descriptions related to a given tissue name.

    Parameters
    ----------
    tissue : str
        Tissue keyword (case-insensitive). Example: "lung", "brain", "immune".

    Returns
    -------
    list of dict
        Each dict contains { "model": model_name, "description": model_description }.
        If no match is found, returns empty list.
    """
    # Get the full description table (DataFrame)
    df = models.models_description(on_the_fly=True)

    # Normalize tissue string
    key = tissue.lower()

    # Find rows where model name or description contains the tissue keyword
    mask = df.apply(lambda row: key in str(row["model"]).lower() or 
                                key in str(row["description"]).lower(), axis=1)

    subset = df[mask]

    return [
        {"model": row["model"], "description": row["description"]}
        for _, row in subset.iterrows()
    ]


if __name__ == "__main__":
    # Example: query all lung-related models
    tissue = "lung"
    models_info = get_models_for_tissue(tissue)

    if models_info:
        print(f"Available models for tissue '{tissue}':")
        for m in models_info:
            print(f"- {m['model']}: {m['description']}")
    else:
        print(f"No models found for tissue '{tissue}'.")