# Bundled models

`lama_int4_int8_r4.onnx` (36.9 MB) is the LaMa ("big-lama") image inpainting model, used by
StyleLens to rebuild the picture behind erased lettering entirely on the user's device. It is
loaded from the extension's own files; nothing is fetched from the network at run time.

- Source: https://huggingface.co/othytenk/lama-int4-int8 (file `lama_int4_int8_r4.onnx`)
- A weight-quantised copy of https://huggingface.co/Carve/LaMa-ONNX (`lama_fp32.onnx`), itself an
  ONNX port of LaMa: https://github.com/advimman/lama
- Licence: Apache-2.0 (as stated on both model pages)
- Inputs: `image` float32 [1,3,512,512] in 0..1, `mask` float32 [1,1,512,512] (1 = rebuild)
- Output: float32 [1,3,512,512] in 0..255
- Must be loaded with the session option `session.disable_quant_qdq = "1"`

It runs with ONNX Runtime Web (`onnxruntime-web`, MIT licence), which the build bundles from
`node_modules`.

## ppocrv5_mobile_det.onnx (4.8 MB)

PaddleOCR PP-OCRv5 mobile text-detection model (DBNet). StyleLens uses it to find where text is
in a picture: to keep line art out of the Font layer and to spot old lettering left in the Clean
Background.

- Source: https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det_onnx (file `inference.onnx`), unmodified
- Licence: Apache-2.0
- Input `x`: float32 [1,3,H,W], BGR, H and W multiples of 32, long side <= 960, normalised with
  mean (0.485, 0.456, 0.406) and std (0.229, 0.224, 0.225)
- Output: per-pixel text probability; threshold 0.3, box score 0.6, unclip ratio 1.5
