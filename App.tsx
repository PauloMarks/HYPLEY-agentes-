
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

const EXPIRATION_TIME = 24 * 60 * 60 * 1000;

const App: React.FC = () => {
  const [activeAgent, setActiveAgent] = useState<AgentType>(AgentType.IDEIAS);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isAppOpen, setIsAppOpen] = useState(true);
  const [showProjectInfo, setShowProjectInfo] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [voicePreference, setVoicePreference] = useState<VoiceType>('baiana');
  const [isMobile, setIsMobile] = useState(false);
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

  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) setIsAppOpen(true);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);

    const savedContext = localStorage.getItem('hypley_context');
    if (savedContext) setContext(JSON.parse(savedContext));
    
    const savedVoice = localStorage.getItem('hypley_voice') as VoiceType;
    if (savedVoice) setVoicePreference(savedVoice);

    const savedMessages = localStorage.getItem('hypley_messages');
    const now = Date.now();
    
    if (savedMessages) {
      try {
        const parsed: Message[] = JSON.parse(savedMessages);
        const validMessages = parsed
          .map(m => ({ ...m, timestamp: new Date(m.timestamp) }))
          .filter(m => (now - m.timestamp.getTime()) < EXPIRATION_TIME);
        setMessages(validMessages.length > 0 ? validMessages : INITIAL_MESSAGES);
      } catch (e) {
        setMessages(INITIAL_MESSAGES);
      }
    } else {
      setMessages(INITIAL_MESSAGES);
    }

    syncChannel.current = new BroadcastChannel('hypley_sync');
    syncChannel.current.onmessage = (event) => {
      const { type, payload } = event.data;
      if (type === 'NEW_MESSAGE') {
        const msg = payload as Message;
        msg.timestamp = new Date(msg.timestamp);
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

    return () => {
      syncChannel.current?.close();
      window.removeEventListener('resize', checkMobile);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('hypley_context', JSON.stringify(context));
    localStorage.setItem('hypley_voice', voicePreference);
    if (messages.length > 0) {
      localStorage.setItem('hypley_messages', JSON.stringify(messages));
    }
  }, [context, voicePreference, messages]);

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
  }, []);

  const handleSelectAgent = (agent: AgentType) => {
    setActiveAgent(agent);
    setIsSidebarOpen(false);
    const hasAgentChat = messages.some(m => m.agentType === agent);
    if (!hasAgentChat) {
      handleSendMessage({
        sender: 'agent',
        agentType: agent,
        content: `Módulo Hypley ${agent.charAt(0).toUpperCase() + agent.slice(1)} ativado. Como posso te ajudar, meu amor?`,
        timestamp: new Date(),
        type: 'text'
      });
    }
  };

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#020617] relative text-slate-100 font-sans">
      <FloatingOverlay isOpen={isAppOpen} onToggleMain={() => setIsAppOpen(!isAppOpen)} />

      <div className={`flex w-full h-full transition-all duration-300 ease-in-out ${isAppOpen ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}`}>
        <Sidebar activeAgent={activeAgent} onSelectAgent={handleSelectAgent} isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} lastMessages={messages} />

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
            <div className="space-y-4">
              <label className="text-[11px] text-blue-400 font-bold uppercase tracking-wider">Projeto Ativo</label>
              <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700">
                <div className="text-sm font-bold text-white mb-1">{context.name}</div>
                <div className="text-[10px] text-slate-500 italic">As vozes podem ser alteradas no centro da tela durante o Modo Voz.</div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default App;
