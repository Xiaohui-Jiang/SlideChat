import pytest
import os

# Set test data path
os.environ["TEST_DATA_PATH"] = "/Users/xiaohui/Downloads/20k_NSCLC_DTC_3p_nextgem_intron_donor_1_count_sample_feature_bc_matrix.h5"

def main():
    # Run all tests
    pytest.main(["-v", "--capture=tee-sys"])

if __name__ == "__main__":
    main()