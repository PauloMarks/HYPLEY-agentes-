
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { AgentType, Message, ProjectContext, VoiceType } from './types';
import Sidebar from './components/Sidebar';
import ChatWindow from './components/ChatWindow';
import FloatingOverlay from './components/FloatingOverlay';

const INITIAL_MESSAGES: Message[] = [
  {
    id: '1',
    sender: 'agent',
    agentType: AgentType.IDEIAS,
    content: 'Olá meu bem! Sou o hypley Ideias. Sou sua inteligência central para novos negócios. Como podemos transformar sua visão em um SaaS de sucesso hoje, baixinho?',
    timestamp: new Date(),
    type: 'text'
  }
];

const App: React.FC = () => {
  const [activeAgent, setActiveAgent] = useState<AgentType>(AgentType.IDEIAS);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isAppOpen, setIsAppOpen] = useState(true);
  const [showProjectInfo, setShowProjectInfo] = useState(false);
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [voicePreference, setVoicePreference] = useState<VoiceType>('baiana');
  const [context, setContext] = useState<ProjectContext>({
    name: 'Projeto HYPLEY',
    description: '',
    stack: '',
    features: [],
    marketAnalysis: '',
    architecturePlan: '',
    marketingStrategy: ''
  });

  const syncChannel = useRef<BroadcastChannel | null>(null);

  // Inicializa Canal de Sincronização entre Abas
  useEffect(() => {
    syncChannel.current = new BroadcastChannel('hypley_sync');
    
    syncChannel.current.onmessage = (event) => {
      const { type, payload } = event.data;
      if (type === 'NEW_MESSAGE') {
        const msg = payload as Message;
        msg.timestamp = new Date(msg.timestamp); // Reconverte data
        setMessages(prev => {
          const exists = prev.find(m => m.id === msg.id);
          if (exists) return prev.map(m => m.id === msg.id ? msg : m);
          return [...prev, msg];
        });
      } else if (type === 'UPDATE_CONTEXT') {
        setContext(payload);
      } else if (type === 'UPDATE_VOICE') {
        setVoicePreference(payload);
      }
    };

    // Solicita permissão de notificação para segundo plano
    if ("Notification" in window) {
      Notification.requestPermission();
    }

    return () => syncChannel.current?.close();
  }, []);

  useEffect(() => {
    const savedContext = localStorage.getItem('hypley_context');
    if (savedContext) setContext(JSON.parse(savedContext));
    const savedVoice = localStorage.getItem('hypley_voice') as VoiceType;
    if (savedVoice) setVoicePreference(savedVoice);
  }, []);

  useEffect(() => {
    localStorage.setItem('hypley_context', JSON.stringify(context));
    localStorage.setItem('hypley_voice', voicePreference);
  }, [context, voicePreference]);

  const handleSendMessage = useCallback((msg: Partial<Message>, skipSync: boolean = false) => {
    let newMessage: Message;
    setMessages(prev => {
      const existing = prev.find(m => m.id === msg.id);
      if (msg.id && existing) {
        newMessage = { ...existing, ...msg } as Message;
        if (!skipSync) syncChannel.current?.postMessage({ type: 'NEW_MESSAGE', payload: newMessage });
        return prev.map(m => m.id === msg.id ? newMessage : m);
      }
      
      newMessage = {
        id: msg.id || Date.now().toString(),
        sender: msg.sender || 'user',
        agentType: msg.agentType,
        content: msg.content || '',
        timestamp: msg.timestamp || new Date(),
        type: msg.type || 'text',
        audioBlob: msg.audioBlob,
        fileUrl: msg.fileUrl,
        imageUrl: msg.imageUrl,
        sources: msg.sources
      };
      
      if (!skipSync) syncChannel.current?.postMessage({ type: 'NEW_MESSAGE', payload: newMessage });
      return [...prev, newMessage];
    });

    if (msg.sender === 'user' && msg.content) {
      const lowerContent = msg.content.toLowerCase();
      if (lowerContent.includes('projeto:')) {
        const name = msg.content.split(/projeto:/i)[1]?.split('\n')[0].trim();
        if (name) {
          const newContext = { ...context, name };
          setContext(newContext);
          syncChannel.current?.postMessage({ type: 'UPDATE_CONTEXT', payload: newContext });
        }
      }
    }
  }, [context]);

  const handleSelectAgent = (agent: AgentType) => {
    setActiveAgent(agent);
    setIsSidebarOpen(false);
    
    const hasAgentChat = messages.some(m => m.agentType === agent);
    if (!hasAgentChat) {
      handleSendMessage({
        sender: 'agent',
        agentType: agent,
        content: `Módulo Hypley ${agent.charAt(0).toUpperCase() + agent.slice(1)} ativado, meu amor. Analisando o projeto "${context.name}"... Em que posso te ajudar agora?`,
        timestamp: new Date(),
        type: 'text'
      });
    }
  };

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#020617] relative text-slate-100 font-sans">
      <FloatingOverlay 
        isOpen={isAppOpen} 
        onToggleMain={() => setIsAppOpen(!isAppOpen)} 
      />

      <div className={`flex w-full h-full transition-all duration-300 ease-in-out ${
        isAppOpen ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'
      }`}>
        <Sidebar 
          activeAgent={activeAgent} 
          onSelectAgent={handleSelectAgent} 
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          lastMessages={messages}
        />

        <main className="flex-1 flex flex-col h-full bg-[#020617] relative overflow-hidden">
          <ChatWindow 
            activeAgent={activeAgent}
            messages={messages.filter(m => m.sender === 'user' || m.agentType === activeAgent)}
            onSendMessage={handleSendMessage}
            context={context}
            onToggleSidebar={toggleSidebar}
            isSidebarOpen={isSidebarOpen}
            onToggleInfo={() => setShowProjectInfo(!showProjectInfo)}
            voicePreference={voicePreference}
            setVoicePreference={(v) => {
              setVoicePreference(v);
              syncChannel.current?.postMessage({ type: 'UPDATE_VOICE', payload: v });
            }}
          />
        </main>

        <aside className={`${showProjectInfo ? 'w-80 border-l border-slate-800' : 'w-0'} transition-all duration-300 bg-[#0f172a] flex flex-col shrink-0 overflow-hidden`}>
          <div className="p-5 h-16 flex items-center bg-[#1e293b] shrink-0">
            <button onClick={() => setShowProjectInfo(false)} className="mr-4 text-slate-400">
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
            <h3 className="text-slate-100 font-medium">Informações</h3>
          </div>
          
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div className="space-y-2">
              <label className="text-[11px] text-blue-400 font-bold uppercase tracking-wider">Projeto Ativo</label>
              <div className="p-3 bg-slate-800/50 rounded-lg text-sm border border-slate-700 font-bold text-white">{context.name}</div>
            </div>

            <div className="space-y-4">
              <label className="text-[11px] text-blue-400 font-bold uppercase tracking-wider">Configuração de Voz</label>
              <div className="flex flex-col gap-2">
                <button 
                  onClick={() => {
                    setVoicePreference('baiana');
                    syncChannel.current?.postMessage({ type: 'UPDATE_VOICE', payload: 'baiana' });
                  }}
                  className={`flex items-center justify-between p-3 rounded-xl border transition-all ${voicePreference === 'baiana' ? 'bg-blue-600/20 border-blue-500 text-blue-400' : 'bg-slate-800/50 border-slate-700 text-slate-400'}`}
                >
                  <div className="flex flex-col items-start">
                    <span className="text-sm font-bold">Voz Baiana</span>
                    <span className="text-[10px] opacity-60">Amorosa e Acolhedora</span>
                  </div>
                  {voicePreference === 'baiana' && <div className="w-2 h-2 rounded-full bg-blue-500 shadow-lg shadow-blue-500"></div>}
                </button>
                <button 
                  onClick={() => {
                    setVoicePreference('carioca');
                    syncChannel.current?.postMessage({ type: 'UPDATE_VOICE', payload: 'carioca' });
                  }}
                  className={`flex items-center justify-between p-3 rounded-xl border transition-all ${voicePreference === 'carioca' ? 'bg-blue-600/20 border-blue-500 text-blue-400' : 'bg-slate-800/50 border-slate-700 text-slate-400'}`}
                >
                  <div className="flex flex-col items-start">
                    <span className="text-sm font-bold">Voz Carioca</span>
                    <span className="text-[10px] opacity-60">Estilo Xuxa (Angelical) 🧚‍♀️</span>
                  </div>
                  {voicePreference === 'carioca' && <div className="w-2 h-2 rounded-full bg-blue-500 shadow-lg shadow-blue-500"></div>}
                </button>
              </div>
            </div>

            <div className="space-y-3 pt-4 border-t border-slate-800">
              <label className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">Agentes em Background</label>
              <div className="grid grid-cols-1 gap-2">
                {Object.values(AgentType).map((type) => (
                  <div key={type} className={`flex items-center gap-3 p-2.5 rounded-xl border transition-all ${messages.some(m => m.agentType === type) ? 'border-blue-500/30 bg-blue-500/5 text-blue-400' : 'border-slate-800 text-slate-600 opacity-50'}`}>
                    <div className="w-2 h-2 rounded-full bg-current animate-pulse"></div>
                    <span className="text-[11px] font-bold uppercase">{type}</span>
                    <span className="ml-auto text-[9px] font-mono">ON</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default App;
