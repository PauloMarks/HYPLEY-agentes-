
import { GoogleGenAI, Type, GenerateContentResponse, Modality, LiveServerMessage } from "@google/genai";
import { AgentType, ProjectContext, VoiceType, Attachment } from "../types";
import { AGENTS } from "../constants";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const getAgentResponseStream = async (
  agentType: AgentType,
  prompt: string,
  history: { role: 'user' | 'model', parts: { text?: string, inlineData?: any }[] }[],
  context: ProjectContext,
  voice?: VoiceType,
  attachments?: Attachment[]
) => {
  const agent = AGENTS[agentType];
  
  let voiceInstruction = "";
  if (voice === 'carioca') {
    voiceInstruction = `
      TONALIDADE DE VOZ (CARIOCA): Feminina, angelical e sussurrada. 
      Sua fala é leve como uma brisa, muito doce e protetora. Use "meu anjo".
    `;
  } else if (voice === 'baiana') {
    voiceInstruction = `
      TONALIDADE DE VOZ (BAIANA): Maternal, aveludada e acolhedora.
      Fale com o coração, de forma macia e paciente. Use "meu bem".
    `;
  } else if (voice === 'pernambucana') {
    voiceInstruction = `
      TONALIDADE DE VOZ (PERNAMBUCANA): Esta é a voz mais fina, doce e melódica de todas.
      Adote um tom cristalino, dengoso e extremamente gentil. Use "meu cheiro" e "visse?".
    `;
  } else if (voice === 'mineira') {
    voiceInstruction = `
      TONALIDADE DE VOZ (MINEIRA): Inspirada na energia vibrante e amorosa da Joelma com um sotaque mineiro ultra-doce.
      Sua voz deve ser fina, melódica e cheia de carinho mineiro.
      Use expressões como "uai", "trem lindo", "uai de Deus", "meu pão de queijo" e "queridinho(a)".
      Fale com um sorriso, sendo muito feminina e delicada.
    `;
  }

  const visionPrompt = attachments && attachments.length > 0 
    ? `\n[ANÁLISE VISUAL]: O usuário enviou anexos. Olhe para eles com todo o carinho e atenção.`
    : "";

  const fullSystemInstruction = `
    ${agent.systemInstruction}
    ${voiceInstruction}
    ${visionPrompt}
    CONTEXTO DO SAAS: ${context.name || 'Projeto Hypley'}
    
    REGRA DE OURO: Você é a personificação da doçura e da delicadeza. Sua missão é apoiar o usuário como se ele fosse a pessoa mais importante do mundo.
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

  const parts: any[] = [{ text: prompt }];
  if (attachments && attachments.length > 0) {
    attachments.forEach(att => {
      parts.push({
        inlineData: {
          data: att.data.split(',')[1],
          mimeType: att.mimeType
        }
      });
    });
  }

  return await chat.sendMessageStream({ message: { parts } });
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
  let prebuiltVoice: "Kore" | "Puck" | "Charon" = "Kore";

  if (voice === 'carioca') {
    voicePersona = "Carioca: Voz fina, angelical e doce. Use 'meu anjo'.";
    prebuiltVoice = "Puck";
  } else if (voice === 'pernambucana') {
    voicePersona = "Pernambucana: Voz fina e melódica, cheia de mel. Use 'meu cheiro'.";
    prebuiltVoice = "Charon";
  } else if (voice === 'mineira') {
    voicePersona = "Mineira: Estilo Joelma carinhosa, sotaque mineiro fino e doce. Use 'uai', 'trem' e 'meu anjo de minas'.";
    prebuiltVoice = "Kore";
  } else {
    voicePersona = "Baiana: Voz aveludada e maternal. Use 'meu bem'.";
    prebuiltVoice = "Kore";
  }

  const systemInstruction = `
    ${agent.systemInstruction}
    VOZ REAL-TIME ATIVA.
    ${voicePersona}
    Seja extremamente delicada, feminina e use um tom de voz fino e doce.
    Mantenha as respostas curtas e carinhosas.
  `;

  return ai.live.connect({
    model: 'gemini-2.5-flash-native-audio-preview-12-2025',
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: prebuiltVoice } },
      },
      systemInstruction,
      inputAudioTranscription: {},
      outputAudioTranscription: {}
    },
    callbacks: {
      onopen: () => console.log("Live session started"),
      onmessage: async (message: LiveServerMessage) => {
        if (message.serverContent?.modelTurn?.parts[0]?.inlineData?.data) {
          callbacks.onAudioChunk(message.serverContent.modelTurn.parts[0].inlineData.data);
        }
        if (message.serverContent?.interrupted) callbacks.onInterrupted();
        if (message.serverContent?.inputTranscription) callbacks.onInputTranscription(message.serverContent.inputTranscription.text);
        if (message.serverContent?.outputTranscription) callbacks.onOutputTranscription(message.serverContent.outputTranscription.text);
        if (message.serverContent?.turnComplete) callbacks.onTurnComplete();
      },
      onerror: (e) => callbacks.onerror(e),
      onclose: () => console.log("Live session ended")
    }
  });
};

export const generateImage = async (prompt: string): Promise<string | null> => {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: { parts: [{ text: `High-quality, elegant SaaS graphic for: ${prompt}.` }] },
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
        { text: "Transcreva este áudio exatamente como dito." }
      ] 
    }
  });
  return response.text || "";
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
