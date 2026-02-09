
import React, { useState, useRef, useEffect } from 'react';
import { Message, AgentType, ProjectContext, VoiceType } from '../types';
import { AGENTS } from '../constants';
import { 
  getAgentResponseStream, 
  transcribeAudio, 
  generateSpeech, 
  decodeAudioData, 
  generateImage, 
  connectLiveAgent,
  encodeBase64,
  decodeBase64
} from '../services/geminiService';
import { GenerateContentResponse } from '@google/genai';

interface ChatWindowProps {
  activeAgent: AgentType;
  messages: Message[];
  onSendMessage: (msg: Partial<Message>) => void;
  context: ProjectContext;
  onToggleSidebar: () => void;
  isSidebarOpen: boolean;
  onToggleInfo: () => void;
  voicePreference: VoiceType;
  setVoicePreference: (v: VoiceType) => void;
}

const ChatWindow: React.FC<ChatWindowProps> = ({ 
  activeAgent, messages, onSendMessage, context, onToggleSidebar, 
  isSidebarOpen, onToggleInfo, voicePreference, setVoicePreference 
}) => {
  const [inputText, setInputText] = useState('');
  const [isLive, setIsLive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [liveInputTranscription, setLiveInputTranscription] = useState('');
  const [liveOutputTranscription, setLiveOutputTranscription] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<{data: string, mimeType: string, name: string}[]>([]);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const liveSessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isTyping, liveInputTranscription, liveOutputTranscription, isTranscribing, selectedFiles]);

  const initAudioContexts = async () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    return audioContextRef.current;
  };

  const stopAllAudio = () => {
    sourcesRef.current.forEach(s => { try { s.stop(); } catch(e){} });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
  };

  const handleCopyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const notifyUser = (title: string, body: string) => {
    if (document.visibilityState === 'hidden' && Notification.permission === "granted") {
      new Notification(title, {
        body,
        icon: 'https://cdn-icons-png.flaticon.com/512/3249/3249935.png'
      });
    }
  };

  // Fix: Explicitly type 'file' to avoid 'unknown' type errors on lines 95 and 97
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    for (const file of Array.from(files) as File[]) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const data = event.target?.result as string;
        setSelectedFiles(prev => [...prev, { data, mimeType: file.type, name: file.name }]);
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleScreenCapture = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      const dataUrl = canvas.toDataURL('image/png');
      setSelectedFiles(prev => [...prev, { data: dataUrl, mimeType: 'image/png', name: 'Captura de Tela' }]);
      
      stream.getTracks().forEach(t => t.stop());
    } catch (err) {
      console.error("Erro na captura de tela:", err);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setIsTranscribing(true);
        try {
          const text = await transcribeAudio(audioBlob);
          setIsTranscribing(false);
          if (text && text.trim()) {
            await processUserMessage(text);
          }
        } catch (err) {
          console.error("Erro na transcrição:", err);
          setIsTranscribing(false);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Erro ao iniciar gravação:", err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const startLiveMode = async () => {
    const ctx = await initAudioContexts();
    if (ctx.state === 'suspended') await ctx.resume();
    
    stopAllAudio();
    setIsLive(true);
    setLiveInputTranscription('');
    setLiveOutputTranscription('');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const liveSession = await connectLiveAgent(activeAgent, context, voicePreference, {
        onAudioChunk: async (base64) => {
          const buffer = await decodeAudioData(decodeBase64(base64), ctx, 24000, 1);
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(ctx.destination);
          nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
          source.start(nextStartTimeRef.current);
          nextStartTimeRef.current += buffer.duration;
          sourcesRef.current.add(source);
          source.onended = () => sourcesRef.current.delete(source);
        },
        onInterrupted: () => stopAllAudio(),
        onInputTranscription: (text) => setLiveInputTranscription(prev => prev + text),
        onOutputTranscription: (text) => setLiveOutputTranscription(prev => prev + text),
        onTurnComplete: () => {
          if (liveOutputTranscription) {
            notifyUser(`Hypley ${AGENTS[activeAgent].name}`, liveOutputTranscription);
          }
          setLiveInputTranscription('');
          setLiveOutputTranscription('');
        },
        onerror: (e) => {
          console.error(e);
          setIsLive(false);
        }
      });

      liveSessionRef.current = liveSession;

      const inputCtx = new AudioContext({ sampleRate: 16000 });
      const source = inputCtx.createMediaStreamSource(stream);
      const processor = inputCtx.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const int16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
        const base64 = encodeBase64(new Uint8Array(int16.buffer));
        liveSession.sendRealtimeInput({ media: { data: base64, mimeType: 'audio/pcm;rate=16000' } });
      };
      source.connect(processor);
      processor.connect(inputCtx.destination);

    } catch (err) {
      console.error(err);
      setIsLive(false);
    }
  };

  const stopLiveMode = () => {
    liveSessionRef.current?.close();
    liveSessionRef.current = null;
    setIsLive(false);
    stopAllAudio();
  };

  const processUserMessage = async (text: string) => {
    if (!text.trim() && selectedFiles.length === 0 || isTyping) return;
    
    const attachments = [...selectedFiles];
    setSelectedFiles([]);

    onSendMessage({ 
      sender: 'user', 
      content: text, 
      type: attachments.length > 0 ? 'image' : 'text', 
      imageUrl: attachments.length > 0 && attachments[0].mimeType.startsWith('image/') ? attachments[0].data : undefined,
      timestamp: new Date() 
    });
    
    setIsTyping(true);
    
    try {
      const isImageRequest = !attachments.length && /(gere|crie|desenhe|faca|gera)\s+(uma|um)?\s*(imagem|logo|mockup|layout|arte|ilustracao)/i.test(text);
      
      if (isImageRequest) {
        const agentMsgId = Date.now().toString();
        onSendMessage({ id: agentMsgId, sender: 'agent', agentType: activeAgent, content: 'Claro, meu amor! Criando sua imagem...', type: 'text', timestamp: new Date() });
        const imageUrl = await generateImage(text);
        setIsTyping(false);
        if (imageUrl) {
          onSendMessage({ id: agentMsgId, content: 'Aqui está, meu bem!', type: 'image', imageUrl, timestamp: new Date() });
          notifyUser(`Hypley ${AGENTS[activeAgent].name}`, "Sua imagem está pronta!");
        }
        return;
      }

      const stream = await getAgentResponseStream(
        activeAgent, 
        text || "Analise este arquivo para mim, baixinho.", 
        messages.map(m => ({ 
          role: m.sender === 'user' ? 'user' : 'model', 
          parts: [{ text: m.content }] 
        })) as any, 
        context,
        voicePreference,
        attachments
      );
      
      const agentMsgId = Date.now().toString();
      let full = '';
      
      onSendMessage({ id: agentMsgId, sender: 'agent', agentType: activeAgent, content: '', type: 'text', timestamp: new Date() });
      setIsTyping(false);

      for await (const chunk of stream) {
        const c = chunk as GenerateContentResponse;
        const t = c.text;
        if (t) {
          full += t;
          onSendMessage({ id: agentMsgId, sender: 'agent', agentType: activeAgent, content: full, type: 'text', timestamp: new Date() });
        }
      }
      
      notifyUser(`Hypley ${AGENTS[activeAgent].name}`, "Acabei de responder seu pedido, baixinho!");

    } catch (e) { 
      console.error("Erro no processamento:", e);
      setIsTyping(false); 
    }
  };

  const agent = AGENTS[activeAgent];
  const uniqueMessages: Message[] = Array.from(new Map<string, Message>(messages.map(m => [m.id, m])).values());

  return (
    <div className="flex flex-col h-full bg-[#020617] relative w-full overflow-hidden font-sans">
      <header className="h-16 px-4 py-2 border-b border-slate-800 flex items-center justify-between bg-[#0f172a] shrink-0 z-20 shadow-lg">
        <div className="flex items-center gap-3">
          <button onClick={onToggleSidebar} className="p-2 text-slate-400 hover:text-white rounded-xl transition-all">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 6h16M4 12h16M4 18h16"></path></svg>
          </button>
          <div className="flex items-center gap-3 cursor-pointer group" onClick={onToggleInfo}>
            <div className={`w-10 h-10 rounded-xl ${agent.color} flex items-center justify-center text-xl shrink-0 text-white shadow-xl group-hover:scale-105 transition-transform`}>{agent.icon}</div>
            <div className="min-w-0">
              <h2 className="text-[15px] font-bold text-slate-100 truncate flex items-center gap-2">{agent.fullName}</h2>
              <p className="text-[10px] text-blue-400 uppercase font-bold tracking-tighter">{voicePreference === 'carioca' ? 'Estilo Angelical 🧚‍♀️' : 'Modo Carinhoso ❤️'}</p>
            </div>
          </div>
        </div>

        <button 
          onClick={isLive ? stopLiveMode : startLiveMode}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-xs font-bold transition-all ${
            isLive ? 'bg-red-500 border-red-400 text-white animate-pulse' : 'bg-blue-600/10 border-blue-500/30 text-blue-400 hover:bg-blue-600 hover:text-white'
          }`}
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
          <span>{isLive ? 'TERMINAR CONVERSA' : 'CONVERSAR AGORA'}</span>
        </button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-4 custom-scrollbar bg-[#020617] relative">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:40px_40px] opacity-10 pointer-events-none"></div>

        {uniqueMessages.map((msg) => (
          <div key={msg.id} className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'} mb-2`}>
            <div className={`group/msg max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 shadow-xl relative text-sm leading-relaxed ${msg.sender === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-[#1e293b] text-slate-100 border border-slate-700/50 rounded-tl-none'}`}>
              <button 
                onClick={() => handleCopyText(msg.content, msg.id)}
                className={`absolute ${msg.sender === 'user' ? '-left-8' : '-right-8'} top-1/2 -translate-y-1/2 p-1.5 rounded-lg opacity-0 group-hover/msg:opacity-100 transition-all hover:bg-slate-800 text-slate-500 hover:text-white`}
                title="Copiar texto"
              >
                {copiedId === msg.id ? (
                  <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>
                )}
              </button>

              {msg.type === 'image' && msg.imageUrl && <img src={msg.imageUrl} className="mb-2 rounded-lg w-full h-auto border border-white/10" alt="Generated content" />}
              <div className="whitespace-pre-wrap font-medium">{msg.content}</div>
              <div className="text-[9px] opacity-40 mt-1.5 font-mono text-right">{msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
            </div>
          </div>
        ))}

        {isLive && (
          <div className="space-y-4 animate-fade-in">
            {liveInputTranscription && (
              <div className="flex justify-end mb-2">
                <div className="bg-blue-600/20 text-blue-300 border border-blue-500/30 px-4 py-2 rounded-2xl rounded-tr-none text-sm italic">
                  "{liveInputTranscription}"
                </div>
              </div>
            )}
            {liveOutputTranscription && (
              <div className="flex justify-start mb-2">
                <div className="bg-slate-800 text-slate-100 border border-slate-700 px-4 py-2 rounded-2xl rounded-tl-none text-sm font-medium">
                  {liveOutputTranscription}
                </div>
              </div>
            )}
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="flex gap-1.5 h-12 items-center">
                {[...Array(12)].map((_, i) => (
                  <div key={i} className="w-1.5 bg-blue-500 rounded-full animate-pulse" style={{ height: `${Math.random() * 100}%`, animationDelay: `${i * 0.1}s` }} />
                ))}
              </div>
              <span className="text-[10px] font-black uppercase tracking-widest text-blue-400 animate-pulse">IA está ouvindo você...</span>
            </div>
          </div>
        )}

        {(isTranscribing || isTyping) && (
          <div className="flex justify-start mb-4 animate-pulse">
            <div className="bg-[#1e293b] text-blue-400 border border-slate-700 px-4 py-2 rounded-2xl rounded-tl-none text-xs font-bold uppercase tracking-wider flex items-center gap-2">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce"></span>
              </div>
              {isTranscribing ? 'Ouvindo seu áudio...' : 'Hypley está pensando...'}
            </div>
          </div>
        )}
      </div>

      {!isLive && (
        <footer className="px-4 py-4 sm:px-6 flex flex-col gap-3 bg-[#0f172a] border-t border-slate-800 shrink-0 z-20">
          {selectedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 animate-fade-in">
              {selectedFiles.map((f, i) => (
                <div key={i} className="relative group/file">
                  {f.mimeType.startsWith('image/') ? (
                    <img src={f.data} className="w-16 h-16 object-cover rounded-lg border border-slate-700" alt="Preview" />
                  ) : (
                    <div className="w-16 h-16 bg-slate-800 border border-slate-700 rounded-lg flex items-center justify-center text-[8px] text-slate-300 font-bold p-1 overflow-hidden text-center">{f.name}</div>
                  )}
                  <button 
                    onClick={() => removeFile(i)}
                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-0.5 shadow-lg opacity-0 group-hover/file:opacity-100 transition-opacity"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" strokeWidth="3"/></svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-end gap-3">
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              multiple 
              onChange={handleFileChange}
              accept="image/*,application/pdf,text/plain" 
            />
            
            <div className="flex gap-1">
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="w-10 h-10 bg-slate-800 text-slate-400 hover:text-white rounded-xl flex items-center justify-center transition-all"
                title="Anexar arquivos/fotos"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.414a4 4 0 00-5.656-5.656l-6.415 6.414a6 6 0 108.486 8.486L20.5 13" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              
              <button 
                onClick={handleScreenCapture}
                className="w-10 h-10 bg-slate-800 text-slate-400 hover:text-white rounded-xl flex items-center justify-center transition-all"
                title="Capturar tela"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
            </div>

            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); processUserMessage(inputText); setInputText(''); } }}
              placeholder={isRecording ? "Gravando..." : "Perguntar com carinho..."}
              className={`flex-1 bg-[#1e293b] border-slate-700/50 border text-slate-100 text-sm py-3 px-4 rounded-xl resize-none focus:ring-2 focus:ring-blue-500/50 transition-all ${isRecording ? 'ring-2 ring-red-500/50 border-red-500/50' : ''}`}
              rows={1}
              disabled={isRecording}
            />
            
            <div className="flex items-center gap-2">
              {!inputText.trim() && selectedFiles.length === 0 ? (
                <button 
                  onMouseDown={startRecording}
                  onMouseUp={stopRecording}
                  onMouseLeave={stopRecording}
                  onTouchStart={startRecording}
                  onTouchEnd={stopRecording}
                  className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all shadow-lg active:scale-95 ${
                    isRecording 
                    ? 'bg-red-600 text-white animate-pulse shadow-red-900/40' 
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'
                  }`}
                  title="Segure para falar"
                >
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
                </button>
              ) : (
                <button 
                  onClick={() => { processUserMessage(inputText); setInputText(''); }}
                  className="w-12 h-12 bg-blue-600 hover:bg-blue-500 text-white rounded-xl flex items-center justify-center transition-all shadow-lg active:scale-95"
                >
                  <svg className="w-6 h-6 rotate-90" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                </button>
              )}
            </div>
          </div>
        </footer>
      )}
    </div>
  );
};

export default ChatWindow;
