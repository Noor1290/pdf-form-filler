"""Converts Real-ESRGAN's realesr-general-x4v3 (BSD-3-Clause) to ONNX.

The network is SRVGGNetCompact as in Real-ESRGAN's realesrgan/archs/
srvgg_arch.py, rebuilt here so nothing from the download is executed: the
weights are read with torch.load(weights_only=True).

Denoise strength 0.5 (Real-ESRGAN's own default for this model): the
weights are 0.5 x realesr-general-x4v3 + 0.5 x realesr-general-wdn-x4v3,
exactly as its inference script blends them ("dni").

    python scripts/convert-sharpening-model.py <download dir> public/models/realesr-general-x4v3.onnx

The two .pth files are from the v0.2.5.0 release of
https://github.com/xinntao/Real-ESRGAN (sha256 8dc7edb9...96292 and
1641f8c4...69dca). Needs torch, onnx and onnxruntime.
"""
import sys

import numpy as np
import onnxruntime
import torch
import torch.nn.functional as F
from torch import nn


class SRVGGNetCompact(nn.Module):
    def __init__(self, num_in_ch=3, num_out_ch=3, num_feat=64, num_conv=32, upscale=4):
        super().__init__()
        self.upscale = upscale
        self.body = nn.ModuleList()
        self.body.append(nn.Conv2d(num_in_ch, num_feat, 3, 1, 1))
        self.body.append(nn.PReLU(num_parameters=num_feat))
        for _ in range(num_conv):
            self.body.append(nn.Conv2d(num_feat, num_feat, 3, 1, 1))
            self.body.append(nn.PReLU(num_parameters=num_feat))
        self.body.append(nn.Conv2d(num_feat, num_out_ch * upscale * upscale, 3, 1, 1))
        self.upsampler = nn.PixelShuffle(upscale)

    def forward(self, x):
        out = x
        for layer in self.body:
            out = layer(out)
        out = self.upsampler(out)
        return out + F.interpolate(x, scale_factor=self.upscale, mode="nearest")


def weights(path):
    loaded = torch.load(path, map_location="cpu", weights_only=True)
    return loaded["params"] if "params" in loaded else loaded["params_ema"]


def main(download_dir, output):
    general = weights(f"{download_dir}/realesr-general-x4v3.pth")
    keep_detail = weights(f"{download_dir}/realesr-general-wdn-x4v3.pth")
    blended = {key: 0.5 * general[key] + 0.5 * keep_detail[key] for key in general}

    model = SRVGGNetCompact()
    model.load_state_dict(blended, strict=True)
    model.eval()

    sample = torch.rand(1, 3, 64, 48)
    torch.onnx.export(
        model,
        sample,
        output,
        input_names=["image"],
        output_names=["upscaled"],
        dynamic_axes={"image": {2: "height", 3: "width"}, "upscaled": {2: "height4", 3: "width4"}},
        opset_version=17,
    )

    # The ONNX model must give what PyTorch gives, on a size it was not
    # exported with.
    check = torch.rand(1, 3, 37, 53)
    with torch.no_grad():
        expected = model(check).numpy()
    session = onnxruntime.InferenceSession(output, providers=["CPUExecutionProvider"])
    actual = session.run(None, {"image": check.numpy()})[0]
    print("output shape", actual.shape, "largest difference", float(np.abs(actual - expected).max()))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
