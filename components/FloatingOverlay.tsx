
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
    <div className="fixed top-6 right-6 z-[100] hidden md:flex flex-col items-center gap-3">
      {/* Monitor Icon Button (Top) */}
      <button 
        onClick={isSharing ? stopScreenShare : startScreenShare}
        className={`w-10 h-10 rounded-full shadow-lg flex items-center justify-center transition-all duration-300 transform hover:scale-110 border-2 ${
          isSharing 
          ? 'bg-red-600 border-red-400 text-white animate-pulse' 
          : 'bg-[#1c1c1e] border-[#27272a] text-[#a1a1aa] hover:text-white'
        }`}
        title="Compartilhar Tela"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
        </svg>
      </button>

      {/* Main "H" Logo Button (Bottom) */}
      <div className="relative">
        <button 
          onClick={onToggleMain}
          className={`w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-all duration-500 transform hover:scale-105 active:scale-95 border-2 ${
            isOpen 
            ? 'bg-zinc-800 text-white border-zinc-700' 
            : 'bg-gradient-to-br from-[#8b5cf6] via-[#6366f1] to-[#3b82f6] text-white border-white/10'
          }`}
        >
          {isOpen ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          ) : (
            <span className="text-lg font-bold tracking-tighter ml-[-1px]">H</span>
          )}
        </button>
        
        {/* Notification Badge */}
        {!isOpen && (
          <div className="absolute top-0 right-0 w-5 h-5 bg-[#f43f5e] rounded-full border border-[#020617] flex items-center justify-center text-[10px] font-black text-white shadow-md ring-1 ring-black/20">
            3
          </div>
        )}
      </div>

      {isSharing && (
        <div className="bg-[#1c1c1e] border border-red-500/50 px-2 py-0.5 rounded-full text-[7px] text-red-500 font-bold animate-pulse uppercase tracking-tighter">
          REC
        </div>
      )}
    </div>
  );
};

export default FloatingOverlay;
