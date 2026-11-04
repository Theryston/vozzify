"""Verify the image's CUDA builds and wheel-provided libraries without a GPU."""

import ctypes


def main() -> None:
    # Importing torch loads the CUDA and cuDNN libraries shared with ORT.
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

    if "CUDAExecutionProvider" not in ort.get_available_providers():
        raise RuntimeError("onnxruntime-gpu must include CUDAExecutionProvider")

    # The provider itself links libcuda.so.1, injected by the host at runtime.
    # Check only wheel-provided libraries on the build runner, which has no GPU.
    for library in (
        "libcudart.so.13",
        "libcublas.so.13",
        "libcufft.so.12",
        "libcudnn.so.9",
    ):
        ctypes.CDLL(library)
    print("CUDA 13 stack verified: PyTorch and ONNX GPU libraries load")


if __name__ == "__main__":
    main()
