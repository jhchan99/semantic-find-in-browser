i want find to be just a little bit better, its already great, keyword search is fast and easy. But sometimes i dont know exactly what words im looking for so i need some sort of semantic search highlighting in my browser. I also dont really like tools like notebooklm or other types of llms for document searching because i often want to stay in the document im in, just be able to make more generic searches for topics i want to read about.

## Load unpacked

The MiniLM ONNX weights and the offscreen bundle are not in git. From the repo root:

```bash
npm i
npm run fetch-model
npm run build:embedder
```

Then Chrome → Extensions → Load unpacked → this folder. `fetch-model` pulls Xenova’s MiniLM (fp16 + q8) into `models/`. `build:embedder` bundles Transformers.js and copies ONNX Runtime `.wasm` files into `wasm/`.
