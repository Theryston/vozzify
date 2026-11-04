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
        SimpleNamespace(cuda_version=ort_cuda, __file__="/app/ort/__init__.py"),
    )


def test_image_check_loads_the_cuda_provider(monkeypatch, capsys):
    _install_stack(monkeypatch)
    loaded = []
    monkeypatch.setattr(check_gpu_stack.ctypes, "CDLL", loaded.append)

    check_gpu_stack.main()

    assert loaded == ["/app/ort/capi/libonnxruntime_providers_cuda.so"]
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


def test_image_check_fails_when_cuda_provider_cannot_link(monkeypatch):
    _install_stack(monkeypatch)

    def missing_library(_path):
        raise OSError("libcudnn.so.9: cannot open shared object file")

    monkeypatch.setattr(check_gpu_stack.ctypes, "CDLL", missing_library)
    with pytest.raises(OSError, match="libcudnn.so.9"):
        check_gpu_stack.main()
