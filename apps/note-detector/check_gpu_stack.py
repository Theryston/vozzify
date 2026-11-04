"""Verify the image's CUDA builds and ONNX provider linkage without a GPU."""

import ctypes
from pathlib import Path


def main() -> None:
    # Importing torch loads CUDA and cuDNN before linking the ONNX provider.
    import onnxruntime as ort
    import torch

    for name, cuda_version in (
        ("torch", torch.version.cuda),
        ("onnxruntime-gpu", ort.cuda_version),
    ):
        if not cuda_version or cuda_version.split(".")[0] != "13":
            raise RuntimeError(
                f"{name} must be built for CUDA 13: {cuda_version}"
            )

    provider = (
        Path(ort.__file__).parent / "capi/libonnxruntime_providers_cuda.so"
    )
    ctypes.CDLL(str(provider))
    print("CUDA 13 stack verified: PyTorch and ONNX CUDA provider load")


if __name__ == "__main__":
    main()
