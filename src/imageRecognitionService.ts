import { AutoProcessor, AutoTokenizer, Moondream1ForConditionalGeneration, RawImage } from '@xenova/transformers';

class ImageRecognitionService {
  private modelId: string;
  private device: string;
  private model: Moondream1ForConditionalGeneration | null;
  private processor: AutoProcessor | null;
  private tokenizer: AutoTokenizer | null;

  constructor() {
    this.modelId = 'Xenova/moondream2';
    this.device = 'webgpu';
    this.model = null;
    this.processor = null;
    this.tokenizer = null;
  }

  async initialize(): Promise<void> {
    this.processor = await AutoProcessor.from_pretrained(this.modelId);
    this.tokenizer = await AutoTokenizer.from_pretrained(this.modelId);
    this.model = await Moondream1ForConditionalGeneration.from_pretrained(this.modelId, {
      dtype: {
        embed_tokens: 'fp16', // or 'fp32'
        vision_encoder: 'fp16', // or 'q8'
        decoder_model_merged: 'q4', // or 'q4f16' or 'q8'
      },
      device: this.device,
    });
  }

  async recognizeImage(imageUrl: string): Promise<string[]> {
    if (!this.tokenizer || !this.processor || !this.model) {
      throw new Error('ImageRecognitionService not initialized');
    }

    // Prepare text inputs
    const prompt = 'Describe this image.';
    const text = `<image>\n\nQuestion: ${prompt}\n\nAnswer:`;
    const textInputs = this.tokenizer(text);

    // Prepare vision inputs
    const image = await RawImage.fromURL(imageUrl);
    const visionInputs = await this.processor(image);

    // Generate response
    const output = await this.model.generate({
      ...textInputs,
      ...visionInputs,
      do_sample: false,
      max_new_tokens: 64,
    });
    const decoded = this.tokenizer.batch_decode(output, { skip_special_tokens: false });
    return decoded;
  }
}

export default ImageRecognitionService;
