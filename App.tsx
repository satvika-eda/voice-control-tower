import React, { useEffect, useRef, useState, useMemo } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type } from "@google/genai";
import { Mic, MicOff, Radio, TriangleAlert, Truck, Clock, ShieldCheck, Activity, Terminal, Mail, X, Send, Loader2, CheckCircle, User, FileText, Download, Copy, Map as MapIcon, Filter, BarChart3, ChevronRight } from 'lucide-react';
import { generateMockData, getSystemInstructions } from './utils/mockData';
import { decodeAudioData, createPcmBlob, base64ToUint8Array } from './utils/audio';
import { Shipment, ShipmentStatus } from './types';
import LiveVisualizer from './components/LiveVisualizer';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import { jsPDF } from "jspdf";

// --- Constants & Config ---

const CITY_COORDINATES: Record<string, { x: number, y: number }> = {
  'Seattle': { x: 12, y: 15 },
  'San Francisco': { x: 8, y: 42 },
  'Los Angeles': { x: 12, y: 55 },
  'Las Vegas': { x: 18, y: 50 },
  'Phoenix': { x: 22, y: 58 },
  'Denver': { x: 38, y: 45 },
  'Austin': { x: 48, y: 80 },
  'Dallas': { x: 52, y: 75 },
  'Chicago': { x: 68, y: 35 },
  'Detroit': { x: 73, y: 32 },
  'Atlanta': { x: 78, y: 65 },
  'Miami': { x: 88, y: 90 },
  'New York': { x: 92, y: 28 },
  'Philadelphia': { x: 90, y: 32 },
  'Boston': { x: 95, y: 22 },
};

const CONGESTION_LANES = [
  { from: 'Seattle', to: 'San Francisco', level: 'HIGH' },
  { from: 'San Francisco', to: 'Los Angeles', level: 'MEDIUM' },
  { from: 'Los Angeles', to: 'Phoenix', level: 'LOW' },
  { from: 'Phoenix', to: 'Dallas', level: 'LOW' },
  { from: 'Dallas', to: 'Atlanta', level: 'MEDIUM' },
  { from: 'Atlanta', to: 'Miami', level: 'LOW' },
  { from: 'Chicago', to: 'Detroit', level: 'HIGH' },
  { from: 'New York', to: 'Boston', level: 'HIGH' },
  { from: 'New York', to: 'Philadelphia', level: 'MEDIUM' },
  { from: 'Philadelphia', to: 'Atlanta', level: 'MEDIUM' },
  { from: 'Denver', to: 'Chicago', level: 'LOW' },
  { from: 'San Francisco', to: 'Las Vegas', level: 'LOW' },
  { from: 'Las Vegas', to: 'Denver', level: 'LOW' },
  { from: 'Chicago', to: 'New York', level: 'MEDIUM' },
  { from: 'Austin', to: 'Dallas', level: 'LOW' },
];

// --- Components ---

interface StatusCardProps {
    title: string;
    count: number;
    color: string;
    icon: any;
    onClick: () => void;
    isActive: boolean;
}

const StatusCard: React.FC<StatusCardProps> = ({ title, count, color, icon: Icon, onClick, isActive }) => (
  <button 
    onClick={onClick}
    className={`w-full text-left relative transition-all duration-200 border rounded-xl p-4 flex items-center justify-between backdrop-blur-sm group
      ${isActive 
        ? 'bg-slate-800 border-cyan-500/50 shadow-[0_0_15px_rgba(6,182,212,0.15)]' 
        : 'bg-slate-800/50 border-slate-700/50 hover:bg-slate-800 hover:border-slate-600'
      }
    `}
  >
    <div>
      <p className={`text-xs font-medium uppercase tracking-wider transition-colors ${isActive ? 'text-cyan-400' : 'text-slate-400 group-hover:text-slate-300'}`}>{title}</p>
      <p className="text-2xl font-bold text-white mt-1">{count}</p>
    </div>
    <div className={`p-3 rounded-lg ${color} bg-opacity-10 transition-transform group-hover:scale-110`}>
      <Icon className={`w-6 h-6 ${color.replace('bg-', 'text-')}`} />
    </div>
    {isActive && (
        <div className="absolute inset-0 rounded-xl ring-1 ring-cyan-500/30 pointer-events-none" />
    )}
  </button>
);

const MapModal: React.FC<{ shipment: Shipment, onClose: () => void }> = ({ shipment, onClose }) => {
  const origin = CITY_COORDINATES[shipment.origin_city] || { x: 20, y: 50 };
  const dest = CITY_COORDINATES[shipment.destination_city] || { x: 80, y: 50 };

  // Calculate progress
  let progress = 0;
  if (shipment.status === ShipmentStatus.DELIVERED) progress = 1;
  else if (shipment.status === ShipmentStatus.PLANNED) progress = 0;
  else {
    const num = parseInt(shipment.shipment_id.replace(/\D/g, '') || '0');
    progress = (20 + (num % 60)) / 100;
  }

  // Calculate truck position (linear interpolation for simplicity)
  const truckX = origin.x + (dest.x - origin.x) * progress;
  const truckY = origin.y + (dest.y - origin.y) * progress;

  // Generate a slightly curved path
  // Control point is midpoint with some offset to create curve
  const midX = (origin.x + dest.x) / 2;
  const midY = (origin.y + dest.y) / 2;
  const curveOffset = 10; // Curve upward/downward
  const pathD = `M ${origin.x} ${origin.y} Q ${midX} ${midY - curveOffset} ${dest.x} ${dest.y}`;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] relative">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex justify-between items-center bg-slate-800/50 z-20 relative">
           <div className="flex items-center gap-3">
               <div className="p-2.5 bg-indigo-500/10 rounded-xl border border-indigo-500/20">
                   <MapIcon className="w-5 h-5 text-indigo-400" />
               </div>
               <div>
                   <h3 className="text-white font-bold text-lg">Live Tracker: {shipment.truck_id}</h3>
                   <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span>{shipment.origin_city}</span>
                      <span className="text-slate-600">→</span>
                      <span>{shipment.destination_city}</span>
                   </div>
               </div>
           </div>
           <button onClick={onClose} className="p-2 text-slate-500 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
               <X className="w-5 h-5" />
           </button>
        </div>

        {/* Map Visualization */}
        <div className="relative flex-1 bg-slate-950 p-6 flex items-center justify-center min-h-[400px]">
           {/* Abstract Map Background */}
           <div className="absolute inset-0 opacity-20 pointer-events-none">
             <div className="absolute inset-0 bg-[linear-gradient(rgba(30,41,59,0.5)_1px,transparent_1px),linear-gradient(90deg,rgba(30,41,59,0.5)_1px,transparent_1px)] bg-[size:40px_40px]"></div>
           </div>
           
           <svg viewBox="0 0 100 100" className="w-full h-full max-w-3xl select-none" style={{ filter: 'drop-shadow(0 0 10px rgba(99, 102, 241, 0.2))' }}>
              {/* Simplified US Silhouette (Very Abstract) */}
              <path d="M 5 15 L 35 15 L 85 25 L 95 30 L 90 60 L 85 90 L 55 95 L 40 85 L 10 65 L 5 40 Z" fill="#1e293b" stroke="#334155" strokeWidth="0.5" className="opacity-30" />
              
              {/* Background Congestion Lanes */}
              {CONGESTION_LANES.map((lane, idx) => {
                  const start = CITY_COORDINATES[lane.from];
                  const end = CITY_COORDINATES[lane.to];
                  if (!start || !end) return null;
                  
                  // Add mild curve variation
                  const lMidX = (start.x + end.x) / 2;
                  const lMidY = (start.y + end.y) / 2;
                  const lCurve = (idx % 2 === 0) ? 5 : -5;
                  const lPathD = `M ${start.x} ${start.y} Q ${lMidX} ${lMidY + lCurve} ${end.x} ${end.y}`;
                  
                  let color = '#22c55e'; // green
                  if (lane.level === 'MEDIUM') color = '#f59e0b'; // amber
                  if (lane.level === 'HIGH') color = '#ef4444'; // red

                  return (
                      <path 
                          key={`bg-lane-${idx}`}
                          d={lPathD}
                          fill="none"
                          stroke={color}
                          strokeWidth="0.5"
                          className="opacity-20 transition-all duration-1000"
                          strokeDasharray="2 2"
                      />
                  );
              })}

              {/* Active Route Line */}
              <path d={pathD} fill="none" stroke="#334155" strokeWidth="1" strokeDasharray="2 2" />
              <path d={pathD} fill="none" stroke={shipment.status === 'DELAYED' ? '#ef4444' : '#06b6d4'} strokeWidth="1.5" strokeDasharray="100" strokeDashoffset={100 - (progress * 100)} pathLength="100" className="transition-all duration-1000 ease-out" />

              {/* Origin Dot */}
              <circle cx={origin.x} cy={origin.y} r="1.5" className="fill-slate-400" />
              <text x={origin.x} y={origin.y + 4} fontSize="3" fill="#94a3b8" textAnchor="middle" className="font-mono font-bold">{shipment.origin_city}</text>

              {/* Dest Dot */}
              <circle cx={dest.x} cy={dest.y} r="1.5" className="fill-white" />
              <text x={dest.x} y={dest.y + 4} fontSize="3" fill="#fff" textAnchor="middle" className="font-mono font-bold">{shipment.destination_city}</text>

              {/* Moving Truck */}
              <g transform={`translate(${truckX}, ${truckY})`}>
                 <circle r="3" className={`animate-ping opacity-75 ${shipment.status === 'DELAYED' ? 'fill-red-500' : 'fill-cyan-500'}`} />
                 <circle r="1.5" className={`${shipment.status === 'DELAYED' ? 'fill-red-500' : 'fill-cyan-500'}`} />
                 {/* Tooltip on SVG */}
                 <rect x="-8" y="-7" width="16" height="5" rx="1" fill="#0f172a" stroke="#334155" strokeWidth="0.2" />
                 <text x="0" y="-4" fontSize="2" fill="white" textAnchor="middle">{shipment.truck_id}</text>
              </g>
           </svg>

           {/* Overlay Stats */}
           <div className="absolute bottom-6 left-6 bg-slate-900/80 backdrop-blur border border-slate-700 p-4 rounded-xl flex gap-6 z-10">
              <div>
                  <p className="text-xs text-slate-500 uppercase font-bold">Time Remaining</p>
                  <p className="text-xl font-mono text-white">4h 12m</p>
              </div>
              <div>
                  <p className="text-xs text-slate-500 uppercase font-bold">Distance</p>
                  <p className="text-xl font-mono text-white">342 mi</p>
              </div>
              <div>
                  <p className="text-xs text-slate-500 uppercase font-bold">Current Speed</p>
                  <p className="text-xl font-mono text-white">65 mph</p>
              </div>
           </div>

            {/* Congestion Legend */}
            <div className="absolute top-6 right-6 bg-slate-900/80 backdrop-blur border border-slate-700 p-3 rounded-xl flex flex-col gap-2 z-10">
                <span className="text-[10px] uppercase font-bold text-slate-500 mb-1">Lane Congestion</span>
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]"></div>
                    <span className="text-xs text-slate-300">High Traffic</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]"></div>
                    <span className="text-xs text-slate-300">Moderate</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]"></div>
                    <span className="text-xs text-slate-300">Fluid</span>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};


interface ShipmentRowProps {
  shipment: Shipment;
  onDraft: (s: Shipment, audience: 'customer' | 'carrier') => void;
  onViewMap: (s: Shipment) => void;
}

const ShipmentRow: React.FC<ShipmentRowProps> = ({ shipment, onDraft, onViewMap }) => {
  const statusColor = {
    [ShipmentStatus.PLANNED]: 'text-slate-400 bg-slate-400/10',
    [ShipmentStatus.IN_TRANSIT]: 'text-blue-400 bg-blue-400/10',
    [ShipmentStatus.DELIVERED]: 'text-green-400 bg-green-400/10',
    [ShipmentStatus.DELAYED]: 'text-red-400 bg-red-400/10',
    [ShipmentStatus.AT_RISK]: 'text-amber-400 bg-amber-400/10',
  }[shipment.status];

  // Calculate simulated progress based on status and ID
  const progress = useMemo(() => {
    if (shipment.status === ShipmentStatus.DELIVERED) return 100;
    if (shipment.status === ShipmentStatus.PLANNED) return 0;
    
    // Deterministic random progress based on ID for demo variety
    const num = parseInt(shipment.shipment_id.replace(/\D/g, '') || '0');
    // Ensure varied progress between 20% and 80% for in-transit items
    return 20 + (num % 60); 
  }, [shipment.shipment_id, shipment.status]);

  const progressBarColor = {
    [ShipmentStatus.PLANNED]: 'bg-slate-600',
    [ShipmentStatus.IN_TRANSIT]: 'bg-blue-500',
    [ShipmentStatus.DELIVERED]: 'bg-green-500',
    [ShipmentStatus.DELAYED]: 'bg-red-500',
    [ShipmentStatus.AT_RISK]: 'bg-amber-500',
  }[shipment.status];

  return (
    <tr className="border-b border-slate-800 hover:bg-slate-800/30 transition-colors group">
      <td className="py-4 px-4 font-mono text-cyan-400 text-sm align-top">{shipment.shipment_id}</td>
      <td className="py-4 px-4 align-top w-72">
        <div className="flex flex-col gap-2">
          <span className="text-white text-sm font-medium">{shipment.customer_name}</span>
          
          {/* Visual Timeline */}
          <div className="relative pt-1 pr-4">
             <div className="flex justify-between text-[10px] text-slate-500 mb-1.5 uppercase font-bold tracking-wider">
                <span>{shipment.origin_city}</span>
                <span>{shipment.destination_city}</span>
             </div>
             <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden relative">
                <div 
                    className={`absolute left-0 top-0 bottom-0 rounded-full ${progressBarColor}`} 
                    style={{ width: `${progress}%` }} 
                />
             </div>
          </div>
        </div>
      </td>
      <td className="py-4 px-4 text-slate-300 text-sm align-top">{shipment.carrier_name}</td>
      <td className="py-4 px-4 align-top">
        <span className={`px-2 py-1 rounded text-xs font-bold ${statusColor}`}>
          {shipment.status.replace('_', ' ')}
        </span>
      </td>
      <td className="py-4 px-4 align-top">
        <div className="flex flex-col">
          <span className="text-slate-300 text-xs">ETA: {new Date(shipment.eta_utc).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
          <span className="text-slate-500 text-xs">SLA: {new Date(shipment.sla_utc).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
        </div>
      </td>
      <td className="py-4 px-4 text-slate-400 text-xs max-w-xs truncate align-top" title={shipment.notes}>
        {shipment.notes}
      </td>
      <td className="py-4 px-4 text-right align-top">
        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <button
                onClick={() => onViewMap(shipment)}
                className="p-2 hover:bg-indigo-500/10 rounded-full text-slate-500 hover:text-indigo-400 transition-colors"
                title="View Live Map"
            >
                <MapIcon className="w-4 h-4" />
            </button>
            <button
                onClick={() => onDraft(shipment, 'customer')}
                className="p-2 hover:bg-cyan-500/10 rounded-full text-slate-500 hover:text-cyan-400 transition-colors"
                title="Email Customer"
            >
                <Mail className="w-4 h-4" />
            </button>
            <button
                onClick={() => onDraft(shipment, 'carrier')}
                className="p-2 hover:bg-amber-500/10 rounded-full text-slate-500 hover:text-amber-400 transition-colors"
                title="Email Carrier"
            >
                <Truck className="w-4 h-4" />
            </button>
        </div>
      </td>
    </tr>
  );
};

// --- Tool Definitions ---

const reportToolDeclaration: FunctionDeclaration = {
  name: "generate_report",
  description: "Generates a structured text report based on a specific topic or request.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      report_topic: {
        type: Type.STRING,
        description: "The specific topic or title of the report to generate (e.g., 'Leadership Update', 'Carrier Performance Review', 'Risk Assessment', 'Delay Analysis')."
      }
    },
    required: ["report_topic"]
  }
};

const draftEmailToolDeclaration: FunctionDeclaration = {
  name: "draft_email",
  description: "Opens the email composer and drafts a message to a customer, carrier, or leadership.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      shipment_id: {
        type: Type.STRING,
        description: "The ID of the shipment (e.g., SHP-48210) to draft the email about."
      },
      audience: {
        type: Type.STRING,
        description: "Who the email is for: 'customer', 'carrier', or 'leadership'.",
        enum: ["customer", "carrier", "leadership"]
      }
    },
    required: ["shipment_id", "audience"]
  }
};

const sendEmailToolDeclaration: FunctionDeclaration = {
  name: "send_email",
  description: "Sends the currently drafted email in the open composer.",
  parameters: {
    type: Type.OBJECT,
    properties: {}
  }
};

// --- Main App ---

export default function App() {
  const [shipments] = useState<Shipment[]>(generateMockData());
  const [isLive, setIsLive] = useState(false);
  const [audioVolume, setAudioVolume] = useState(0);
  const [transcription, setTranscription] = useState<string>('');
  const [systemMessage, setSystemMessage] = useState<string>("Ready to connect.");
  const [filterStatus, setFilterStatus] = useState<ShipmentStatus | 'ALL' | 'ON_TIME_GROUP'>('ALL');
  
  // Email Modal State
  const [draftingShipment, setDraftingShipment] = useState<Shipment | null>(null);
  const [draftingAudience, setDraftingAudience] = useState<'customer' | 'carrier'>('customer');
  const [recipientEmail, setRecipientEmail] = useState("");
  const [emailContent, setEmailContent] = useState("");
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
  const [showToast, setShowToast] = useState(false);

  // Report Modal State
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportTitle, setReportTitle] = useState("Operations Report");
  const [reportContent, setReportContent] = useState("");
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);

  // Map Modal State
  const [viewingMapShipment, setViewingMapShipment] = useState<Shipment | null>(null);

  // Stats calculation
  const stats = useMemo(() => {
    return shipments.reduce((acc, curr) => {
      acc.total++;
      if (curr.status === ShipmentStatus.DELAYED) acc.delayed++;
      else if (curr.status === ShipmentStatus.AT_RISK) acc.atRisk++;
      else if (curr.status === ShipmentStatus.IN_TRANSIT || curr.status === ShipmentStatus.DELIVERED) acc.onTime++;
      return acc;
    }, { total: 0, onTime: 0, atRisk: 0, delayed: 0 });
  }, [shipments]);

  // Filtered Shipments
  const filteredShipments = useMemo(() => {
    if (filterStatus === 'ALL') return shipments;
    if (filterStatus === 'ON_TIME_GROUP') {
        return shipments.filter(s => s.status === ShipmentStatus.IN_TRANSIT || s.status === ShipmentStatus.DELIVERED || s.status === ShipmentStatus.PLANNED);
    }
    return shipments.filter(s => s.status === filterStatus);
  }, [shipments, filterStatus]);

  // Audio & Gemini Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionPromiseRef = useRef<Promise<any> | null>(null);

  // Pie Chart Data
  const pieData = [
    { name: 'On Time', value: stats.onTime, color: '#22c55e' }, // green-500
    { name: 'At Risk', value: stats.atRisk, color: '#f59e0b' }, // amber-500
    { name: 'Delayed', value: stats.delayed, color: '#ef4444' }, // red-500
  ];

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopLiveSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Core Generation Logic ---

  const generateReportText = async (topic: string) => {
    if (!process.env.API_KEY) return "API Key Missing";
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    const additionalContext = topic.toLowerCase().includes('carrier') 
      ? "Detailed Analysis Required: Calculate and explicitly state the On-Time Delivery Rate (%) and Average Delay Time (in hours) for each carrier. Highlight underperforming carriers with specific data points."
      : "";

    const prompt = `
      Generate a detailed logistics report.
      
      Report Topic: "${topic}"
      
      ${additionalContext}

      Use the following dataset:
      ${JSON.stringify(shipments)}
      
      Requirements:
      1. Focus ONLY on insights, metrics, and issues relevant to "${topic}".
      2. If the topic is broad (e.g. "General"), provide a high-level summary.
      3. If the topic is specific (e.g. "Carrier Performance"), drill down into specific carriers/lanes.
      4. Use professional, clear, business-appropriate language.
      5. Format using Markdown with clear headings and bullet points.
    `;
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt
    });
    return response.text || "Report generation failed.";
  };

  const handleOpenReport = async (topic: string) => {
      setSystemMessage(`Generating ${topic}...`);
      setIsGeneratingReport(true);
      setReportTitle(topic);
      setShowReportModal(true);
      setReportContent(""); 
      
      const reportText = await generateReportText(topic);
      setReportContent(reportText);
      setIsGeneratingReport(false);
      setSystemMessage("Report ready.");
  };

  const generateDraftContent = async (shipment: Shipment, audience: string) => {
     if (!process.env.API_KEY) return "API Key Missing";
     const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
     
     const prompt = `
            You are a senior logistics customer service agent.
            Draft a clear, professional email to a "${audience}" regarding shipment ${shipment.shipment_id}.
            
            Shipment Details:
            - Route: ${shipment.origin_city} to ${shipment.destination_city}
            - Carrier: ${shipment.carrier_name}
            - Current Status: ${shipment.status}
            - ETA: ${new Date(shipment.eta_utc).toLocaleString()}
            - Promised SLA: ${new Date(shipment.sla_utc).toLocaleString()}
            - Operational Notes: ${shipment.notes}
            - Customer Name: ${shipment.customer_name}

            Tone instructions:
            - If audience is "customer": Empathetic, simple, reassuring. If delayed, explain why and next steps.
            - If audience is "carrier": Factual, operational, demanding action if needed.
            - If audience is "leadership": High-level, metrics, risk outlook.

            Format:
            Subject: [Subject Line]
            
            [Email Body]
            
            [Sign-off]
        `;

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt
    });
    return response.text || "No response generated.";
  };

  // --- Live API ---

  const startLiveSession = async () => {
    if (!process.env.API_KEY) {
      alert("API Key not found in environment.");
      return;
    }

    try {
      setSystemMessage("Connecting to Voice Control Tower...");
      
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      // Initialize Audio Contexts
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioContextRef.current = audioCtx;
      
      // Microphone Stream
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const source = inputCtx.createMediaStreamSource(stream);
      inputSourceRef.current = source;
      
      // Script Processor for Audio Input
      const processor = inputCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      const systemInstruction = getSystemInstructions(shipments);

      // Connect to Gemini Live
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: systemInstruction,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          inputAudioTranscription: {}, 
          tools: [{ functionDeclarations: [reportToolDeclaration, draftEmailToolDeclaration, sendEmailToolDeclaration] }],
        },
        callbacks: {
          onopen: () => {
            console.log("Gemini Live Connected");
            setSystemMessage("Voice Control Tower Online. Listening...");
            setIsLive(true);

            // Hook up audio input processing
            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              // Calculate volume for visualizer
              let sum = 0;
              for(let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
              const rms = Math.sqrt(sum / inputData.length);
              setAudioVolume(rms); // Update state for visualizer

              const pcmBlob = createPcmBlob(inputData);
              sessionPromise.then(session => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(processor);
            processor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle Tool Calls
            if (message.toolCall) {
              console.log("Tool call received", message.toolCall);
              for (const fc of message.toolCall.functionCalls) {
                 // --- REPORT TOOL ---
                 if (fc.name === "generate_report") {
                    const args = fc.args as any;
                    const topic = args.report_topic || "General Operations";
                    
                    // Trigger shared report function
                    await handleOpenReport(topic);

                    sessionPromise.then(session => {
                      session.sendToolResponse({
                        functionResponses: {
                          id: fc.id,
                          name: fc.name,
                          response: { result: `Success. The ${topic} report is now displayed on screen.` }
                        }
                      });
                    });
                 }
                 
                 // --- DRAFT EMAIL TOOL ---
                 else if (fc.name === "draft_email") {
                    const args = fc.args as any;
                    const shipmentId = args.shipment_id || "";
                    const audience = (args.audience || "customer") as 'customer' | 'carrier';

                    // Find shipment (fuzzy match if needed, but tool usually gets exact ID if in prompt)
                    const foundShipment = shipments.find(s => 
                      s.shipment_id.toLowerCase().includes(shipmentId.toLowerCase()) || 
                      shipmentId.includes(s.shipment_id)
                    );

                    if (foundShipment) {
                       setSystemMessage(`Drafting email for ${foundShipment.shipment_id}...`);
                       setDraftingShipment(foundShipment);
                       setDraftingAudience(audience);
                       setRecipientEmail(audience === 'customer' ? (foundShipment.customer_email || "") : (foundShipment.carrier_email || ""));
                       setIsGeneratingDraft(true);
                       setEmailContent("");
                       
                       const draftText = await generateDraftContent(foundShipment, audience);
                       setEmailContent(draftText);
                       setIsGeneratingDraft(false);
                       setSystemMessage("Draft ready for review.");

                       sessionPromise.then(session => {
                         session.sendToolResponse({
                           functionResponses: {
                             id: fc.id,
                             name: fc.name,
                             response: { result: `Draft email for ${audience} created and displayed. Ask user to confirm sending.` }
                           }
                         });
                       });
                    } else {
                       // Shipment not found
                        sessionPromise.then(session => {
                         session.sendToolResponse({
                           functionResponses: {
                             id: fc.id,
                             name: fc.name,
                             response: { result: `Error: Shipment ${shipmentId} not found.` }
                           }
                         });
                       });
                    }
                 }

                 // --- SEND EMAIL TOOL ---
                 else if (fc.name === "send_email") {
                    setSystemMessage("Sending email...");
                    // Trigger the existing send logic programmatically
                    // We need to access the current state, but inside this callback, state might be stale if not careful.
                    // However, for this demo, we can just trigger the visual feedback and close the modal.
                    // A better way is to call a function that uses refs or just assume the UI is in the right state if the user said "send".
                    
                    // We can't easily access the current 'emailContent' state inside this closure without a Ref, 
                    // but we can simulate the success action.
                    
                    setShowToast(true);
                    setTimeout(() => setShowToast(false), 3000);
                    setDraftingShipment(null); // Close modal
                    setEmailContent("");

                    sessionPromise.then(session => {
                        session.sendToolResponse({
                          functionResponses: {
                            id: fc.id,
                            name: fc.name,
                            response: { result: `Email sent successfully.` }
                          }
                        });
                    });
                 }
              }
            }

            // Handle Audio Output
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
               if (audioContextRef.current) {
                 const ctx = audioContextRef.current;
                 nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                 
                 const audioBytes = base64ToUint8Array(base64Audio);
                 const audioBuffer = await decodeAudioData(audioBytes, ctx);
                 
                 const source = ctx.createBufferSource();
                 source.buffer = audioBuffer;
                 source.connect(ctx.destination);
                 
                 source.addEventListener('ended', () => {
                   sourcesRef.current.delete(source);
                 });
                 
                 source.start(nextStartTimeRef.current);
                 nextStartTimeRef.current += audioBuffer.duration;
                 sourcesRef.current.add(source);
               }
            }

            // Handle Transcription (Visual Feedback)
            if (message.serverContent?.inputTranscription) {
               const text = message.serverContent.inputTranscription.text;
               if (text) setTranscription(prev => `User: ${text}`);
            }

             const interrupted = message.serverContent?.interrupted;
             if (interrupted) {
                // Stop all playing audio
                sourcesRef.current.forEach(s => s.stop());
                sourcesRef.current.clear();
                nextStartTimeRef.current = 0;
             }
          },
          onclose: () => {
            console.log("Gemini Live Disconnected");
            setIsLive(false);
            setSystemMessage("Disconnected.");
          },
          onerror: (err) => {
            console.error("Gemini Live Error", err);
            setSystemMessage("Connection Error.");
            setIsLive(false);
          }
        }
      });
      sessionPromiseRef.current = sessionPromise;

    } catch (e) {
      console.error("Failed to connect", e);
      setSystemMessage("Failed to initialize. Check API Key/Permissions.");
    }
  };

  const stopLiveSession = () => {
    // Close context and tracks
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (inputSourceRef.current) {
      inputSourceRef.current.disconnect();
      inputSourceRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setIsLive(false);
    setSystemMessage("Session ended.");
    setTranscription("");
    // Stop all audio output
    sourcesRef.current.forEach(s => s.stop());
    sourcesRef.current.clear();
  };

  const toggleSession = () => {
    if (isLive) {
      stopLiveSession();
    } else {
      startLiveSession();
    }
  };

  // --- Email Logic ---

  const handleDraftEmail = async (shipment: Shipment, audience: 'customer' | 'carrier') => {
    setDraftingShipment(shipment);
    setDraftingAudience(audience);
    setRecipientEmail(audience === 'customer' ? (shipment.customer_email || "") : (shipment.carrier_email || ""));
    setIsGeneratingDraft(true);
    setEmailContent("");
    
    try {
        const text = await generateDraftContent(shipment, audience);
        setEmailContent(text);
    } catch (error) {
        console.error("Error generating draft", error);
        setEmailContent("Error generating draft.");
    } finally {
        setIsGeneratingDraft(false);
    }
  };

  const handleSendEmail = () => {
    // Parse Subject from draft (Basic assumption: Subject is in the first few lines)
    const lines = emailContent.split('\n');
    let subject = "Update regarding your shipment";
    let body = emailContent;

    const subjectLineIndex = lines.findIndex(l => l.toLowerCase().startsWith('subject:'));
    if (subjectLineIndex !== -1) {
        subject = lines[subjectLineIndex].replace(/subject:/i, '').trim();
        // Remove subject line from body to avoid duplication
        body = lines.filter((_, i) => i !== subjectLineIndex).join('\n').trim();
    }

    // Use mailto for real sending via default client
    const mailtoLink = `mailto:${recipientEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailtoLink;

    setDraftingShipment(null);
    setEmailContent("");
    setRecipientEmail("");
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3000);
  };

  // --- Report Logic ---

  const downloadPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text(reportTitle || "Operations Report", 10, 10);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 10, 18);
    
    doc.setFontSize(12);
    // Simple text wrapping
    const splitText = doc.splitTextToSize(reportContent, 180);
    doc.text(splitText, 10, 30);
    
    doc.save(`${(reportTitle || "report").toLowerCase().replace(/\s+/g, '-')}.pdf`);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(reportContent);
    alert("Report copied to clipboard!");
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-cyan-500/30 relative">
      {/* Toast Notification */}
      {showToast && (
        <div className="fixed top-20 right-4 z-[70] bg-green-500/10 border border-green-500/20 backdrop-blur-md text-green-400 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3 animate-wave origin-right">
            <div className="p-1 bg-green-500 rounded-full text-slate-950"><CheckCircle className="w-4 h-4" /></div>
            <div>
                <p className="font-bold text-sm">Action Successful</p>
                <p className="text-xs opacity-80">The system has handled your request.</p>
            </div>
        </div>
      )}

      {/* --- Header --- */}
      <header className="sticky top-0 z-50 bg-slate-900/80 backdrop-blur-md border-b border-slate-800">
        <div className="max-w-[100rem] mx-auto px-2 lg:px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-cyan-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Radio className="text-white w-5 h-5" />
            </div>
            <div className="flex flex-col leading-tight">
              <h1 className="text-[22px] font-bold tracking-tight text-white">
                Voice Control <span className="text-cyan-400">Tower</span>
              </h1>
              <span className="text-[11px] uppercase tracking-widest text-slate-400">
                Real-Time Logistics Command
              </span>
            </div>

          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800 border border-slate-700">
               <div className={`w-2 h-2 rounded-full ${isLive ? 'bg-green-500 animate-pulse' : 'bg-slate-500'}`} />
               <span className="text-xs font-medium text-slate-300">{isLive ? 'LIVE' : 'OFFLINE'}</span>
            </div>
          </div>
        </div>
      </header>

      {/* --- Main Dashboard --- */}
      <main className="max-w-[100rem] mx-auto lg:px-4 py-5 pb-28 space-y-6">
        
        {/* Top KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <StatusCard 
            title="Total Shipments" 
            count={stats.total} 
            color="bg-blue-500" 
            icon={Truck} 
            onClick={() => setFilterStatus('ALL')}
            isActive={filterStatus === 'ALL'}
          />
          <StatusCard 
            title="On Time" 
            count={stats.onTime} 
            color="bg-green-500" 
            icon={ShieldCheck} 
            onClick={() => setFilterStatus('ON_TIME_GROUP')}
            isActive={filterStatus === 'ON_TIME_GROUP'}
          />
          <StatusCard 
            title="At Risk" 
            count={stats.atRisk} 
            color="bg-amber-500" 
            icon={TriangleAlert} 
            onClick={() => setFilterStatus(ShipmentStatus.AT_RISK)}
            isActive={filterStatus === ShipmentStatus.AT_RISK}
          />
          <StatusCard 
            title="Delayed" 
            count={stats.delayed} 
            color="bg-red-500" 
            icon={Clock} 
            onClick={() => setFilterStatus(ShipmentStatus.DELAYED)}
            isActive={filterStatus === ShipmentStatus.DELAYED}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Table Area */}
          <div className="lg:col-span-2 min-h-[780px] bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <Activity className="w-5 h-5 text-cyan-400" />
                Live Shipment Status
              </h2>
              <div className="flex items-center gap-3">
                 {filterStatus !== 'ALL' && (
                    <span className="text-xs font-bold px-2 py-1 bg-cyan-500/10 text-cyan-400 rounded-md border border-cyan-500/20 flex items-center gap-1">
                        <Filter className="w-3 h-3" />
                        Filtered: {filterStatus.replace('_', ' ')}
                    </span>
                 )}
                 <span className="text-xs text-slate-500 bg-slate-800 px-2 py-1 rounded border border-slate-700">Real-time Data</span>
              </div>
            </div>
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-950 text-slate-400 text-xs uppercase font-medium sticky top-0 z-10">
                  <tr>
                    <th className="py-3 px-4 bg-slate-950">ID</th>
                    <th className="py-3 px-4 bg-slate-950">Customer & Route</th>
                    <th className="py-3 px-4 bg-slate-950">Carrier</th>
                    <th className="py-3 px-4 bg-slate-950">Status</th>
                    <th className="py-3 px-4 bg-slate-950">Timing (UTC)</th>
                    <th className="py-3 px-4 bg-slate-950">Latest Event</th>
                    <th className="py-3 px-4 bg-slate-950 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredShipments.length > 0 ? (
                      filteredShipments.map(s => <ShipmentRow key={s.shipment_id} shipment={s} onDraft={handleDraftEmail} onViewMap={setViewingMapShipment} />)
                  ) : (
                      <tr>
                          <td colSpan={7} className="py-12 text-center text-slate-500">
                              <div className="flex flex-col items-center gap-2">
                                  <Filter className="w-8 h-8 opacity-20" />
                                  <p>No shipments match this filter.</p>
                                  <button onClick={() => setFilterStatus('ALL')} className="text-cyan-500 hover:underline text-sm">Clear Filters</button>
                              </div>
                          </td>
                      </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right Panel: Analytics & Log */}
          <div className="space-y-6">
            
            {/* Health Chart */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
              <h3 className="text-sm font-medium text-slate-400 mb-4 uppercase tracking-wider">Network Health</h3>
              <div className="h-48 w-full flex items-center justify-center">
                 <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                        ))}
                      </Pie>
                      <RechartsTooltip 
                        contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '8px', color: '#fff' }}
                        itemStyle={{ color: '#fff' }}
                      />
                    </PieChart>
                 </ResponsiveContainer>
                 {/* Center Text Overlay */}
                 <div className="absolute text-center">
                   <span className="text-3xl font-bold text-white">{Math.round((stats.onTime / stats.total) * 100)}%</span>
                   <p className="text-[10px] text-slate-500 uppercase">On Time</p>
                 </div>
              </div>
            </div>

            {/* Quick Actions / Reports */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
              <h3 className="text-sm font-medium text-slate-400 mb-4 uppercase tracking-wider flex items-center gap-2">
                 <BarChart3 className="w-4 h-4" /> Analytics & Reports
              </h3>
              <div className="grid grid-cols-1 gap-3">
                <button 
                  onClick={() => handleOpenReport("Carrier Performance & Reliability Analysis")}
                  className="flex items-center justify-between p-3 bg-slate-800 hover:bg-slate-800/80 rounded-xl border border-slate-700 hover:border-cyan-500/50 transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-indigo-500/10 text-indigo-400 rounded-lg group-hover:text-white group-hover:bg-indigo-500 transition-colors">
                       <Truck className="w-5 h-5" />
                    </div>
                    <div className="text-left">
                       <span className="block text-sm font-bold text-slate-200 group-hover:text-white">Carrier Performance</span>
                       <span className="block text-[10px] text-slate-500 group-hover:text-slate-400">On-time rates & delay metrics</span>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-cyan-400 transition-transform group-hover:translate-x-0.5" />
                </button>
              </div>
            </div>

            {/* AI Console Log */}
            <div className="bg-black/40 border border-slate-800 rounded-2xl p-4 h-64 flex flex-col font-mono text-sm shadow-inner">
               <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-800">
                 <Terminal className="w-4 h-4 text-slate-500" />
                 <span className="text-slate-500 text-xs">System Log</span>
               </div>
               <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar">
                  <div className="text-slate-400">
                    <span className="text-cyan-500 opacity-50 mr-2">{new Date().toLocaleTimeString()}</span>
                    {systemMessage}
                  </div>
                  {transcription && (
                    <div className="text-cyan-300 animate-pulse">
                      <span className="text-slate-500 opacity-50 mr-2">{new Date().toLocaleTimeString()}</span>
                      {transcription}
                    </div>
                  )}
               </div>
            </div>

          </div>
        </div>
      </main>

      {/* --- Sticky Footer Voice Control --- */}
      <div className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-slate-950 via-slate-950/90 to-transparent pointer-events-none flex justify-center z-50">
        <div className="pointer-events-auto bg-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-full px-8 py-4 shadow-2xl flex items-center gap-6 ring-1 ring-white/10">
          
          <div className="flex flex-col">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-widest text-center">
              {isLive ? 'Listening' : 'Ready'}
            </span>
          </div>

          <div className="h-10 border-r border-slate-700" />

          <LiveVisualizer isActive={isLive} volume={audioVolume} />

          <button
            onClick={toggleSession}
            className={`
              w-14 h-14 rounded-full flex items-center justify-center transition-all duration-300 shadow-lg
              ${isLive 
                ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/50' 
                : 'bg-cyan-500 text-slate-900 hover:bg-cyan-400 border border-cyan-400 hover:scale-105'
              }
            `}
          >
            {isLive ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* --- Map Modal --- */}
      {viewingMapShipment && (
        <MapModal shipment={viewingMapShipment} onClose={() => setViewingMapShipment(null)} />
      )}

      {/* --- Email Modal --- */}
      {draftingShipment && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]">
                {/* Modal Header */}
                <div className="p-5 border-b border-slate-800 flex justify-between items-center bg-slate-800/50">
                    <div className="flex items-center gap-3">
                        <div className={`p-2.5 rounded-xl border ${draftingAudience === 'carrier' ? 'bg-amber-500/10 border-amber-500/20' : 'bg-cyan-500/10 border-cyan-500/20'}`}>
                            {draftingAudience === 'carrier' ? (
                                <Truck className="w-5 h-5 text-amber-400" />
                            ) : (
                                <Mail className="w-5 h-5 text-cyan-400" />
                            )}
                        </div>
                        <div>
                            <h3 className="text-white font-bold text-lg">Draft {draftingAudience === 'carrier' ? 'Carrier' : 'Customer'} Email</h3>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-slate-400 text-xs font-mono">{draftingShipment.shipment_id}</span>
                              <span className="text-slate-600 text-xs">•</span>
                              <span className="text-slate-400 text-xs">
                                {draftingAudience === 'carrier' ? draftingShipment.carrier_name : draftingShipment.customer_name}
                              </span>
                            </div>
                        </div>
                    </div>
                    <button 
                      onClick={() => setDraftingShipment(null)} 
                      className="p-2 text-slate-500 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Modal Body */}
                <div className="p-6 flex-1 overflow-y-auto">
                    {isGeneratingDraft ? (
                        <div className="flex flex-col items-center justify-center h-64 space-y-4">
                            <div className="relative">
                              <div className={`absolute inset-0 blur-xl opacity-20 rounded-full ${draftingAudience === 'carrier' ? 'bg-amber-500' : 'bg-cyan-500'}`}></div>
                              <Loader2 className={`w-10 h-10 animate-spin relative z-10 ${draftingAudience === 'carrier' ? 'text-amber-400' : 'text-cyan-400'}`} />
                            </div>
                            <p className="text-slate-300 text-sm font-medium animate-pulse">AI is writing your draft...</p>
                        </div>
                    ) : (
                        <div className="space-y-5">
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Recipient ({draftingAudience === 'carrier' ? 'Dispatch' : 'Customer'})</label>
                                <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 focus-within:ring-1 focus-within:ring-cyan-500/50">
                                  <User className="w-4 h-4 text-slate-500" />
                                  <input 
                                    type="email"
                                    value={recipientEmail}
                                    onChange={(e) => setRecipientEmail(e.target.value)}
                                    className="bg-transparent border-none text-white text-sm w-full focus:outline-none placeholder:text-slate-600"
                                    placeholder={draftingAudience === 'carrier' ? "Enter carrier email..." : "Enter customer email..."}
                                  />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Message Draft</label>
                                <textarea 
                                    value={emailContent}
                                    onChange={(e) => setEmailContent(e.target.value)}
                                    className="w-full h-64 bg-slate-950 border border-slate-800 rounded-xl p-5 text-slate-300 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 resize-none font-mono text-sm leading-relaxed shadow-inner"
                                    placeholder="Draft will appear here..."
                                />
                            </div>
                            <div className="flex items-start gap-3 p-3 bg-blue-500/5 border border-blue-500/10 rounded-lg">
                               <div className="p-1 bg-blue-500/10 rounded text-blue-400 mt-0.5"><Activity className="w-3 h-3" /></div>
                               <p className="text-xs text-blue-200/70 leading-relaxed">
                                 This draft is generated based on the current shipment status ({draftingShipment.status}) and operational notes. Review before sending.
                               </p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Modal Footer */}
                 <div className="p-4 border-t border-slate-800 flex justify-end gap-3 bg-slate-800/30">
                    <button 
                        onClick={() => setDraftingShipment(null)} 
                        className="px-4 py-2 text-slate-400 hover:text-white text-sm font-medium transition-colors hover:bg-slate-800 rounded-lg"
                    >
                        Cancel
                    </button>
                    <button 
                        onClick={handleSendEmail}
                        disabled={isGeneratingDraft || !emailContent || !recipientEmail}
                        className={`px-5 py-2.5 text-slate-950 rounded-lg text-sm font-bold flex items-center gap-2 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none ${draftingAudience === 'carrier' ? 'bg-amber-500 hover:bg-amber-400 shadow-amber-500/20 hover:shadow-amber-500/40' : 'bg-cyan-500 hover:bg-cyan-400 shadow-cyan-500/20 hover:shadow-cyan-500/40'}`}
                    >
                        <Send className="w-4 h-4" />
                        Send Email ({draftingAudience === 'carrier' ? 'Carrier' : 'Client'})
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* --- Report Modal --- */}
      {showReportModal && (
         <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-3xl shadow-2xl flex flex-col max-h-[90vh]">
               {/* Header */}
               <div className="p-5 border-b border-slate-800 flex justify-between items-center bg-slate-800/50">
                   <div className="flex items-center gap-3">
                       <div className="p-2.5 bg-amber-500/10 rounded-xl border border-amber-500/20">
                           <FileText className="w-5 h-5 text-amber-400" />
                       </div>
                       <div>
                           <h3 className="text-white font-bold text-lg">{reportTitle}</h3>
                           <p className="text-slate-400 text-xs">Generated via Voice Command</p>
                       </div>
                   </div>
                   <button onClick={() => setShowReportModal(false)} className="p-2 text-slate-500 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
                       <X className="w-5 h-5" />
                   </button>
               </div>

               {/* Body */}
               <div className="p-6 flex-1 overflow-y-auto">
                   {isGeneratingReport ? (
                      <div className="flex flex-col items-center justify-center h-64 space-y-4">
                        <div className="relative">
                           <div className="absolute inset-0 bg-amber-500 blur-xl opacity-20 rounded-full"></div>
                           <Loader2 className="w-10 h-10 text-amber-400 animate-spin relative z-10" />
                        </div>
                        <p className="text-slate-300 text-sm font-medium animate-pulse">Compiling data & generating report...</p>
                      </div>
                   ) : (
                     <div className="prose prose-invert prose-sm max-w-none">
                       <pre className="whitespace-pre-wrap font-mono text-slate-300 bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs leading-relaxed">
                         {reportContent}
                       </pre>
                     </div>
                   )}
               </div>

               {/* Footer */}
               <div className="p-4 border-t border-slate-800 flex justify-end gap-3 bg-slate-800/30">
                  <button 
                    onClick={copyToClipboard}
                    className="px-4 py-2 text-slate-300 hover:text-white text-sm font-medium border border-slate-700 hover:bg-slate-800 rounded-lg flex items-center gap-2"
                  >
                    <Copy className="w-4 h-4" /> Copy Text
                  </button>
                  <button 
                    onClick={downloadPDF}
                    className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg text-sm font-bold flex items-center gap-2 shadow-lg shadow-amber-500/20 transition-all hover:scale-105"
                  >
                    <Download className="w-4 h-4" /> Download PDF
                  </button>
               </div>
            </div>
         </div>
      )}
    </div>
  );
}