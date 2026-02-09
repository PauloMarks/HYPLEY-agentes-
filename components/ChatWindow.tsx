
import React, { useState, useRef, useEffect } from 'react';
import { Message, AgentType, ProjectContext, VoiceType, Attachment } from '../types';
import { AGENTS } from '../constants';
import { 
  getAgentResponseStream, 
  transcribeAudio, 
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
  const [liveCopiedType, setLiveCopiedType] = useState<'input' | 'output' | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Attachment[]>([]);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const liveSessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  
  const accumulatedInputRef = useRef('');
  const accumulatedOutputRef = useRef('');
  const syncChannel = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    syncChannel.current = new BroadcastChannel('hypley_live_sync');
    syncChannel.current.onmessage = (event) => {
      const { type, payload } = event.data;
      if (type === 'LIVE_STATE') {
        setIsLive(payload.active);
        setLiveInputTranscription(payload.input || '');
        setLiveOutputTranscription(payload.output || '');
      }
    };
    return () => syncChannel.current?.close();
  }, []);

  const broadcastLiveState = (active: boolean, input?: string, output?: string) => {
    syncChannel.current?.postMessage({
      type: 'LIVE_STATE',
      payload: { active, input, output }
    });
  };

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isTyping, liveInputTranscription, liveOutputTranscription, isTranscribing, selectedFiles, isLive]);

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
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const handleCopyLive = (text: string, type: 'input' | 'output') => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setLiveCopiedType(type);
      setTimeout(() => setLiveCopiedType(null), 2000);
    });
  };

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

  const startRecording = async () => {
    if (isLive) return; 
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
          if (text && text.trim()) await processUserMessage(text);
        } catch (err) {
          setIsTranscribing(false);
        }
      };
      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const startLiveMode = async (currentVoice: VoiceType = voicePreference) => {
    const ctx = await initAudioContexts();
    if (ctx.state === 'suspended') await ctx.resume();
    stopAllAudio();
    setIsLive(true);
    broadcastLiveState(true);
    setLiveInputTranscription('');
    setLiveOutputTranscription('');
    accumulatedInputRef.current = '';
    accumulatedOutputRef.current = '';

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const liveSession = await connectLiveAgent(activeAgent, context, currentVoice, {
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
        onInputTranscription: (text) => {
          setLiveInputTranscription(prev => {
            const val = prev + text;
            broadcastLiveState(true, val, accumulatedOutputRef.current);
            return val;
          });
          accumulatedInputRef.current += text;
        },
        onOutputTranscription: (text) => {
          setLiveOutputTranscription(prev => {
            const val = prev + text;
            broadcastLiveState(true, accumulatedInputRef.current, val);
            return val;
          });
          accumulatedOutputRef.current += text;
        },
        onTurnComplete: () => {
          if (accumulatedInputRef.current.trim()) {
            onSendMessage({ sender: 'user', content: accumulatedInputRef.current, type: 'text', timestamp: new Date() });
          }
          if (accumulatedOutputRef.current.trim()) {
            onSendMessage({ sender: 'agent', agentType: activeAgent, content: accumulatedOutputRef.current, type: 'text', timestamp: new Date() });
          }
          setLiveInputTranscription('');
          setLiveOutputTranscription('');
          broadcastLiveState(true, '', '');
          accumulatedInputRef.current = '';
          accumulatedOutputRef.current = '';
        },
        onerror: (e) => {
          setIsLive(false);
          broadcastLiveState(false);
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
      setIsLive(false);
      broadcastLiveState(false);
    }
  };

  const stopLiveMode = () => {
    liveSessionRef.current?.close();
    liveSessionRef.current = null;
    setIsLive(false);
    broadcastLiveState(false);
    stopAllAudio();
  };

  const handleVoiceChange = (v: VoiceType) => {
    setVoicePreference(v);
    if (isLive) {
      stopLiveMode();
      setTimeout(() => startLiveMode(v), 300);
    }
  };

  const processUserMessage = async (text: string) => {
    if (!text.trim() && selectedFiles.length === 0 || isTyping) return;
    const attachments = [...selectedFiles];
    setSelectedFiles([]);
    onSendMessage({ sender: 'user', content: text, type: attachments.length > 0 ? 'image' : 'text', attachments, timestamp: new Date() });
    setIsTyping(true);
    try {
      const isImageRequest = !attachments.length && /(gere|crie|desenhe|faca|gera)\s+(uma|um)?\s*(imagem|logo|mockup|layout|arte|ilustracao)/i.test(text);
      if (isImageRequest) {
        const agentMsgId = Date.now().toString();
        onSendMessage({ id: agentMsgId, sender: 'agent', agentType: activeAgent, content: 'Criando sua imagem...', type: 'text', timestamp: new Date() });
        const imageUrl = await generateImage(text);
        setIsTyping(false);
        if (imageUrl) onSendMessage({ id: agentMsgId, content: 'Imagem pronta!', type: 'image', imageUrl, timestamp: new Date() });
        return;
      }
      const stream = await getAgentResponseStream(activeAgent, text || "O que você acha disso, uai?", messages.map(m => ({ role: m.sender === 'user' ? 'user' : 'model', parts: [{ text: m.content }] })) as any, context, voicePreference, attachments);
      const agentMsgId = Date.now().toString();
      let full = '';
      onSendMessage({ id: agentMsgId, sender: 'agent', agentType: activeAgent, content: '', type: 'text', timestamp: new Date() });
      setIsTyping(false);
      for await (const chunk of stream) {
        const t = (chunk as GenerateContentResponse).text;
        if (t) {
          full += t;
          onSendMessage({ id: agentMsgId, sender: 'agent', agentType: activeAgent, content: full, type: 'text', timestamp: new Date() });
        }
      }
    } catch (e) { 
      setIsTyping(false); 
    }
  };

  const agent = AGENTS[activeAgent];
  const uniqueMessages: Message[] = Array.from(new Map<string, Message>(messages.map(m => [m.id, m])).values());

  return (
    <div className="flex flex-col h-full bg-[#020617] relative w-full overflow-hidden font-sans">
      <header className="h-14 px-4 border-b border-slate-800/50 flex items-center justify-between bg-[#0f172a] shrink-0 z-40">
        <div className="flex items-center gap-3">
          <button onClick={onToggleSidebar} className="text-slate-400 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 6h16M4 12h16M4 18h16"></path></svg>
          </button>
          
          <div className="flex items-center gap-1.5 ml-1 border-l border-slate-700/50 pl-3">
            <button 
              onClick={() => handleVoiceChange('baiana')}
              className={`w-7 h-7 rounded-lg text-[10px] font-black transition-all ${voicePreference === 'baiana' ? 'bg-blue-600 text-white shadow-lg' : 'bg-slate-800 text-slate-500 hover:text-slate-300'}`}
              title="Voz Baiana ❤️"
            >B</button>
            <button 
              onClick={() => handleVoiceChange('pernambucana')}
              className={`w-7 h-7 rounded-lg text-[10px] font-black transition-all ${voicePreference === 'pernambucana' ? 'bg-pink-500 text-white shadow-lg' : 'bg-slate-800 text-slate-500 hover:text-slate-300'}`}
              title="Voz Pernambucana ✨"
            >P</button>
            <button 
              onClick={() => handleVoiceChange('carioca')}
              className={`w-7 h-7 rounded-lg text-[10px] font-black transition-all ${voicePreference === 'carioca' ? 'bg-cyan-600 text-white shadow-lg' : 'bg-slate-800 text-slate-500 hover:text-slate-300'}`}
              title="Voz Carioca 🧚‍♀️"
            >C</button>
            <button 
              onClick={() => handleVoiceChange('mineira')}
              className={`w-7 h-7 rounded-lg text-[10px] font-black transition-all ${voicePreference === 'mineira' ? 'bg-yellow-500 text-white shadow-lg' : 'bg-slate-800 text-slate-500 hover:text-slate-300'}`}
              title="Voz Mineira (Joelma Style) 🧀"
            >M</button>
          </div>

          <div className="flex items-center gap-2 cursor-pointer ml-2" onClick={onToggleInfo}>
             <div className="text-xs font-bold text-slate-300 hidden sm:block">{agent.fullName}</div>
          </div>
        </div>

        <button 
          onClick={isLive ? stopLiveMode : () => startLiveMode()}
          className={`text-[10px] font-black px-4 py-1.5 rounded-full border transition-all ${
            isLive ? 'bg-red-500 border-red-400 text-white animate-pulse shadow-red-500/20 shadow-lg' : 'bg-blue-600 text-white border-blue-400 shadow-lg shadow-blue-500/20'
          }`}
        >
          {isLive ? 'DESATIVAR VOZ' : 'FALAR AGORA'}
        </button>
      </header>

      <div className="flex-1 relative flex flex-col overflow-hidden">
        {/* MODO VOZ: Overlay Translúcido com Opções de Cópia */}
        {isLive && (
          <div className="absolute inset-0 z-50 bg-[#020617]/95 backdrop-blur-xl flex flex-col items-center justify-center p-8 sm:p-20 text-center animate-fade-in">
             <div className="max-w-4xl w-full flex flex-col items-center gap-12">
                
                {/* Sua fala no Modo Voz */}
                {liveInputTranscription && (
                  <div className="group relative w-full px-6">
                    <p className="text-blue-400/70 text-base sm:text-lg italic font-medium leading-relaxed transition-all mb-2">
                      "{liveInputTranscription}"
                    </p>
                    <button 
                      onClick={() => handleCopyLive(liveInputTranscription, 'input')}
                      className="absolute -right-2 top-0 p-2 bg-slate-800/50 rounded-lg opacity-0 group-hover:opacity-100 transition-all hover:bg-slate-700"
                      title="Copiar minha fala"
                    >
                      {liveCopiedType === 'input' ? <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"/></svg> : <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                    </button>
                  </div>
                )}

                {/* Resposta da IA no Modo Voz */}
                {liveOutputTranscription ? (
                  <div className="group relative w-full px-6">
                    <p className="text-slate-100 text-2xl sm:text-4xl font-bold leading-tight animate-fade-in transition-all">
                      {liveOutputTranscription}
                    </p>
                    <button 
                      onClick={() => handleCopyLive(liveOutputTranscription, 'output')}
                      className="absolute -right-2 top-0 p-2 bg-blue-600/20 rounded-lg opacity-0 group-hover:opacity-100 transition-all hover:bg-blue-600/40"
                      title="Copiar resposta da hypley"
                    >
                      {liveCopiedType === 'output' ? <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"/></svg> : <svg className="w-4 h-4 text-slate-100" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-6">
                    <div className="w-3 h-3 bg-blue-500 rounded-full animate-ping"></div>
                    <p className="text-slate-600 text-[10px] uppercase tracking-[0.5em] font-black">Escutando você com carinho...</p>
                  </div>
                )}
             </div>
             
             <button onClick={stopLiveMode} className="absolute bottom-12 px-8 py-3.5 rounded-2xl bg-[#1e293b] text-[10px] text-slate-400 hover:text-white transition-all uppercase font-black tracking-[0.3em] border border-slate-800 shadow-2xl flex items-center gap-4">
               <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M10 19l-7-7m0 0l7-7m-7 7h18"/></svg>
               Voltar ao Histórico
             </button>
          </div>
        )}

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 sm:p-12 space-y-6 custom-scrollbar pt-10 pb-24">
          {uniqueMessages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[95%] sm:max-w-[85%] rounded-2xl px-5 py-4 text-[14px] leading-relaxed relative group shadow-sm transition-all ${
                msg.sender === 'user' 
                ? 'bg-blue-600 text-white rounded-tr-none shadow-blue-500/10' 
                : 'bg-[#1e293b] text-slate-100 border border-slate-800 rounded-tl-none'
              }`}>
                {/* Botão de Cópia Persistente no Chat */}
                <button 
                  onClick={() => handleCopyText(msg.content, msg.id)}
                  className={`absolute ${msg.sender === 'user' ? '-left-10' : '-right-10'} top-2 p-2 bg-[#020617] border border-slate-800 rounded-xl opacity-0 group-hover:opacity-100 transition-all hover:scale-110 active:scale-95 z-10 shadow-xl`}
                >
                  {copiedId === msg.id ? (
                    <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
                  ) : (
                    <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>
                  )}
                </button>

                {msg.attachments?.map((att, i) => att.mimeType.startsWith('image/') && (
                  <img key={i} src={att.data} className="mb-3 rounded-xl max-h-80 w-auto shadow-lg border border-white/5" alt="attachment" />
                ))}
                
                {msg.type === 'image' && msg.imageUrl && <img src={msg.imageUrl} className="mb-3 rounded-xl shadow-lg border border-white/5" alt="AI gen" />}
                
                <div className="whitespace-pre-wrap font-medium">{msg.content}</div>
                
                <div className="mt-3 text-[9px] opacity-20 font-mono text-right uppercase tracking-widest">
                  {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          ))}

          {isTyping && (
             <div className="text-[9px] text-blue-500 font-black uppercase tracking-[0.3em] animate-pulse pl-2">Desenhando soluções doces...</div>
          )}
        </div>
      </div>

      <footer className="p-4 sm:p-6 bg-[#0f172a] border-t border-slate-800/40">
        <div className="max-w-5xl mx-auto flex items-end gap-3">
          <input type="file" ref={fileInputRef} className="hidden" multiple onChange={handleFileChange} />
          
          <button 
            onClick={() => fileInputRef.current?.click()} 
            className="w-12 h-12 rounded-2xl bg-[#1e293b] text-slate-500 hover:text-white flex items-center justify-center transition-colors border border-slate-800 shadow-sm"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.414a4 4 0 00-5.656-5.656l-6.415 6.414a6 6 0 108.486 8.486L20.5 13" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          
          <div className="flex-1 relative">
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); processUserMessage(inputText); setInputText(''); } }}
              placeholder="O que vamos criar hoje, uai?"
              className="w-full bg-[#1e293b] text-white text-[15px] py-3.5 px-5 rounded-2xl resize-none outline-none focus:ring-2 focus:ring-blue-500/10 border border-slate-800 transition-all min-h-[52px] max-h-32 shadow-inner"
              rows={1}
            />
          </div>

          <div className="flex gap-2">
            {!inputText.trim() && selectedFiles.length === 0 ? (
              <button 
                onMouseDown={startRecording} onMouseUp={stopRecording}
                className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all shadow-xl ${
                  isRecording ? 'bg-red-600 text-white animate-pulse scale-110' : 'bg-slate-800 text-slate-500'
                }`}
              >
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
              </button>
            ) : (
              <button 
                onClick={() => { processUserMessage(inputText); setInputText(''); }}
                className="w-12 h-12 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl flex items-center justify-center transition-all shadow-xl active:scale-90"
              >
                <svg className="w-6 h-6 rotate-90" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
              </button>
            )}
          </div>
        </div>
        
        {selectedFiles.length > 0 && (
          <div className="max-w-5xl mx-auto flex flex-wrap gap-2 mt-3">
             {selectedFiles.map((f, i) => (
               <div key={i} className="relative group">
                 {f.mimeType.startsWith('image/') ? (
                    <img src={f.data} className="w-12 h-12 object-cover rounded-lg border border-slate-700" alt="preview" />
                 ) : (
                    <div className="w-12 h-12 bg-slate-800 rounded-lg flex items-center justify-center text-[8px] text-slate-500">{f.name.slice(0,5)}</div>
                 )}
                 <button onClick={() => removeFile(i)} className="absolute -top-1 -right-1 bg-red-500 rounded-full p-0.5 text-white shadow-lg"><svg className="w-2 h-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" strokeWidth="3"/></svg></button>
               </div>
             ))}
          </div>
        )}
      </footer>
    </div>
  );
};

export default ChatWindow;
