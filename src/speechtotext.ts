import OpenAI from "openai";
import settings from "./settings.ts";
import { getWavHeader } from "./util.ts";
import { File } from "formdata-node";
import {
    AvailableModels,
    InferenceSession,
    SessionManager,
    Segment,
    DecodingOptionsBuilder,
    initialize,
    Task
  } from "whisper-turbo";

console.log('OpenAI key', settings.OPENAI_API_KEY);
var openAI = new OpenAI({
    apiKey: settings.OPENAI_API_KEY
});

// export async function speechToText(buffer: Buffer) {
//     var wavHeader = getWavHeader(buffer.length, 16000);

//     const file = new File([wavHeader, buffer], 'audio.wav', { type: 'audio/wav' });

//     console.log('Transcribing audio... key', settings.OPENAI_API_KEY);
//     // This actually returns a string instead of the expected Transcription object 🙃
//     var result = await openAI.audio.transcriptions.create({
//         model: 'whisper-1',
//         language: 'en',
//         response_format: 'text',
//         // prompt: settings.OPENAI_WHISPER_PROMPT,
//         file: file,
//     }, 
//     {
//         headers: {
//             "Authentication": `Bearer ${settings.OPENAI_API_KEY}`,
//         }
//     }) as any as string;

//     result = result.trim();
//     console.log(`Speech to text: ${result}`);
//     if (result == null || result.length < 5) {
//         return null;
//     }
//     return result;
// }


export async function speechToText(buffer: Buffer) {

    const audioData = new Uint8Array(buffer);

    let turboSession;

    let result;

    await initialize();

    const loadResult = await new SessionManager().loadModel(
      AvailableModels.WHISPER_TINY,
      () => {
        console.log("Model loaded successfully");
      },
      (p) => {
        console.log(`Loading: ${p}%`);
      }
    );
  
    if (loadResult.isOk) {
        turboSession = loadResult.value;
    } else {
        console.log("model loading failed")
    }


    let options = new DecodingOptionsBuilder().setTask(Task.Transcribe).build();
  
  
    await turboSession.transcribe(audioData, true, options, (segment) => {
        console.log("segment text:", segment.text );
        result = result.concat(segment.text)
        if (segment.last) {
            return
        }
    });

    result = result.trim();
    console.log(`Speech to text: ${result}`);
    if (result == null || result.length < 5) {
        return null;
    }
    
    return result;

}



