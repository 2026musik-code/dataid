import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Plus, 
  Map as MapIcon, 
  Info, 
  Search, 
  FileText, 
  TrendingUp, 
  Users, 
  DollarSign, 
  ArrowRight, 
  ChevronRight, 
  Globe, 
  Shield, 
  LayoutDashboard,
  Loader2,
  Sparkles,
  MessageSquare,
  X,
  RefreshCw,
  Settings,
  MoreVertical,
  Menu,
  CheckCircle2,
  XCircle,
  Send,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import 'leaflet/dist/leaflet.css';
import { MapContainer, GeoJSON } from 'react-leaflet';
import type { LatLngBoundsExpression } from 'leaflet';
import { GoogleGenAI, Type } from '@google/genai';
import { cn } from './lib/utils';

// --- Constants & Types ---
// Switching back to a local robust geojson to prevent external HTTP 404 blockages or CORS issues.
const GEO_URL = "/indonesia-map.json";

interface RegionalData {
  title: string;
  stats: { label: string; value: string }[];
  listTitle: string;
  listItems: string[];
  summary: string;
}

const INDONESIA_CENTER: [number, number] = [118, -2];
const INDONESIA_BOUNDS: LatLngBoundsExpression = [
  [-11.5, 94.0], // South-West (Sabang below / further out)
  [6.5, 142.0]   // North-East (Papua further out)
];

// ... Mock Initial Data ...
const MOCK_REGIONS: Record<string, Partial<RegionalData>> = {
  "Jakarta Raya": {
    title: "Jakarta Raya",
    stats: [{label: "Mock", value: "TBA"}],
  },
  "Jawa Barat": {
    title: "Jawa Barat",
    stats: [{label: "Mock", value: "TBA"}],
  },
};

export default function App() {
  // --- Component State ---
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [aiData, setAiData] = useState<RegionalData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'ai'; text: string }[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('Peta Jaringan');
  const [mapMode, setMapMode] = useState('UTAMA');
  const mapModeRef = useRef(mapMode);

  useEffect(() => {
    mapModeRef.current = mapMode;
  }, [mapMode]);

  // --- Settings & Sidebar Resize ---
  const [isNavOpen, setIsNavOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDeveloperOpen, setIsDeveloperOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [localApiKey, setLocalApiKey] = useState("");
  const availableModels = [
    'gemini-3-flash-preview',
    'gemini-3.1-pro-preview',
    'gemini-3.1-flash-lite-preview',
    'gemini-1.5-flash',
    'gemini-1.5-pro',
    'gemini-2.0-flash'
  ];
  const [selectedModel, setSelectedModel] = useState('gemini-3.1-flash-lite-preview');
  const [sidebarWidth, setSidebarWidth] = useState(256); // 256px
  const [isResizing, setIsResizing] = useState(false);
  const [geoJsonData, setGeoJsonData] = useState<any>(null);
  const [apiKeyStatus, setApiKeyStatus] = useState<'idle'|'testing'|'valid'|'invalid'>('idle');
  const [apiKeyErrorLog, setApiKeyErrorLog] = useState<string | null>(null);
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null);

  const [archiveList, setArchiveList] = useState<Array<{ region: string, data: RegionalData, timestamp: Date }>>([]);
  
  const [apiKeysList, setApiKeysList] = useState<{keyId: string, masked: string}[]>([]);
  const [envKeyInfo, setEnvKeyInfo] = useState<{keyId: string, masked: string} | null>(null);
  const [newKeyInput, setNewKeyInput] = useState("");
  const [isSavingKey, setIsSavingKey] = useState(false);

  // Load API keys when settings opened
  useEffect(() => {
    if (isSettingsOpen) {
      fetch('/api/keys')
        .then(res => res.json())
        .then((data: any) => {
          if (data.keys) setApiKeysList(data.keys);
          if (data.envKey) setEnvKeyInfo(data.envKey);
          
          if (!selectedKeyId) {
             if (data.envKey) setSelectedKeyId('env');
             else if (data.keys && data.keys.length > 0) setSelectedKeyId(data.keys[0].keyId);
          }
        })
        .catch(err => console.error(err));
    }
  }, [isSettingsOpen]);

  const handleSaveNewKey = async () => {
    if (!newKeyInput.trim()) return;
    setIsSavingKey(true);
    try {
      await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: newKeyInput.trim() })
      });
      setNewKeyInput("");
      
      // refresh list
      const res = await fetch('/api/keys');
      const data: any = await res.json();
      setApiKeysList(data.keys || []);
      
      if (data.keys && data.keys.length > 0) {
        setSelectedKeyId(data.keys[data.keys.length - 1].keyId);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsSavingKey(false);
      setApiKeyStatus('idle'); // force ping restart
    }
  };

  const handleDeleteKey = async (keyId: string) => {
    try {
      await fetch('/api/keys', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyId })
      });
      const res = await fetch('/api/keys');
      const data: any = await res.json();
      setApiKeysList(data.keys || []);
      
      if (selectedKeyId === keyId) {
         if (data.envKey) setSelectedKeyId('env');
         else if (data.keys && data.keys.length > 0) setSelectedKeyId(data.keys[0].keyId);
         else setSelectedKeyId(null);
      }
      setApiKeyStatus('idle');
    } catch(e) {
      console.error(e);
    }
  };
  
  // Ping test
  useEffect(() => {
    setApiKeyStatus('testing');
    setApiKeyErrorLog(null);
    
    fetch('/api/ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedModel, keyId: selectedKeyId })
    })
      .then(res => res.json().then(data => ({ res, data: data as any })))
      .then(({ res, data }) => {
        if (res.ok) {
          setApiKeyStatus('valid');
          setApiKeyErrorLog(null);
        } else {
          setApiKeyStatus('invalid');
          setApiKeyErrorLog(data.error || "Kesalahan koneksi.");
        }
      })
      .catch((err) => {
        setApiKeyStatus('invalid');
        setApiKeyErrorLog(err?.message || "Gagal menghubungi backend.");
      });
  }, [selectedModel]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      setSidebarWidth(Math.max(160, Math.min(e.clientX, 600)));
    };
    const handleMouseUp = () => setIsResizing(false);
    
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  useEffect(() => {
    fetch('/indonesia-map.json')
      .then(res => res.json())
      .then(data => setGeoJsonData(data))
      .catch(err => console.error("Failed to load map data", err));
  }, []);

  useEffect(() => {
    if (isSearchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isSearchOpen]);

  const allProvinces = useMemo(() => {
    if (!geoJsonData || !geoJsonData.features) return [];
    const provinces = new Set<string>();
    // @ts-ignore
    geoJsonData.features.forEach((f: any) => {
       const name = f?.properties?.Propinsi || f?.properties?.name;
       if (name) {
         const formattedName = name.toLowerCase().split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
         provinces.add(formattedName);
       }
    });
    return Array.from(provinces).sort();
  }, [geoJsonData]);

  const filteredRegions = useMemo(() => {
    if (!geoJsonData || !searchQuery) return [];
    
    // @ts-ignore
    if (!geoJsonData.features) return [];
    
    const provinces = new Set<string>();
    // @ts-ignore
    geoJsonData.features.forEach((f: any) => {
       const name = f?.properties?.Propinsi || f?.properties?.name;
       if (name) {
         const formattedName = name.toLowerCase().split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
         provinces.add(formattedName);
       }
    });
    return Array.from(provinces).filter(p => p.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 5);
  }, [geoJsonData, searchQuery]);

  const handleSearchSelect = (regionName: string) => {
    setSearchQuery("");
    setIsSearchOpen(false);
    onRegionClick(regionName);
  };

  const handleMapModeChange = (newMode: string) => {
    setMapMode(newMode);
    mapModeRef.current = newMode;
    if (selectedRegion) {
      fetchRegionalInfo(selectedRegion, newMode);
    }
  };

  const fetchRegionalInfo = async (provinceName: string, overrideMode?: string) => {
    setIsLoading(true);
    setAiData(null);
    setIsSidebarOpen(true);

    try {
      const response = await fetch('/api/region', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provinceName, selectedModel, mapMode: overrideMode || mapModeRef.current, keyId: selectedKeyId })
      });
      
      const dataStr = await response.text();
      let data;
      try { data = JSON.parse(dataStr); } catch (e) { data = { error: "Invalid JSON response" }; }

      if (!response.ok) {
        throw new Error(data.error || "Gagal menghubungi backend AI");
      }
      
      setAiData(data);
      setChatHistory([{ role: 'ai', text: `Halo! Saya telah menganalisis data untuk wilayah **${provinceName}** berdasarkan topik prioritas: **${overrideMode || mapModeRef.current}**. Ada poin data spesifik lain yang ingin Anda ketahui?` }]);
      setArchiveList(prev => [{ region: provinceName, data, timestamp: new Date() }, ...prev]);
    } catch (error: any) {
      console.error("AI Error:", error);
      // Fallback
      setAiData({
        title: provinceName,
        stats: [
          { label: "Status", value: "Error" },
          { label: "Akses", value: "Dibatasi" }
        ],
        listTitle: "Peringatan",
        listItems: ["Harap atur Kunci API di Pengaturan"],
        summary: error.message || "Gagal menyambung ke server AI.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const userText = chatInput;
    setChatInput("");
    setChatHistory(prev => [...prev, { role: 'user', text: userText }]);
    setIsChatLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userText, selectedRegion, selectedModel })
      });
      const data: any = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || "Gagal menghubungi backend AI");
      }
      
      setChatHistory(prev => [...prev, { role: 'ai', text: data.text || "Saya tidak yakin." }]);
    } catch (e: any) {
      setChatHistory(prev => [...prev, { role: 'ai', text: "Terjadi kesalahan koneksi ke backend AI: " + e.message }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const onRegionClick = (geoName: string) => {
    setSelectedRegion(geoName);
    fetchRegionalInfo(geoName);
  };

  return (
    <div className="fixed inset-0 flex bg-[#050505] text-zinc-300 font-sans overflow-hidden">
      
      {/* 1. Sidebar - Resizable on the left */}
      <aside 
        style={{ width: isNavOpen ? `${sidebarWidth}px` : '0px' }}
        className={cn(
          "relative flex-none border-r border-white/5 bg-zinc-900/90 flex flex-col z-[100] transition-all",
          isResizing ? "duration-0" : "duration-300 ease-in-out",
          isNavOpen ? "py-6 px-4" : "p-0 overflow-hidden opacity-0 border-r-0 pointer-events-none"
        )}
      >
        <div className="flex items-center justify-between mb-10 px-2 shrink-0 truncate">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0 shadow-lg shadow-indigo-600/20">
              <LayoutDashboard className="w-5 h-5 text-white" />
            </div>
            <span className="font-black text-white text-sm uppercase tracking-tighter truncate">DATA SDM ID</span>
          </div>
          <button 
            onClick={() => setIsNavOpen(false)}
            className="p-1.5 text-zinc-500 hover:bg-white/10 hover:text-white rounded-lg transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto overflow-x-hidden">
          <NavItem icon={<Globe className="w-5 h-5" />} label="Peta Jaringan" active={activeTab === 'Peta Jaringan'} onClick={() => setActiveTab('Peta Jaringan')} />
          <NavItem icon={<FileText className="w-5 h-5" />} label="Arsip" active={activeTab === 'Arsip'} onClick={() => setActiveTab('Arsip')} />
          <NavItem icon={<TrendingUp className="w-5 h-5" />} label="Analisis" active={activeTab === 'Analisis'} onClick={() => setActiveTab('Analisis')} />
          <NavItem icon={<Shield className="w-5 h-5" />} label="Peraturan" active={activeTab === 'Peraturan'} onClick={() => setActiveTab('Peraturan')} />
        </nav>
        
        <div className="mt-auto px-2 pt-6">
          <button 
            onClick={() => setIsDeveloperOpen(true)}
            className="flex items-center gap-2 mb-1 text-emerald-400 hover:text-emerald-300 transition-colors w-full cursor-pointer hover:bg-emerald-500/10 p-2 rounded-lg"
          >
            <Users className="w-5 h-5" />
            <span className="text-xs font-semibold uppercase tracking-widest truncate">Developer Info</span>
          </button>
          
          <button 
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center gap-2 mb-3 text-zinc-400 hover:text-white transition-colors w-full cursor-pointer hover:bg-white/5 p-2 rounded-lg"
          >
            <Settings className="w-5 h-5" />
            <span className="text-xs font-semibold uppercase tracking-widest truncate">Pengaturan AI</span>
          </button>
          
          <div className="p-3 bg-white/5 rounded-xl border border-white/5 truncate">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              <span className="text-[9px] font-bold text-emerald-400 truncate tracking-widest uppercase">GEMINI: {selectedModel.split('-')[1]}</span>
            </div>
            <p className="text-[8px] text-zinc-500 font-mono tracking-tighter truncate">v4.5.2 Operational</p>
          </div>
        </div>
        
        {/* Resize Handle */}
        <div 
          onMouseDown={(e) => { e.preventDefault(); setIsResizing(true); }}
          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-500/50 active:bg-indigo-500 transition-colors z-50 group"
        >
           <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 h-8 flex flex-col justify-between">
              <div className="w-0.5 h-1 bg-white/50 rounded-full" />
              <div className="w-0.5 h-1 bg-white/50 rounded-full" />
              <div className="w-0.5 h-1 bg-white/50 rounded-full" />
           </div>
        </div>
      </aside>

      {/* 2. Main Content Area */}
      <main className="flex-1 relative flex flex-col min-w-0 z-10 transition-all duration-300">
        
        {/* Header Stats */}
        <header className="h-16 flex items-center justify-between px-6 bg-zinc-950/80 border-b border-white/5 z-50">
          <div className="flex items-center gap-4">
            {!isNavOpen && (
              <button 
                onClick={() => setIsNavOpen(true)}
                className="p-2 -ml-2 text-zinc-400 hover:bg-white/10 hover:text-white rounded-lg transition-colors cursor-pointer"
              >
                <Menu className="w-5 h-5" />
              </button>
            )}
            <div className="flex flex-col">
              <span className="text-[9px] text-zinc-500 font-bold tracking-widest uppercase">Target Region</span>
              <h2 className="text-sm font-bold text-white uppercase italic">{selectedRegion || 'Pilih Wilayah...'}</h2>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="p-2 text-zinc-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
              title="Buka AI Assistant"
            >
              <Sparkles className="w-5 h-5 text-indigo-400" />
            </button>
            
            <div className="relative">
              <button 
                onClick={() => setIsSearchOpen(!isSearchOpen)}
                className="p-2 text-zinc-500 hover:text-white transition-colors cursor-pointer rounded-lg hover:bg-white/10"
              >
                {isSearchOpen ? <X className="w-5 h-5" /> : <Search className="w-5 h-5" />}
              </button>

              <AnimatePresence>
                {isSearchOpen && (
                  <motion.div 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="absolute right-0 top-full mt-2 w-64 md:w-80 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl p-2 z-[100]"
                  >
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                      <input 
                        ref={searchInputRef}
                        type="text" 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Cari provinsi..."
                        className="w-full bg-zinc-950 border border-white/5 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50 transition-colors placeholder:text-zinc-600"
                      />
                    </div>
                    
                    {searchQuery && (
                      <div className="mt-2 flex flex-col gap-1 max-h-48 overflow-y-auto custom-scrollbar">
                        {filteredRegions.length > 0 ? (
                          filteredRegions.map((region) => (
                            <button
                              key={region}
                              onClick={() => handleSearchSelect(region)}
                              className="text-left px-3 py-2 text-sm text-zinc-300 hover:bg-white/5 hover:text-white rounded-md transition-colors truncate"
                            >
                              {region}
                            </button>
                          ))
                        ) : (
                          <div className="px-3 py-4 text-center text-xs text-zinc-500">
                            Tidak ditemukan
                          </div>
                        )}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>

        {/* The Map Stage */}
        {activeTab === 'Peta Jaringan' && (
        <div className="flex-1 relative bg-gradient-to-b from-red-600 via-red-500 to-white z-0 overflow-hidden flex flex-col pt-10">
           
           <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20 pointer-events-none text-center w-full px-4">
             {apiKeyErrorLog && apiKeyStatus === 'invalid' && (
                <div className="mb-2 mx-auto inline-flex items-center gap-2 px-3 py-2 bg-red-950/80 border border-red-500/30 text-red-400 text-xs rounded-lg backdrop-blur-md">
                   <XCircle className="w-4 h-4 shrink-0" />
                   <span className="font-mono">{apiKeyErrorLog}</span>
                </div>
             )}
             <h1 className="text-4xl md:text-6xl font-black uppercase tracking-tighter drop-shadow-2xl">
                <span className="text-red-500">INDONE</span><span className="text-zinc-100">SIA</span>
             </h1>
             <p className="text-xs font-bold text-zinc-400 tracking-widest mt-2 uppercase shadow-black/50 drop-shadow-md">National Data Center</p>
           </div>

           {/* Map Interaction Area */}
           <div className="flex-1 w-full h-full relative z-0">
             <MapContainer 
               bounds={INDONESIA_BOUNDS}
               minZoom={4}
               maxBounds={INDONESIA_BOUNDS}
               maxBoundsViscosity={1.0}
               style={{ height: '100%', width: '100%', backgroundColor: 'transparent' }} 
               zoomControl={false}
             >
               {geoJsonData && (
                 <GeoJSON
                   data={geoJsonData}
                   style={(feature: any) => {
                     const name = feature?.properties?.Propinsi || feature?.properties?.name || "Unknown";
                     const formattedName = name.toLowerCase().split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                     const isSelected = selectedRegion === formattedName || selectedRegion === name;
                     
                     return {
                       fillColor: isSelected ? "#fcd34d" : "#27272a", // Gold when selected, dark zinc default
                       weight: 1.5,
                       opacity: 1,
                       color: isSelected ? "#fbbf24" : "#ffffff", // Light border
                       fillOpacity: isSelected ? 0.9 : 0.8
                     };
                   }}
                   onEachFeature={(feature: any, layer: any) => {
                     const name = feature?.properties?.Propinsi || feature?.properties?.name || "Unknown";
                     const formattedName = name.toLowerCase().split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                     
                     layer.on({
                       mouseover: (e: any) => {
                         const l = e.target;
                         l.setStyle({
                           fillOpacity: 0.95,
                           fillColor: "#ef4444", // Red on hover
                           color: "#fff"
                         });
                         l.bringToFront();
                       },
                       mouseout: (e: any) => {
                         const l = e.target;
                         const isSelected = selectedRegion === formattedName || selectedRegion === name;
                         l.setStyle({
                           fillOpacity: isSelected ? 0.9 : 0.8,
                           fillColor: isSelected ? "#fcd34d" : "#27272a",
                           color: isSelected ? "#fbbf24" : "#ffffff"
                         });
                       },
                       click: () => {
                         onRegionClick(formattedName);
                       }
                     });
                   }}
                 />
               )}
             </MapContainer>
           </div>

           {/* Overlay HUD controls */}
           <div className="absolute bottom-6 left-2 right-2 md:left-auto md:right-6 mx-auto w-full max-w-[95%] md:w-auto md:max-w-none z-40 grid grid-cols-3 gap-1.5 md:gap-2">
             <MapBtn 
                label="Utama" active={mapMode === 'UTAMA'} onClick={() => handleMapModeChange('UTAMA')} 
                activeClass="bg-blue-600 border-blue-500 text-white shadow-blue-600/20" />
             <MapBtn 
                label="Sekolah" active={mapMode === 'SEKOLAH'} onClick={() => handleMapModeChange('SEKOLAH')} 
                activeClass="bg-rose-600 border-rose-500 text-white shadow-rose-600/20" />
             <MapBtn 
                label="Kota" active={mapMode === 'KOTA'} onClick={() => handleMapModeChange('KOTA')} 
                activeClass="bg-emerald-600 border-emerald-500 text-white shadow-emerald-600/20" />
             <MapBtn 
                label="Kabupaten" active={mapMode === 'KABUPATEN'} onClick={() => handleMapModeChange('KABUPATEN')} 
                activeClass="bg-amber-600 border-amber-500 text-white shadow-amber-600/20" />
             <MapBtn 
                label="Kecamatan" active={mapMode === 'KECAMATAN'} onClick={() => handleMapModeChange('KECAMATAN')} 
                activeClass="bg-indigo-600 border-indigo-500 text-white shadow-indigo-600/20" />
             <MapBtn 
                label="Kebijakan Aneh" active={mapMode === 'KEBIJAKAN ANEH'} onClick={() => handleMapModeChange('KEBIJAKAN ANEH')} 
                activeClass="bg-fuchsia-600 border-fuchsia-500 text-white shadow-fuchsia-600/20" />
           </div>

        </div>
        )}

        {/* Other Tabs Rendering Placeholder */}
        {activeTab !== 'Peta Jaringan' && (
          <div className="flex-1 overflow-y-auto bg-zinc-950 p-8 custom-scrollbar relative">
             <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-[0.03] pointer-events-none" />
             
             <div className="max-w-4xl mx-auto relative z-10">
               <div className="inline-flex items-center gap-3 mb-8">
                 <div className="w-1.5 h-8 bg-gradient-to-b from-indigo-500 to-fuchsia-500 rounded-full" />
                 <h2 className="text-3xl font-black text-white uppercase tracking-tighter">{activeTab}</h2>
               </div>

               {activeTab === 'Arsip' && (
                 <div className="grid gap-4 opacity-100">
                   {archiveList.length === 0 ? (
                     <div className="p-6 border border-white/5 bg-zinc-900/50 rounded-xl">
                        <h4 className="text-lg font-bold text-white mb-2">Riwayat Analisis Kosong</h4>
                        <p className="text-sm text-zinc-400 leading-relaxed">Sistem belum menyimpan riwayat analisis anda di memori. Silakan eksplorasi data di opsi Peta Jaringan terlebih dahulu.</p>
                     </div>
                   ) : (
                     archiveList.map((item, index) => (
                       <div key={index} className="p-5 border border-white/10 bg-zinc-900/80 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-lg hover:bg-zinc-800 transition-colors">
                         <div>
                           <div className="flex items-center gap-2 mb-2">
                             <span className="text-xs text-indigo-400 font-bold uppercase tracking-widest">{item.region}</span>
                             <span className="text-[10px] text-zinc-500 font-mono">{item.timestamp.toLocaleTimeString()}</span>
                           </div>
                           <h4 className="text-sm text-white font-medium break-all md:break-normal">{item.data.title || "Analisis Regional"}</h4>
                         </div>
                         <button 
                           onClick={() => {
                             setActiveTab('Peta Jaringan');
                             setAiData(item.data);
                             setSelectedRegion(item.region);
                             setIsSidebarOpen(true);
                           }}
                           className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg transition-colors flex items-center justify-center shrink-0 cursor-pointer"
                         >
                           Buka Kembali
                         </button>
                       </div>
                     ))
                   )}
                 </div>
               )}

               {activeTab === 'Analisis' && (
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 opacity-100">
                    <div className="col-span-1 md:col-span-2 lg:col-span-3 p-4 border border-fuchsia-500/20 bg-gradient-to-r from-fuchsia-500/10 to-indigo-500/10 rounded-xl text-center">
                      <span className="text-xs text-fuchsia-300 font-bold flex items-center justify-center gap-2">
                        <RefreshCw className="w-4 h-4 animate-spin" /> Stream Data Real-Time Aktif (Seluruh Provinsi)
                      </span>
                    </div>
                    {allProvinces.map((prov) => (
                       <RealTimeProvinceCard key={prov} province={prov} />
                    ))}
                 </div>
               )}

               {activeTab === 'Peraturan' && (
                 <div className="grid gap-3 opacity-80">
                    <div className="p-4 border border-white/5 bg-zinc-900/50 rounded-xl flex items-center justify-between">
                       <div className="font-mono text-zinc-300 text-sm">UU No. 20 Tahun 2003</div>
                       <div className="px-2 py-1 bg-white/10 text-xs text-white rounded">Sistem Pendidikan Nasional</div>
                    </div>
                    <div className="p-4 border border-white/5 bg-zinc-900/50 rounded-xl flex items-center justify-between">
                       <div className="font-mono text-zinc-300 text-sm">PP No. 57 Tahun 2021</div>
                       <div className="px-2 py-1 bg-white/10 text-xs text-white rounded">Standar Nasional Pendidikan</div>
                    </div>
                 </div>
               )}
             </div>
          </div>
        )}
      </main>

      {/* 3. AI Side Panel - Drawer */}
      <AnimatePresence>
        {isSidebarOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSidebarOpen(false)}
              className="fixed inset-0 bg-black/90 backdrop-blur-md z-[200]"
            />
            
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed right-0 top-0 h-full w-full md:w-[500px] bg-zinc-950 border-l border-white/10 z-[210] flex flex-col shadow-2xl"
            >
              <div className="p-6 border-b border-white/5 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-600/10 flex items-center justify-center border border-indigo-500/20">
                    <Sparkles className="w-5 h-5 text-indigo-400" />
                  </div>
                  <h3 className="font-black text-transparent bg-clip-text bg-gradient-to-r from-rose-500 via-fuchsia-500 to-indigo-500 text-xl tracking-tighter truncate leading-tight pb-1">
                    PUSAT DANA NASIONAL
                  </h3>
                </div>
                <button onClick={() => setIsSidebarOpen(false)} className="p-3 text-zinc-500 hover:text-white transition-colors cursor-pointer">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-10 custom-scrollbar">
                 {isLoading ? (
                   <div className="flex flex-col items-center justify-center py-32 gap-6">
                      <div className="w-14 h-14 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                      <p className="text-xs font-mono text-zinc-500 font-black tracking-[0.4em] animate-pulse">ANALYZING REGIONAL STATS...</p>
                   </div>
                 ) : aiData && (
                   <motion.div 
                     initial={{ opacity: 0, y: 10 }}
                     animate={{ opacity: 1, y: 0 }}
                     className="space-y-10"
                   >
                     <section className="mb-6">
                       <div className="flex items-center gap-3">
                         <span className="w-1.5 h-8 bg-gradient-to-b from-rose-500 to-indigo-500 rounded-full" />
                         <h2 className="text-4xl font-black text-white tracking-tighter">{aiData.title}</h2>
                       </div>
                     </section>

                     <div className="grid grid-cols-2 gap-3 mb-6">
                        {aiData.stats?.map((stat: { label: string, value: string }, i: number) => {
                          const borderColors = [
                            'border-t-rose-500 text-rose-100 bg-rose-500/10',
                            'border-t-emerald-500 text-emerald-100 bg-emerald-500/10',
                            'border-t-amber-500 text-amber-100 bg-amber-500/10',
                            'border-t-indigo-500 text-indigo-100 bg-indigo-500/10'
                          ];
                          return (
                            <div key={i}>
                              <StatBox label={stat.label} value={stat.value} color={borderColors[i % borderColors.length]} />
                            </div>
                          );
                        })}
                     </div>

                     <section className="space-y-4 mb-8">
                        <p className="text-[10px] font-black w-fit px-3 py-1 bg-white/5 rounded-full text-indigo-400 uppercase tracking-[0.2em] flex items-center gap-2">
                          <Shield className="w-3 h-3" /> {aiData.listTitle}
                        </p>
                        <div className="space-y-3">
                          {aiData.listItems?.map((p: string, i: number) => {
                            const colors = [
                              { bg: 'bg-indigo-500/10', border: 'border-indigo-500/20', hover: 'hover:border-indigo-500/40', text: 'text-indigo-200', dot: 'bg-indigo-500' },
                              { bg: 'bg-rose-500/10', border: 'border-rose-500/20', hover: 'hover:border-rose-500/40', text: 'text-rose-200', dot: 'bg-rose-500' },
                              { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', hover: 'hover:border-emerald-500/40', text: 'text-emerald-200', dot: 'bg-emerald-500' },
                              { bg: 'bg-amber-500/10', border: 'border-amber-500/20', hover: 'hover:border-amber-500/40', text: 'text-amber-200', dot: 'bg-amber-500' },
                              { bg: 'bg-cyan-500/10', border: 'border-cyan-500/20', hover: 'hover:border-cyan-500/40', text: 'text-cyan-200', dot: 'bg-cyan-500' },
                              { bg: 'bg-fuchsia-500/10', border: 'border-fuchsia-500/20', hover: 'hover:border-fuchsia-500/40', text: 'text-fuchsia-200', dot: 'bg-fuchsia-500' }
                            ];
                            const theme = colors[i % colors.length];
                            return (
                              <div key={i} className={cn(
                                "group p-4 border rounded-2xl text-[11px] font-bold transition-all flex items-start gap-3 shadow-lg",
                                theme.bg, theme.border, theme.hover, theme.text
                              )}>
                                <div className={cn("w-2 h-2 rounded-full mt-1 shrink-0 shadow-[0_0_8px_rgba(0,0,0,0.5)]", theme.dot)} />
                                <span className="leading-relaxed drop-shadow-sm">{p}</span>
                              </div>
                            );
                          })}
                        </div>
                     </section>

                     {/* 3. Keterangan pulau teks nya berwarna di note */}
                     <section className="mb-8">
                       <div className="relative p-5 rounded-2xl bg-gradient-to-br from-indigo-900/40 to-fuchsia-900/20 border border-fuchsia-500/20 shadow-inner mt-4">
                          <div className="absolute -top-3 left-4 px-3 py-1 bg-fuchsia-900 border border-fuchsia-500 text-fuchsia-300 text-[8px] font-black rounded-full uppercase tracking-widest">
                            Note / Keterangan Pulau
                          </div>
                          <div className="prose prose-invert prose-sm text-fuchsia-100/90 font-medium leading-relaxed italic mt-2">
                            <Markdown>{aiData.summary}</Markdown>
                          </div>
                       </div>
                     </section>

                     <section className="pt-8 border-t border-white/10 space-y-6">
                        <div className="flex items-center gap-2 text-indigo-400">
                          <MessageSquare className="w-4 h-4" />
                          <span className="text-[10px] font-black w-fit px-3 py-1 bg-indigo-500/10 rounded-full uppercase tracking-widest border border-indigo-500/20">Alur Diskusi</span>
                        </div>
                        <div className="space-y-4">
                           {chatHistory.map((c, i) => (
                             <div key={i} className={cn(
                               "relative p-4 rounded-2xl text-xs max-w-[90%] font-medium shadow-md mt-4",
                               c.role === 'user' 
                                ? "bg-gradient-to-br from-zinc-800 to-zinc-900 border border-zinc-700 ml-auto text-zinc-200" 
                                : "bg-gradient-to-br from-indigo-600/20 to-indigo-900/20 border border-indigo-500/30 mr-auto text-indigo-100"
                             )}>
                               <div className={cn(
                                  "absolute -top-2.5 px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest border",
                                  c.role === 'user' ? "right-4 bg-zinc-800 border-zinc-600 text-zinc-400" : "left-4 bg-indigo-900 border-indigo-500 text-indigo-300"
                               )}>
                                 {c.role === 'user' ? 'Anda' : 'Analisis AI'}
                               </div>
                               <div className="mt-1 leading-relaxed">
                                 <Markdown>{c.text}</Markdown>
                               </div>
                             </div>
                           ))}
                        </div>
                        <form onSubmit={handleChatSubmit} className="relative pt-4">
                          <input 
                            type="text" value={chatInput} onChange={e => setChatInput(e.target.value)}
                            placeholder="Ketik pertanyaan untuk AI..."
                            className="w-full bg-zinc-950/80 border border-indigo-500/30 rounded-2xl px-6 py-4 text-xs text-indigo-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-zinc-900 transition-all placeholder:text-zinc-600 shadow-inner"
                          />
                        </form>
                     </section>
                   </motion.div>
                 )}
              </div>
              
              <footer className="p-6 border-t border-white/5 bg-zinc-950/80 flex items-center justify-between shrink-0">
                 <div className="flex flex-col">
                   <span className="text-[8px] font-black tracking-widest text-zinc-600 uppercase">Engine Status</span>
                   <span className="text-[10px] font-bold text-white">OP-READY-STREAM</span>
                 </div>
                 <div className="w-10 h-1 bg-white/5 rounded-full" />
              </footer>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {isSettingsOpen && (
          <div className="fixed inset-0 z-[999] flex items-center justify-center p-4">
             <motion.div 
               initial={{ opacity: 0 }} 
               animate={{ opacity: 1 }} 
               exit={{ opacity: 0 }}
               onClick={() => setIsSettingsOpen(false)}
               className="absolute inset-0 bg-black/60 backdrop-blur-sm"
             />
             <motion.div 
               initial={{ opacity: 0, scale: 0.95, y: 20 }}
               animate={{ opacity: 1, scale: 1, y: 0 }}
               exit={{ opacity: 0, scale: 0.95, y: 20 }}
               className="relative w-full max-w-md bg-zinc-900 border border-white/10 shadow-2xl rounded-2xl overflow-hidden max-h-[90vh] flex flex-col"
             >
                <div className="p-6 border-b border-white/5 flex items-center justify-between shrink-0">
                  <h3 className="text-lg font-bold text-white uppercase tracking-widest">AI Settings</h3>
                  <button onClick={() => setIsSettingsOpen(false)} className="text-zinc-400 hover:text-white transition-colors cursor-pointer p-1 rounded-lg hover:bg-white/10"><X className="w-5 h-5"/></button>
                </div>
                
                <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest">
                        Kelola API Keys (Gemini)
                      </label>
                      <div className="flex items-center gap-1.5">
                        {apiKeyStatus === 'testing' && <Loader2 className="w-3 h-3 text-zinc-400 animate-spin" />}
                        {apiKeyStatus === 'valid' && <><CheckCircle2 className="w-3 h-3 text-emerald-500" /><span className="text-[10px] text-emerald-500 font-bold uppercase">Connected</span></>}
                        {apiKeyStatus === 'invalid' && <><XCircle className="w-3 h-3 text-red-500" /><span className="text-[10px] text-red-500 font-bold uppercase">Limit / Error</span></>}
                      </div>
                    </div>
                    
                    <div className="flex gap-2">
                       <input 
                         type="password"
                         placeholder="Tambah kunci API baru..."
                         value={newKeyInput}
                         onChange={(e) => setNewKeyInput(e.target.value)}
                         className="flex-1 bg-zinc-950 border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-indigo-500/50 transition-colors placeholder:text-zinc-600"
                       />
                       <button
                         onClick={handleSaveNewKey}
                         disabled={isSavingKey || !newKeyInput.trim()}
                         className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-600 rounded-xl text-xs font-bold text-white transition-colors flex items-center justify-center shrink-0 cursor-pointer"
                       >
                         {isSavingKey ? <Loader2 className="w-4 h-4 animate-spin" /> : "Simpan"}
                       </button>
                    </div>

                    <div className="mt-4 border border-white/10 rounded-xl overflow-hidden bg-zinc-950/50">
                       <div className="bg-zinc-900/80 px-4 py-2 border-b border-white/5 text-[10px] font-black uppercase text-zinc-500 tracking-wider">
                         Daftar Kunci Tersimpan
                       </div>
                       <div className="divide-y divide-white/5 max-h-40 overflow-y-auto custom-scrollbar">
                         {envKeyInfo && (
                           <div 
                             onClick={() => setSelectedKeyId('env')}
                             className={`px-4 py-3 flex items-center justify-between cursor-pointer transition-colors ${selectedKeyId === 'env' ? 'bg-indigo-500/10' : 'hover:bg-white/5'}`}
                           >
                              <div className="flex items-center gap-3">
                                <div className={`w-3 h-3 rounded-full flex items-center justify-center border ${selectedKeyId === 'env' ? 'border-indigo-500' : 'border-zinc-600'}`}>
                                  {selectedKeyId === 'env' && <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />}
                                </div>
                                <code className="font-mono text-xs text-zinc-300">{envKeyInfo.masked}</code>
                                <span className="text-[8px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full uppercase border border-emerald-500/20">ENV Default</span>
                              </div>
                           </div>
                         )}
                         {apiKeysList.map((k) => (
                           <div 
                             key={k.keyId} 
                             onClick={() => setSelectedKeyId(k.keyId)}
                             className={`px-4 py-3 flex items-center justify-between group cursor-pointer transition-colors ${selectedKeyId === k.keyId ? 'bg-indigo-500/10' : 'hover:bg-white/5'}`}
                           >
                              <div className="flex items-center gap-3">
                                <div className={`w-3 h-3 rounded-full flex items-center justify-center border ${selectedKeyId === k.keyId ? 'border-indigo-500' : 'border-zinc-600'}`}>
                                  {selectedKeyId === k.keyId && <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />}
                                </div>
                                <code className="font-mono text-xs text-zinc-300">{k.masked}</code>
                              </div>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteKey(k.keyId);
                                }}
                                className="text-zinc-600 hover:text-red-400 p-1 rounded transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
                                title="Hapus Key"
                              >
                                <X className="w-4 h-4" />
                              </button>
                           </div>
                         ))}
                         {apiKeysList.length === 0 && !envKeyInfo && (
                           <div className="p-4 text-center text-xs text-zinc-500 italic">
                             Belum ada kunci tersimpan
                           </div>
                         )}
                       </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest">
                      AI Generation Model
                    </label>
                    <div className="relative">
                      <select 
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value)}
                        className="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all appearance-none cursor-pointer"
                      >
                        {availableModels.map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                      <ChevronRight className="w-4 h-4 absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none rotate-90" />
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-zinc-950/50 border-t border-white/5 flex justify-end shrink-0">
                  <button 
                    onClick={() => setIsSettingsOpen(false)}
                    className="px-6 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white text-xs font-bold rounded-xl transition-all cursor-pointer uppercase tracking-widest shadow-lg"
                  >
                    Tutup
                  </button>
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Developer Modal */}
      <AnimatePresence>
        {isDeveloperOpen && (
          <div className="fixed inset-0 z-[999] flex items-center justify-center p-4">
             <motion.div 
               initial={{ opacity: 0 }} 
               animate={{ opacity: 1 }} 
               exit={{ opacity: 0 }}
               onClick={() => setIsDeveloperOpen(false)}
               className="absolute inset-0 bg-black/60 backdrop-blur-sm"
             />
             <motion.div 
               initial={{ opacity: 0, scale: 0.95, y: 20 }}
               animate={{ opacity: 1, scale: 1, y: 0 }}
               exit={{ opacity: 0, scale: 0.95, y: 20 }}
               className="relative w-full max-w-lg bg-zinc-900 border border-emerald-500/20 shadow-2xl rounded-2xl overflow-hidden max-h-[90vh] flex flex-col"
             >
                <div className="p-6 bg-gradient-to-r from-emerald-500/10 to-indigo-500/10 border-b border-white/5 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-3">
                     <Users className="w-6 h-6 text-emerald-400" />
                     <h3 className="text-lg font-bold text-white uppercase tracking-widest">Fitur Developer</h3>
                  </div>
                  <button onClick={() => setIsDeveloperOpen(false)} className="text-zinc-400 hover:text-white transition-colors cursor-pointer p-1 rounded-lg hover:bg-white/10"><X className="w-5 h-5"/></button>
                </div>
                
                <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar">
                  <div className="p-4 rounded-xl border border-indigo-500/30 bg-indigo-500/10 shadow-[0_0_15px_rgba(99,102,241,0.1)]">
                    <h4 className="text-xs text-indigo-300 font-bold tracking-widest uppercase mb-1">Developer</h4>
                    <p className="text-lg md:text-xl text-white font-black uppercase tracking-tight">DEDI HUTAPEA <span className="text-indigo-400 mx-1">/</span> ALENA NOVIANTI</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 flex items-center gap-3 hover:bg-emerald-500/20 transition-colors">
                      <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center shrink-0 shadow-lg shadow-emerald-500/30">
                        <MessageSquare className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <div className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider mb-1">WhatsApp</div>
                        <div className="text-sm font-mono text-emerald-50">+62 773 374 5059</div>
                      </div>
                    </div>
                    <div className="p-4 rounded-xl border border-blue-500/30 bg-blue-500/10 flex items-center gap-3 hover:bg-blue-500/20 transition-colors">
                      <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center shrink-0 shadow-lg shadow-blue-500/30">
                        <Send className="w-5 h-5 text-white" />
                      </div>
                      <div>
                         <div className="text-[10px] text-blue-400 font-bold uppercase tracking-wider mb-1">Telegram</div>
                         <div className="text-sm font-mono text-blue-50">@otomotif_digital</div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                     <div className="p-5 rounded-xl border border-zinc-700 bg-zinc-800/80 border-l-4 border-l-fuchsia-500 shadow-inner">
                        <h4 className="text-xs text-fuchsia-400 font-bold uppercase tracking-widest mb-3 flex items-center gap-2">
                          <Globe className="w-4 h-4"/> Tujuan Website
                        </h4>
                        <p className="text-xs md:text-sm text-zinc-300 leading-relaxed font-medium">
                          Platform ini dirancang untuk memvisualisasikan data dan kebijakan sumber daya manusia (SDM) di seluruh wilayah Indonesia secara komprehensif, interaktif, dan terintegrasi dengan teknologi AI terkini guna memberikan kemudahan pemantauan dan transparansi informasi publik.
                        </p>
                     </div>

                     <div className="p-5 rounded-xl border border-red-500/30 bg-red-500/10 border-l-4 border-l-red-600 relative overflow-hidden group">
                        <Shield className="absolute -right-6 -bottom-6 w-32 h-32 text-red-500/10 group-hover:scale-110 transition-transform duration-500 pointer-events-none" />
                        <h4 className="text-xs text-red-500 font-bold uppercase tracking-widest mb-3 flex items-center gap-2 relative z-10">
                          <AlertCircle className="w-4 h-4"/> Undang-Undang Copy Paste Web
                        </h4>
                        <div className="text-[11px] md:text-xs text-red-100/90 leading-relaxed font-medium space-y-3 relative z-10">
                          <p>
                            <strong>PENGUNGKAPAN HUKUM:</strong> Seluruh struktur data, desain antarmuka, dan konten esensial situs ini dilindungi secara hukum berdasarkan <strong>Undang-Undang Republik Indonesia Nomor 28 Tahun 2014 Tentang Hak Cipta</strong>.
                          </p>
                          <p className="text-red-200 border-l border-red-500/50 pl-3">
                            Setiap orang dilarang keras melakukan kegiatan <em>copy-paste</em>, menduplikasi, memodifikasi, maupun mengeksploitasi situs ini tanpa pemberian izin tertulis dari Developer. Pelanggaran terhadap peraturan dapat dituntut secara perdata dan pidana secara sah.
                          </p>
                        </div>
                     </div>
                  </div>
                </div>

                <div className="p-4 bg-zinc-950/80 border-t border-white/5 flex justify-end shrink-0">
                  <button 
                    onClick={() => setIsDeveloperOpen(false)}
                    className="px-6 py-2.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white text-xs font-bold rounded-xl transition-all cursor-pointer uppercase tracking-widest shadow-xl"
                  >
                    Tutup Panel
                  </button>
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}

// --- Helper Components ---

function RealTimeProvinceCard({ province }: { province: string; key?: React.Key }) {
  const [value, setValue] = useState(Math.floor(Math.random() * 40) + 40);
  const [trend, setTrend] = useState<'up'|'down'>('up');

  useEffect(() => {
    const interval = setInterval(() => {
      const change = Math.floor(Math.random() * 7) - 3;
      setValue(prev => {
        let newVal = prev + change;
        if (newVal > 100) newVal = 100;
        if (newVal < 0) newVal = 0;
        setTrend(newVal > prev ? 'up' : 'down');
        return newVal;
      });
    }, 2000 + Math.random() * 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-4 border border-indigo-500/20 bg-zinc-900/60 rounded-xl hover:bg-zinc-800/80 transition-colors group">
       <div className="flex justify-between items-center mb-3">
         <span className="text-xs font-bold text-zinc-200 uppercase truncate pr-2 tracking-wider">{province}</span>
         {trend === 'up' ? <TrendingUp className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" /> : <TrendingUp className="w-4 h-4 text-red-400 rotate-180 group-hover:scale-110 transition-transform" />}
       </div>
       <div className="space-y-2">
         <div className="flex justify-between items-center text-[10px]">
           <span className="text-zinc-500 font-medium">Kinerja Data</span> 
           <span className={cn("font-mono font-bold text-xs", trend === 'up' ? 'text-emerald-300' : 'text-red-300')}>{value}%</span>
         </div>
         <div className="w-full bg-zinc-950/50 border border-white/5 rounded-full h-1.5 overflow-hidden">
           <div className={cn("h-full transition-all duration-1000 ease-in-out shadow-inner", trend === 'up' ? "bg-gradient-to-r from-emerald-600 to-emerald-400" : "bg-gradient-to-r from-red-600 to-red-400")} style={{ width: `${value}%` }} />
         </div>
         <div className="pt-2 flex justify-between items-center opacity-60">
           <span className="text-[8px] text-zinc-500 tracking-widest uppercase">Target 100%</span>
           <span className="text-[8px] text-indigo-400 tracking-widest uppercase font-mono flex gap-1 items-center">
             LIVE <div className="w-1 h-1 bg-indigo-400 rounded-full animate-pulse" />
           </span>
         </div>
       </div>
    </div>
  );
}

function NavItem({ icon, label, active = false, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick?: () => void }) {
  return (
    <div 
      onClick={onClick}
      className={cn(
      "flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all group cursor-pointer",
      active ? "bg-white/10 text-white shadow-sm" : "text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
    )}>
      <div className={cn("shrink-0", active ? "text-indigo-400" : "")}>{icon}</div>
      <span className="truncate">{label}</span>
      {active && <div className="ml-auto shrink-0 w-1.5 h-1.5 rounded-full bg-indigo-500" />}
    </div>
  );
}

function HeaderStat({ label, value }: { label: string, value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-widest text-zinc-500">{label}</span>
      <span className="text-sm font-bold text-white">{value}</span>
    </div>
  );
}

function MapControl({ label }: { label: string }) {
  return (
    <button className="px-3 py-1.5 bg-zinc-900/80 backdrop-blur border border-white/10 rounded-lg text-[10px] font-bold text-zinc-400 hover:bg-zinc-800 hover:text-white transition-all uppercase tracking-wider text-left">
      {label}
    </button>
  );
}

function StatBox({ label, value, color = "bg-zinc-900 border-t-indigo-500/30" }: { label: string, value: string, color?: string }) {
  return (
    <div className={cn("p-3 rounded-xl border border-white/5 border-t-2", color)}>
      <p className="text-[8px] text-zinc-400 font-black uppercase tracking-wider">{label}</p>
      <p className="text-[10px] font-black text-white truncate">{value}</p>
    </div>
  );
}

function MapBtn({ label, active = false, onClick, activeClass = "bg-indigo-600 border-indigo-500 text-white shadow-indigo-600/20" }: { label: string, active?: boolean, onClick?: () => void, activeClass?: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
      "px-1 md:px-4 py-2 border rounded-xl text-[8.5px] md:text-[10px] font-black transition-all uppercase tracking-wider md:tracking-widest shadow-xl cursor-pointer active:scale-95 flex items-center justify-center text-center leading-tight break-words h-12 md:h-auto min-w-0",
      active 
        ? activeClass
        : "bg-zinc-950/95 border-white/10 text-zinc-500 hover:text-white hover:bg-zinc-900"
    )}>
      {label}
    </button>
  );
}

function PolicyItem({ text }: { text: string }) {

  return (
    <div className="flex items-start gap-4 group bg-white/5 p-3 rounded-2xl border border-white/5">
      <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0 group-hover:scale-125 transition-transform" />
      <p className="text-[11px] text-zinc-400 group-hover:text-zinc-200 transition-colors leading-relaxed font-bold">{text}</p>
    </div>
  );
}
