
import React, { useState } from 'react';

interface FloatingOverlayProps {
  onToggleMain: () => void;
  isOpen: boolean;
}

const FloatingOverlay: React.FC<FloatingOverlayProps> = ({ onToggleMain, isOpen }) => {
  const [isSharing, setIsSharing] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const startScreenShare = async () => {
    try {
      const captureStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false
      });
      setStream(captureStream);
      setIsSharing(true);
      
      captureStream.getVideoTracks()[0].onended = () => {
        setIsSharing(false);
        setStream(null);
      };
    } catch (err) {
      console.error("Screen share error:", err);
    }
  };

  const stopScreenShare = () => {
    stream?.getTracks().forEach(track => track.stop());
    setIsSharing(false);
    setStream(null);
  };

  return (
    // md:flex hidden -> Garante que o botão só apareça em telas desktop
    <div className="hidden md:flex fixed top-6 right-6 z-[100] flex-col items-center gap-3 transition-all duration-500">
      {/* Monitor Icon Button */}
      <button 
        onClick={isSharing ? stopScreenShare : startScreenShare}
        className={`w-10 h-10 rounded-full shadow-2xl flex items-center justify-center transition-all duration-300 transform hover:scale-110 border-2 ${
          isSharing 
          ? 'bg-red-600 border-red-400 text-white animate-pulse' 
          : 'bg-[#1c1c1e] border-[#27272a] text-[#a1a1aa] hover:text-white backdrop-blur-md'
        }`}
        title="Compartilhar Tela"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
        </svg>
      </button>

      {/* Main "H" Logo Button */}
      <div className="relative">
        <button 
          onClick={onToggleMain}
          className={`w-14 h-14 rounded-full shadow-[0_0_30px_rgba(59,130,246,0.3)] flex items-center justify-center transition-all duration-500 transform hover:scale-110 active:scale-90 border-2 ${
            isOpen 
            ? 'bg-slate-900 text-white border-slate-700' 
            : 'bg-gradient-to-br from-[#3b82f6] via-[#6366f1] to-[#8b5cf6] text-white border-white/20'
          }`}
        >
          {isOpen ? (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          ) : (
            <span className="text-xl font-black tracking-tighter">H</span>
          )}
        </button>
        
        {!isOpen && (
          <div className="absolute -top-1 -right-1 w-6 h-6 bg-[#f43f5e] rounded-full border-2 border-[#020617] flex items-center justify-center text-[10px] font-black text-white shadow-lg animate-bounce">
            3
          </div>
        )}
      </div>

      {isSharing && (
        <div className="bg-[#1c1c1e]/80 backdrop-blur-sm border border-red-500/50 px-3 py-1 rounded-full text-[8px] text-red-500 font-black animate-pulse uppercase tracking-widest shadow-xl">
          REC
        </div>
      )}
    </div>
  );
};

export default FloatingOverlay;
