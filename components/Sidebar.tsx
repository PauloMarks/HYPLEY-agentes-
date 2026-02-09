
import React from 'react';
import { AgentType, Message } from '../types';
import { AGENTS } from '../constants';

interface SidebarProps {
  activeAgent: AgentType;
  onSelectAgent: (agent: AgentType) => void;
  isOpen: boolean;
  onClose: () => void;
  lastMessages: Message[];
}

const Sidebar: React.FC<SidebarProps> = ({ activeAgent, onSelectAgent, isOpen, onClose, lastMessages }) => {
  return (
    <>
      {/* Overlay Backdrop */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[65] transition-opacity"
          onClick={onClose}
        />
      )}

      <div className={`fixed left-0 top-0 z-[70] h-full bg-[#0f172a] border-r border-slate-800 flex flex-col transition-all duration-300 ease-in-out shadow-2xl ${
        isOpen ? 'w-full sm:w-[350px] translate-x-0' : 'w-0 -translate-x-full'
      } overflow-hidden shrink-0`}>
        
        {/* Sidebar Header - Blue Theme */}
        <div className="h-16 px-4 bg-[#1e293b] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
             <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-black text-sm">H</div>
             <h1 className="text-white font-bold tracking-tight">HYPLEY CANAIS</h1>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>

        {/* Search - Blue Theme */}
        <div className="p-3 bg-[#0f172a]">
          <div className="bg-[#1e293b] rounded-xl h-10 flex items-center px-4 gap-3 border border-slate-700/50">
            <svg className="w-4 h-4 text-slate-500" fill="currentColor" viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
            <input 
              type="text" 
              placeholder="Pesquisar agentes..." 
              className="bg-transparent border-none focus:ring-0 text-xs text-slate-200 placeholder-slate-500 flex-1"
            />
          </div>
        </div>

        {/* Agent Chat List */}
        <div className="flex-1 overflow-y-auto bg-[#0f172a] custom-scrollbar">
          {(Object.keys(AGENTS) as AgentType[]).map((type) => {
            const agent = AGENTS[type];
            const isActive = activeAgent === type;
            const agentMessages = lastMessages.filter(m => m.agentType === type);
            const lastMsg = agentMessages[agentMessages.length - 1];
            
            return (
              <button
                key={type}
                onClick={() => onSelectAgent(type)}
                className={`w-full flex items-center p-4 transition-all duration-200 relative group border-b border-slate-800/30 ${
                  isActive ? 'bg-blue-600/10' : 'hover:bg-slate-800/40'
                }`}
              >
                <div className={`w-12 h-12 rounded-2xl ${agent.color} flex items-center justify-center text-xl shrink-0 text-white shadow-xl shadow-black/20`}>
                  {agent.icon}
                </div>
                
                <div className="ml-4 flex-1 text-left min-w-0 pr-2">
                  <div className="flex justify-between items-center mb-0.5">
                    <h4 className={`text-[15px] font-semibold truncate ${isActive ? 'text-blue-400' : 'text-slate-100'}`}>{agent.fullName}</h4>
                    <span className="text-[10px] text-slate-500 font-mono">
                      {lastMsg ? lastMsg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                    </span>
                  </div>
                  <p className="text-[12px] text-slate-500 truncate italic">
                    {lastMsg ? lastMsg.content : agent.description}
                  </p>
                </div>

                {isActive && (
                  <div className="absolute right-0 top-2 bottom-2 w-1 rounded-l-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]"></div>
                )}
              </button>
            );
          })}
        </div>
        
        {/* Footer */}
        <div className="p-4 bg-[#1e293b] border-t border-slate-800 flex items-center justify-center gap-2">
           <span className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter">Powered by Hypley Engine</span>
        </div>
      </div>
    </>
  );
};

export default Sidebar;
