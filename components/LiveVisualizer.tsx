import React from 'react';

interface LiveVisualizerProps {
  isActive: boolean;
  volume: number; // 0 to 1
}

const LiveVisualizer: React.FC<LiveVisualizerProps> = ({ isActive, volume }) => {
  return (
    <div className="flex items-center justify-center gap-1 h-8 w-24">
      {[1, 2, 3, 4, 5].map((i) => {
        // Calculate dynamic height based on volume and random fluctuation when active
        const height = isActive 
          ? Math.max(20, Math.min(100, volume * 100 * (Math.random() * 1.5 + 0.5))) 
          : 10;
        
        return (
          <div
            key={i}
            className={`w-1.5 rounded-full transition-all duration-75 ${isActive ? 'bg-cyan-400' : 'bg-slate-600'}`}
            style={{ 
              height: `${height}%`,
            }}
          />
        );
      })}
    </div>
  );
};

export default LiveVisualizer;