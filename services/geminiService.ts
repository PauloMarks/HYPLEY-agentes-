
import { GoogleGenAI, Type, GenerateContentResponse, Modality, LiveServerMessage } from "@google/genai";
import { AgentType, ProjectContext, VoiceType } from "../types";
import { AGENTS } from "../constants";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const getAgentResponseStream = async (
  agentType: AgentType,
  prompt: string,
  history: { role: 'user' | 'model', parts: { text: string }[] }[],
  context: ProjectContext,
  voice?: VoiceType
) => {
  const agent = AGENTS[agentType];
  
  let voiceInstruction = "";
  if (voice === 'carioca') {
    voiceInstruction = `
      TONALIDADE DE VOZ (CARIOCA): Adote uma persona inspirada na Xuxa. 
      Seja extremamente feminina, delicada, doce e angelical. 
      Use palavras suaves e chame o usuário de "meu baixinho", "meu amor" ou "meu anjo" com muita ternura.
    `;
  } else if (voice === 'baiana') {
    voiceInstruction = `
      TONALIDADE DE VOZ (BAIANA): Use um sotaque baiano carinhoso e acolhedor, como uma "mainha" dedicada.
    `;
  }

  const fullSystemInstruction = `
    ${agent.systemInstruction}
    ${voiceInstruction}
    SHARED PROJECT MEMORY:
    Project Name: ${context.name || 'Not defined'}
    Description: ${context.description || 'Not defined'}
    Tech Stack: ${context.stack || 'Not defined'}
    Key Features: ${context.features.join(', ') || 'None listed'}
    
    IMPORTANTE: O usuário acabou de enviar uma mensagem. 
    Responda de forma rápida, eficiente e com o carinho especificado acima.
  `;

  const config: any = {
    systemInstruction: fullSystemInstruction,
    temperature: 0.8,
  };

  if (agentType === AgentType.ANALISES) {
    config.tools = [{ googleSearch: {} }];
  }

  const chat = ai.chats.create({
    model: 'gemini-3-flash-preview',
    config,
    history: history as any
  });

  return await chat.sendMessageStream({ message: prompt });
};

export const connectLiveAgent = async (
  agentType: AgentType,
  context: ProjectContext,
  voice: VoiceType,
  callbacks: {
    onAudioChunk: (base64Audio: string) => void;
    onInterrupted: () => void;
    onInputTranscription: (text: string) => void;
    onOutputTranscription: (text: string) => void;
    onTurnComplete: () => void;
    onerror: (e: any) => void;
  }
) => {
  const agent = AGENTS[agentType];
  
  let voicePersona = "";
  if (voice === 'carioca') {
    voicePersona = "Adote o estilo Xuxa: voz extremamente feminina, delicada, angelical e doce. Chame-o de 'baixinho'.";
  } else {
    voicePersona = "Sotaque baiano, acolhedor e carinhoso como uma mãe.";
  }

  const systemInstruction = `
    ${agent.systemInstruction}
    VOCÊ ESTÁ EM UMA CONVERSA DE VOZ EM TEMPO REAL.
    ${voicePersona}
    Seja breve, direta e use o máximo de doçura possível nas palavras.
    Contexto do Projeto: ${context.name}.
  `;

  return ai.live.connect({
    model: 'gemini-2.5-flash-native-audio-preview-12-2025',
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: voice === 'baiana' ? 'Kore' : 'Puck' } },
      },
      systemInstruction,
      inputAudioTranscription: {},
      outputAudioTranscription: {}
    },
    callbacks: {
      onopen: () => console.log("Live session opened"),
      onmessage: async (message: LiveServerMessage) => {
        if (message.serverContent?.modelTurn?.parts[0]?.inlineData?.data) {
          callbacks.onAudioChunk(message.serverContent.modelTurn.parts[0].inlineData.data);
        }
        if (message.serverContent?.interrupted) {
          callbacks.onInterrupted();
        }
        if (message.serverContent?.inputTranscription) {
          callbacks.onInputTranscription(message.serverContent.inputTranscription.text);
        }
        if (message.serverContent?.outputTranscription) {
          callbacks.onOutputTranscription(message.serverContent.outputTranscription.text);
        }
        if (message.serverContent?.turnComplete) {
          callbacks.onTurnComplete();
        }
      },
      onerror: (e) => callbacks.onerror(e),
      onclose: () => console.log("Live session closed")
    }
  });
};

export const generateImage = async (prompt: string): Promise<string | null> => {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: { parts: [{ text: `High-quality SaaS asset for: ${prompt}. Modern clean style.` }] },
      config: { imageConfig: { aspectRatio: "16:9" } }
    });
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
    }
    return null;
  } catch (error) { return null; }
};

export const transcribeAudio = async (audioBlob: Blob): Promise<string> => {
  const arrayBuffer = await audioBlob.arrayBuffer();
  const base64data = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
  
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: { 
      parts: [
        { inlineData: { data: base64data, mimeType: audioBlob.type } }, 
        { text: "Transcreva este áudio de forma exata." }
      ] 
    }
  });
  return response.text || "";
};

export const generateSpeech = async (text: string, voice: VoiceType): Promise<Uint8Array | null> => {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice === 'baiana' ? 'Kore' : 'Puck' } } },
    },
  });
  const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  return data ? decodeBase64(data) : null;
};

export function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number = 24000, numChannels: number = 1): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
  }
  return buffer;
}
