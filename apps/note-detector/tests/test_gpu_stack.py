import sys
from types import SimpleNamespace

import pytest

import check_gpu_stack


def _install_stack(monkeypatch, torch_cuda="13.0", ort_cuda="13.0"):
    monkeypatch.setitem(
        sys.modules,
        "torch",
        SimpleNamespace(version=SimpleNamespace(cuda=torch_cuda)),
    )
    monkeypatch.setitem(
        sys.modules,
        "onnxruntime",
        SimpleNamespace(
            cuda_version=ort_cuda,
            get_available_providers=lambda: ["CUDAExecutionProvider"],
        ),
    )


def test_image_check_loads_wheel_libraries_without_the_host_driver(
    monkeypatch, capsys
):
    _install_stack(monkeypatch)
    loaded = []
    monkeypatch.setattr(check_gpu_stack.ctypes, "CDLL", loaded.append)

    check_gpu_stack.main()

    assert loaded == [
        "libcudart.so.13",
        "libcublas.so.13",
        "libcufft.so.12",
        "libcudnn.so.9",
    ]
    assert "CUDA 13 stack verified" in capsys.readouterr().out


@pytest.mark.parametrize(
    ("torch_cuda", "ort_cuda", "package"),
    [
        (None, "13.0", "torch"),
        ("12.6", "13.0", "torch"),
        ("13.0", "12.8", "onnxruntime-gpu"),
        ("13.0", "", "onnxruntime-gpu"),
    ],
)
def test_image_check_rejects_incompatible_builds(
    monkeypatch, torch_cuda, ort_cuda, package
):
    _install_stack(monkeypatch, torch_cuda, ort_cuda)
    with pytest.raises(
        RuntimeError, match=f"{package} must be built for CUDA 13"
    ):
        check_gpu_stack.main()


def test_image_check_fails_when_wheel_libraries_cannot_link(monkeypatch):
    _install_stack(monkeypatch)

    def missing_library(path):
        if path == "libcudnn.so.9":
            raise OSError("libcudnn.so.9: cannot open shared object file")

    monkeypatch.setattr(check_gpu_stack.ctypes, "CDLL", missing_library)
    with pytest.raises(OSError, match="libcudnn.so.9"):
        check_gpu_stack.main()


def test_image_check_rejects_onnx_without_cuda_provider(monkeypatch):
    _install_stack(monkeypatch)
    monkeypatch.setattr(
        sys.modules["onnxruntime"],
        "get_available_providers",
        lambda: ["CPUExecutionProvider"],
    )
    with pytest.raises(
        RuntimeError, match="must include CUDAExecutionProvider"
    ):
        check_gpu_stack.main()
